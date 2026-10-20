#!/usr/bin/env bash
# ===========================================================================
#  End-to-end proof: a Bridge-rejected peg-in starves registerBtcTransaction
#  for the whole federation-change window.
#
#      ./e2e/run.sh
#
#  Real bitcoind (regtest), real rskj built from the audited commit, real
#  powpeg-node built from the production tag, a real federation change, 40
#  real ground Bitcoin transactions, one real victim, real eth_getBalance.
#
#  Two real powpeg nodes are needed, because RSKIP419 only hands a federation
#  over after the SVP cycle has been signed by both the old and the new
#  federation (see the comment at stage 3).
#
#  Stages:  build -> bitcoind -> node A + node B -> seed the federation
#           -> federation change + SVP handover -> attack -> measure -> recovery
#
#  Everything is written under $WORK (default ~/powpeg-e2e):
#     state/state.json     txids, addresses, every measurement
#     logs/*.log           raw node output, unmodified
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/powpeg-e2e}"
STATE="$WORK/state"
LOGS="$WORK/logs"
RSKJ_COMMIT="1e95a3b039b2f2e12837400533e88dc4aedeefb8"
POWPEG_TAG="VETIVER-9.0.4.0"
RSK_RPC="http://127.0.0.1:4444"
RSK_RPC_B="http://127.0.0.1:4445"
BTC_RPC="http://127.0.0.1:18443"
BTC_USER=rsk
BTC_PASS=rsk
KEEP=0
CHECK=0
NATIVE_JVM=0
FROM=build

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --check) CHECK=1 ;;
    --native) NATIVE_JVM=1 ;;
    --from) FROM="$2"; shift ;;
    --work) WORK="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
  esac
  shift
done

mkdir -p "$WORK" "$STATE" "$LOGS"
export WORK STATE RSK_RPC RSK_RPC_B BTC_RPC BTC_USER BTC_PASS E2E_STATE="$STATE" E2E_LOGS="$LOGS"

c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_bad()  { printf '\033[31m%s\033[0m\n' "$*"; }
c_step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# macOS has no `timeout(1)`
run_timeout() {  # $1 seconds, rest = command
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
}

die() { c_bad "FAILED: $*"; exit 1; }

# ---------------------------------------------------------------------------
c_step "0. preflight"

JAVA_CMD=""
ARCH_PREFIX=""

# The federate node starts a bitcoinj SPV wallet (WalletAppKit) and bitcoinj
# binds leveldb through leveldbjni 1.8. That jar ships native libraries for
# macOS x86_64 and i386 only -- there is no arm64 build, in any release, and the
# aarch64 forks only cover Linux. Rootstock's own integration-test README says to
# use an x86_64 JDK with Rosetta on ARM machines. So on Apple Silicon the only
# way to run the real node is an x86_64 JVM under Rosetta; everything else here
# (bitcoind, the PoC, the RSK code itself) stays native arm64.
if [ "$(uname -m)" = "arm64" ] && [ "$NATIVE_JVM" != "1" ]; then
  if ! arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
    c_bad "  Rosetta 2 is not installed."
    echo "    softwareupdate --install-rosetta --agree-to-license"
    die "an x86_64 JVM is required for the federator (leveldbjni has no arm64 build)"
  fi

  JDK_X64="${JAVA_X64:-$WORK/jdk-x64}"
  if [ ! -x "$JDK_X64/Contents/Home/bin/java" ]; then
    echo "  downloading an x86_64 JDK 17 for the federator (one time, ~180 MB)"
    mkdir -p "$JDK_X64"
    curl -fL --retry 3 -o "$WORK/jdk-x64.tar.gz" \
      "https://api.adoptium.net/v3/binary/latest/17/ga/mac/x64/jdk/hotspot/normal/eclipse" \
      || die "could not download the x86_64 JDK"
    tar -xzf "$WORK/jdk-x64.tar.gz" -C "$JDK_X64" --strip-components=1 \
      || die "could not unpack the x86_64 JDK"
    rm -f "$WORK/jdk-x64.tar.gz"
  fi
  [ -x "$JDK_X64/Contents/Home/bin/java" ] || die "x86_64 JDK missing after unpack"

  ARCH_PREFIX="arch -x86_64"
  JAVA_CMD="$ARCH_PREFIX $JDK_X64/Contents/Home/bin/java"
  echo "  JVM: x86_64 JDK 17 under Rosetta (leveldbjni has no arm64 build)"
else
  if ! java -version 2>&1 | grep -q 'version "17'; then
    for h in "$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home" \
             /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
             /usr/lib/jvm/java-17-openjdk-amd64; do
      [ -x "$h/bin/java" ] && { export JAVA_HOME="$h"; export PATH="$h/bin:$PATH"; break; }
    done
  fi
  JAVA_CMD="java"
fi

$JAVA_CMD -version 2>&1 | head -1 | sed 's/^/  /'
$JAVA_CMD -version 2>&1 | grep -q 'version "17' || die "need JDK 17"

command -v bitcoind >/dev/null || die "bitcoind not found in PATH"
command -v bitcoin-cli >/dev/null || die "bitcoin-cli not found in PATH"
echo "  bitcoind $(bitcoind --version | head -1 | awk '{print $NF}')"

PY=python3
command -v python3 >/dev/null 2>&1 || die "python3 not found"
$PY -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" \
  || die "python3 >= 3.8 required"
echo "  python $($PY -V 2>&1 | awk '{print $2}')  (stdlib only, no pip)"
command -v git >/dev/null || die "git not found"

DF_GB=$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')
echo "  free disk   ${DF_GB:-?} GB   (the two fat jars need ~4 GB)"

if [ "$CHECK" = "1" ]; then
  echo
  c_ok "preflight OK -- everything the end-to-end run needs is installed"
  echo "  next:  ./e2e/run.sh          (about 20-25 min on a first build)"
  exit 0
fi

# ---------------------------------------------------------------------------
c_step "1. build powpeg-node"

# Only the federate node is needed: FederateRunner embeds rskj (FedNodeContext
# extends RskContext), so there is no separate RSK node jar to build here.
REPOS="${REPOS:-$HOME/ee.io}"
mkdir -p "$REPOS"
[ -d "$REPOS/powpeg-node/.git" ] || git clone -q https://github.com/rsksmart/powpeg-node "$REPOS/powpeg-node"
( cd "$REPOS/powpeg-node" && git fetch -q origin && git checkout -q "$POWPEG_TAG" ) || die "powpeg-node checkout"

POWPEG_JAR=$(ls "$REPOS"/powpeg-node/build/libs/*-all.jar 2>/dev/null | head -1)
if [ -z "${POWPEG_JAR:-}" ]; then
  echo "  building powpeg-node (once, ~5 min)"
  ( cd "$REPOS/powpeg-node" && ./configure.sh >/dev/null 2>&1; ./gradlew --no-daemon --console=plain fatJar -x test ) \
    > "$LOGS/build-powpeg.log" 2>&1 || die "powpeg build failed, see $LOGS/build-powpeg.log"
  POWPEG_JAR=$(ls "$REPOS"/powpeg-node/build/libs/*-all.jar 2>/dev/null | head -1)
fi
[ -n "${POWPEG_JAR:-}" ] || die "powpeg fat jar not found"
echo "  powpeg-node $(basename "$POWPEG_JAR")"

# ---------------------------------------------------------------------------
c_step "1b. clearing leftovers from previous runs"

# A full run starts from a wiped database, so measurements, txids and addresses
# recorded by an earlier run are stale and must not be reused.
if [ "$FROM" = "build" ]; then
  rm -f "$STATE/state.json"
fi

# a stale FederateRunner keeps 4444 and the rskj database locked, which makes a
# new one die before it can even log anything
STALE=$(pgrep -f co.rsk.federate.FederateRunner 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "  killing stale FederateRunner: $STALE"
  echo "$STALE" | xargs kill 2>/dev/null || true
  sleep 3
  STALE=$(pgrep -f co.rsk.federate.FederateRunner 2>/dev/null || true)
  [ -n "$STALE" ] && echo "$STALE" | xargs kill -9 2>/dev/null || true
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:4444 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  something is still listening on 4444:"
  lsof -nP -iTCP:4444 -sTCP:LISTEN | sed 's/^/    /'
  lsof -nP -t -iTCP:4444 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
  sleep 2
fi

# ---------------------------------------------------------------------------
c_step "2. bitcoind regtest"

BTC_DIR="$WORK/btc"
mkdir -p "$BTC_DIR"
if ! bitcoin-cli -regtest -datadir="$BTC_DIR" -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS \
       -rpcport=18443 getblockchaininfo >/dev/null 2>&1; then
  bitcoind -regtest -datadir="$BTC_DIR" -server \
      -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS -rpcport=18443 -port=18444 \
      -txindex -fallbackfee=0.0001 -addresstype=legacy -listen=1 \
      -daemonwait > "$LOGS/bitcoind.log" 2>&1 || die "bitcoind did not start, see $LOGS/bitcoind.log"
fi
for i in $(seq 1 30); do
  bitcoin-cli -regtest -datadir="$BTC_DIR" -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS \
      -rpcport=18443 getblockchaininfo >/dev/null 2>&1 && break
  sleep 1
done
echo "  bitcoind up on 18443/18444"

CNT=$(bitcoin-cli -regtest -datadir="$BTC_DIR" -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS -rpcport=18443 getblockcount)
# a wallet is needed for sendtoaddress/listunspent; bitcoind >= 28 never
# creates one implicitly
btc() {
  bitcoin-cli -regtest -datadir="$BTC_DIR" -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS \
      -rpcport=18443 "$@"
}

if ! btc listwallets 2>/dev/null | grep -q '"'; then
  if ! btc createwallet e2e >/dev/null 2>&1; then
    btc loadwallet e2e >/dev/null 2>&1 || {
      c_bad "  cannot create or load the bitcoind wallet:"
      btc createwallet e2e 2>&1 | sed 's/^/    /'
      die "wallet setup failed"
    }
  fi
  echo "  wallet 'e2e' created"
fi

CNT=$(btc getblockcount)
if [ "$CNT" -lt 120 ]; then
  ADDR=$(btc getnewaddress "" legacy) || die "getnewaddress failed"
  [ -n "$ADDR" ] || die "bitcoind returned an empty address"
  btc generatetoaddress 120 "$ADDR" >/dev/null || die "generatetoaddress failed"
  [ "$(btc getblockcount)" -ge 120 ] || die "bitcoind did not mine"
  echo "  mined 120 blocks (coinbase maturity)"
else
  echo "  chain already at $CNT blocks"
fi

# ---------------------------------------------------------------------------
# the two federation-change authorizers, derived the way rskj derives them
export E2E_HERE="$HERE"
AUTH_A_KEY=$($PY -c "import os,sys; sys.path.insert(0, os.environ['E2E_HERE']); from e2e import keccak256; print(keccak256(b'auth-a').hex())")
AUTH_B_KEY=$($PY -c "import os,sys; sys.path.insert(0, os.environ['E2E_HERE']); from e2e import keccak256; print(keccak256(b'auth-b').hex())")
AUTH_C_KEY=$($PY -c "import os,sys; sys.path.insert(0, os.environ['E2E_HERE']); from e2e import keccak256; print(keccak256(b'auth-c').hex())")
[ -n "$AUTH_A_KEY" ] && [ -n "$AUTH_B_KEY" ] && [ -n "$AUTH_C_KEY" ] \
  || die "could not derive the authorizer keys"

c_step "3. two powpeg nodes (this jar IS the RSK node: FederateRunner embeds rskj)"

# Two federators, because RSKIP419 will not hand a federation over unless the SVP
# cycle is signed twice:
#   fund tx   -- paid by the ACTIVE (genesis) federation, needs 2 of its 3 keys
#   spend tx  -- paid by the PROPOSED federation,        needs 2 of its 2 keys
# The proposed federation is therefore {federator1, federator2}: the two keys
# these two nodes run with. Each node is a full RSK node plus a federator; node A
# mines and is the peer node B syncs from.
gen_key() {  # $1 generator name -> hex private key (rskj's GenNodeKeyId rule)
  $PY - "$1" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["E2E_HERE"])
from e2e import keccak256
print(keccak256(sys.argv[1].encode()).hex())
PYEOF
}

node_id() {  # $1 seed -> 128 hex chars, the uncompressed pubkey without 0x04
  $PY - "$1" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["E2E_HERE"])
from e2e import keccak256, PrivateKey
k = PrivateKey(keccak256(sys.argv[1].encode()))
print(k.public_key.format(False)[1:].hex())
PYEOF
}

POWPEG_PID_A=""
POWPEG_PID_B=""
NODE_A_ID=$(node_id federator1)
[ -n "$NODE_A_ID" ] || die "could not derive node A's nodeId"

start_powpeg() {  # $1 seed, $2 rpc port, $3 p2p port, $4 mine yes|no, $5 wipe yes|no, $6 peer nodeId or -
  local gen="$1" rpcport="$2" p2pport="$3" mine="$4" wipe="$5" peerid="$6"

  rm -f "$WORK/$gen.key"
  gen_key "$gen" > "$WORK/$gen.key"
  chmod 400 "$WORK/$gen.key"

  if [ "$wipe" = "yes" ]; then
    rm -rf "$WORK/rskj-db-$gen" "$LOGS/node-$gen"
  fi
  mkdir -p "$LOGS/node-$gen"
  rm -f "$WORK"/hs_err_pid*.log

  cat > "$WORK/powpeg-$gen.conf" <<EOF
blockchain.config.name = "regtest"

rpc {
    providers {
        web {
            http {
                enabled = true
                bind_address = "127.0.0.1"
                port = $rpcport
                hosts = [ "*" ]
            }
        }
    }
    modules = [
        { name: "eth",      version: "1.0", enabled: "true" },
        { name: "net",      version: "1.0", enabled: "true" },
        { name: "rpc",      version: "1.0", enabled: "true" },
        { name: "web3",     version: "1.0", enabled: "true" },
        { name: "evm",      version: "1.0", enabled: "true" },
        { name: "mnr",      version: "1.0", enabled: "true" },
        { name: "personal", version: "1.0", enabled: "true" },
        { name: "fed",      version: "1.0", enabled: "true" },
        { name: "rsk",      version: "1.0", enabled: "true" }
    ]
}

peer {
    privateKey = "$(gen_key "$gen")"
    discovery.enabled = false
    port = $p2pport
EOF

  if [ "$peerid" != "-" ]; then
    cat >> "$WORK/powpeg-$gen.conf" <<EOF
    active = [
        { ip = "127.0.0.1", port = 50501, nodeId = "$peerid" }
    ]
EOF
  fi

  cat >> "$WORK/powpeg-$gen.conf" <<EOF
}

wallet {
    enabled = true
    accounts = [
        { privateKey = "$AUTH_A_KEY" },
        { privateKey = "$AUTH_B_KEY" },
        { privateKey = "$AUTH_C_KEY" },
        { privateKey = "$(gen_key federator1)" },
        { privateKey = "$(gen_key federator2)" }
    ]
}

miner {
    server.enabled = $([ "$mine" = "yes" ] && echo true || echo false)
    client {
        enabled = $([ "$mine" = "yes" ] && echo true || echo false)
        delayBetweenBlocks = 1 second
    }
    coinbase.secret = "auth-a"
}

database {
    dir = "$WORK/rskj-db-$gen"
}

federator {
    enabled = true
    updateBridgeTimerEnabled = true

    # updateCollections is what CREATES the SVP fund tx, and the Bridge stores
    # its hash so it can recognise the signed tx later. If two federators (or a
    # script and a federator) call it before the fund tx is signed, the stored
    # hash is overwritten and the tx the federators actually signed is no longer
    # recognised -- it then gets classified as a PEGOUT and the SVP dies of old
    # age. Exactly one actor may call it: node A's own turn timer.
    updateCollections = $([ "$mine" = "yes" ] && echo true || echo false)
    signers {
        BTC { type = "keyFile", path = "$WORK/$gen.key" }
        RSK { type = "keyFile", path = "$WORK/$gen.key" }
        MST { type = "keyFile", path = "$WORK/$gen.key" }
    }
    bitcoinPeerAddresses = [ "127.0.0.1:18444" ]
    gasPrice = 0
}
EOF

  rm -f "$LOGS/powpeg-$gen.log"
  ( cd "$WORK" && exec $JAVA_CMD -Drsk.conf.file="$WORK/powpeg-$gen.conf" -Dlogging.dir="$LOGS/node-$gen" \
       -cp "$POWPEG_JAR" co.rsk.federate.FederateRunner --regtest --reset ) \
       > "$LOGS/powpeg-$gen.log" 2>&1 &
  local pid=$!
  echo "  powpeg-node pid $pid as '$gen' (rpc $rpcport, p2p $p2pport, miner $mine)"
  for i in $(seq 1 180); do
    if $PY -c "
import json,sys,urllib.request
try:
    r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:$rpcport',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(),headers={'Content-Type':'application/json'}),timeout=2)
    print(json.loads(r.read())['result']); sys.exit(0)
except Exception: sys.exit(1)" >/dev/null 2>&1; then
      sleep 8
      if kill -0 "$pid" 2>/dev/null; then
        if [ "$gen" = "federator1" ]; then POWPEG_PID_A="$pid"; else POWPEG_PID_B="$pid"; fi
        return 0
      fi
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  local rc=0
  wait "$pid" 2>/dev/null; rc=$?
  c_bad "  the node never answered on $rpcport (java exited with $rc)."
  for f in "$LOGS/powpeg-$gen.log" "$LOGS/node-$gen/rsk.log"; do
    if [ -s "$f" ]; then
      echo "  ---- $(basename "$f"): last 30 lines ----"
      grep -vE '^\s+at ' "$f" | tail -30 | sed 's/^/    /'
    fi
  done
  echo "  config used ($WORK/powpeg-$gen.conf):"
  sed -E 's/(privateKey = )"[0-9a-f]+"/\1"<redacted>"/' "$WORK/powpeg-$gen.conf" | sed 's/^/    /'
  die "powpeg-node startup failed ($gen)"
}

stop_powpeg() {
  local p
  for p in "$POWPEG_PID_A" "$POWPEG_PID_B"; do
    [ -n "$p" ] || continue
    kill "$p" 2>/dev/null
    for i in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    kill -9 "$p" 2>/dev/null
  done
  POWPEG_PID_A=""; POWPEG_PID_B=""
  sleep 2
}

c_step "3a. node A: miner + federator1"
start_powpeg federator1 4444 50501 yes yes -
c_step "3b. node B: federator2, syncing from node A"
start_powpeg federator2 4445 50502 no yes "$NODE_A_ID"

# node B has to be on the same chain as A; the federator on B cannot register
# anything against a chain it has not caught up with yet
echo "  waiting for node B to sync from node A"
HEIGHT_A=$($PY -c "
import json,urllib.request
r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4444',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(),headers={'Content-Type':'application/json'}),timeout=5)
print(int(json.loads(r.read())['result'],16))")
for i in $(seq 1 60); do
  HEIGHT_B=$($PY -c "
import json,urllib.request
try:
  r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4445',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(),headers={'Content-Type':'application/json'}),timeout=5)
  print(int(json.loads(r.read())['result'],16))
except Exception: print(-1)")
  [ "$HEIGHT_B" -ge "$((HEIGHT_A - 1))" ] && break
  sleep 2
done
echo "  node A at $HEIGHT_A, node B at ${HEIGHT_B:--1}"
[ "${HEIGHT_B:--1}" -ge "$((HEIGHT_A - 2))" ] \
  || die "node B never caught up with node A (A=$HEIGHT_A B=$HEIGHT_B); the two nodes are not peering"

# The federator must be alive before anything expensive happens. FedNodeRunner
# gives up quietly when a requirement fails and the node then looks perfectly
# healthy over RPC while never sending a single transaction to the Bridge.
c_step "3c. both federators are actually running"
$PY "$HERE/e2e.py" federator-check federator1 --height || \
  die "node A is up but its federator is not: see the lines above"
$PY "$HERE/e2e.py" federator-check federator2 --node-b || \
  die "node B is up but its federator is not: see the lines above"

# ---------------------------------------------------------------------------
c_step "4. seed the genesis federation with real BTC"
# RSKIP419's fund tx pays 2 x 500 000 sat to the proposed federation out of the
# active federation's UTXOs. An empty federation cannot pay for its own handover.
$PY "$HERE/e2e.py" peg || die "the pre-peg-in failed"

c_step "5. real federation change, then the RSKIP419 SVP handover (2-of-3 votes)"
$PY "$HERE/e2e.py" federation || die "federation change failed"

# ---------------------------------------------------------------------------
c_step "6. attack: 40 ground Bitcoin txs + 1 honest victim peg-in"
if [ "$FROM" = "build" ] || [ "$FROM" = "federation" ] || [ "$FROM" = "attack" ]; then
  $PY "$HERE/e2e.py" attack || die "attack stage failed"
fi

# ---------------------------------------------------------------------------
c_step "7. measure while the window is open"

# the retiring federation is live for exactly 150 blocks (FederationRegTest
# Constants) and regtest mines one block per second, so attack + measurement has
# to fit in ~150 blocks. The attack spends ~40 of them, four samples 15 s apart
# spend 45 more: ~85 blocks, a comfortable margin.
$PY "$HERE/e2e.py" measure "t0"
for i in 1 2 3; do
  sleep 15
  $PY "$HERE/e2e.py" measure "t$i"
done

c_step "8. recovery: let the retiring federation expire"

$PY "$HERE/e2e.py" recover || die "recovery stage failed"

c_step "9. verdict"

$PY - <<PYEOF
import json, os
st = json.load(open(os.path.join("$STATE", "state.json")))
m = st["measurements"]
# the samples taken while the retiring federation was still live; if the window
# closed early the first of them is still a valid "inside the window" snapshot,
# and the last sample overall is the post-recovery one
during = next((x for x in m if x.get("retiring_present")), m[0])
after = m[-1]
ok = True

def check(label, cond, detail):
    global ok
    print(("  PASS  " if cond else "  FAIL  ") + label + "   " + detail)
    if not cond:
        ok = False

check("sampled inside the federation-change window",
      bool(during.get("retiring_present")),
      "retiring federation live, block %s" % during["rsk_block"])
check("victim peg-in frozen during the window",
      int(during["victim_balance_wei"]) == 0,
      "balance=%s wei" % during["victim_balance_wei"])
check("victim tx never marked processed during the window",
      int(during["victim_processed_height"]) < 0,
      "processedHeight=%s" % during["victim_processed_height"])
check("attack txs never marked processed (retry loop)",
      int(during["attacker_unprocessed"]) == 40,
      "%s/40 unprocessed" % during["attacker_unprocessed"])
check("victim credited after the window",
      int(after["victim_balance_wei"]) > 0,
      "balance=%s wei" % after["victim_balance_wei"])
check("attacker recovered the principal",
      int(after["attacker_balance_wei"]) > 0,
      "balance=%s wei" % after["attacker_balance_wei"])

print()
print("  " + ("OVERALL: PASS -- temporary freezing of funds, demonstrated end to end"
              if ok else "OVERALL: FAIL -- see the lines above"))
print("  evidence: $STATE/state.json")
print("  logs:     $LOGS/")
raise SystemExit(0 if ok else 1)
PYEOF

FINISHED=1
