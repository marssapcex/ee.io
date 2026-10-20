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
#  Stages:  build -> bitcoind -> rskj -> federation change -> powpeg
#           -> attack -> measure -> recovery
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
BTC_RPC="http://127.0.0.1:18443"
BTC_USER=rsk
BTC_PASS=rsk
KEEP=0
CHECK=0
FROM=build

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --check) CHECK=1 ;;
    --from) FROM="$2"; shift ;;
    --work) WORK="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
  esac
  shift
done

mkdir -p "$WORK" "$STATE" "$LOGS"
export WORK STATE RSK_RPC BTC_RPC BTC_USER BTC_PASS E2E_STATE="$STATE"

c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_bad()  { printf '\033[31m%s\033[0m\n' "$*"; }
c_step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

die() { c_bad "FAILED: $*"; exit 1; }

# ---------------------------------------------------------------------------
c_step "0. preflight"

if ! java -version 2>&1 | grep -q 'version "17'; then
  for h in "$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home" \
           /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
           /usr/lib/jvm/java-17-openjdk-amd64; do
    if [ -x "$h/bin/java" ]; then
      export JAVA_HOME="$h"; export PATH="$h/bin:$PATH"; break
    fi
  done
fi
java -version 2>&1 | head -1 | sed 's/^/  /'
java -version 2>&1 | grep -q 'version "17' || die "need JDK 17"

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
c_step "1. build rskj + powpeg-node"

REPOS="${REPOS:-$HOME/ee.io}"
mkdir -p "$REPOS"
[ -d "$REPOS/rskj/.git" ]        || git clone -q https://github.com/rsksmart/rskj "$REPOS/rskj"
[ -d "$REPOS/powpeg-node/.git" ] || git clone -q https://github.com/rsksmart/powpeg-node "$REPOS/powpeg-node"

( cd "$REPOS/rskj" && git fetch -q origin && git checkout -q "$RSKJ_COMMIT" ) || die "rskj checkout"
( cd "$REPOS/powpeg-node" && git fetch -q origin && git checkout -q "$POWPEG_TAG" ) || die "powpeg checkout"

RSKJ_JAR=$(ls "$REPOS"/rskj/rskj-core/build/libs/*-all.jar 2>/dev/null | head -1)
if [ -z "${RSKJ_JAR:-}" ]; then
  echo "  building rskj (this is the slow part, once ~8 min)"
  ( cd "$REPOS/rskj" && ./configure.sh >/dev/null 2>&1; ./gradlew --no-daemon --console=plain :rskj-core:fatJar -x test ) \
    > "$LOGS/build-rskj.log" 2>&1 || die "rskj build failed, see $LOGS/build-rskj.log"
  RSKJ_JAR=$(ls "$REPOS"/rskj/rskj-core/build/libs/*-all.jar 2>/dev/null | head -1)
fi
[ -n "${RSKJ_JAR:-}" ] || die "rskj fat jar not found"
echo "  rskj        $(basename "$RSKJ_JAR")"

POWPEG_JAR=$(ls "$REPOS"/powpeg-node/build/libs/*-all.jar 2>/dev/null | head -1)
if [ -z "${POWPEG_JAR:-}" ]; then
  echo "  building powpeg-node (once ~4 min)"
  ( cd "$REPOS/powpeg-node" && ./configure.sh >/dev/null 2>&1; ./gradlew --no-daemon --console=plain fatJar -x test ) \
    > "$LOGS/build-powpeg.log" 2>&1 || die "powpeg build failed, see $LOGS/build-powpeg.log"
  POWPEG_JAR=$(ls "$REPOS"/powpeg-node/build/libs/*-all.jar 2>/dev/null | head -1)
fi
[ -n "${POWPEG_JAR:-}" ] || die "powpeg fat jar not found"
echo "  powpeg-node $(basename "$POWPEG_JAR")"

# ---------------------------------------------------------------------------
cleanup() {
  [ "$KEEP" = "1" ] && { echo "  --keep: leaving nodes running"; return; }
  echo
  echo "  stopping nodes"
  [ -n "${POWPEG_PID:-}" ] && kill "$POWPEG_PID" 2>/dev/null
  [ -n "${RSKJ_PID:-}" ]   && kill "$RSKJ_PID" 2>/dev/null
  bitcoin-cli -regtest -datadir="$WORK/btc" -rpcuser=$BTC_USER -rpcpassword=$BTC_PASS stop >/dev/null 2>&1
  sleep 2
}
trap cleanup EXIT

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
c_step "3. rskj regtest node"

AUTH_A_KEY=$($PY -c "import sys;sys.path.insert(0,'$HERE');from e2e import keccak256;print(keccak256(b'auth-a').hex())")
AUTH_B_KEY=$($PY -c "import sys;sys.path.insert(0,'$HERE');from e2e import keccak256;print(keccak256(b'auth-b').hex())")

cat > "$WORK/rskj.conf" <<EOF
blockchain.config.name = "regtest"

rpc {
    providers {
        web {
            http {
                enabled = true
                bind_address = "127.0.0.1"
                port = 4444
                hosts = [ "*" ]
            }
        }
    }
}

# accounts are objects with a privateKey field, not bare strings
wallet {
    enabled = true
    accounts = [
        { privateKey = "$AUTH_A_KEY" },
        { privateKey = "$AUTH_B_KEY" }
    ]
}

miner {
    server.enabled = true
    client {
        enabled = true
        delayBetweenBlocks = 1 second
    }
    coinbase.secret = "auth-a"
}

database {
    dir = "$WORK/rskj-db"
}
EOF

rm -rf "$WORK/rskj-db"

java -Drsk.conf.file="$WORK/rskj.conf" -cp "$RSKJ_JAR" co.rsk.Start --regtest \
     > "$LOGS/rskj.log" 2>&1 &
RSKJ_PID=$!
echo "  rskj pid $RSKJ_PID, waiting for RPC"
for i in $(seq 1 120); do
  if $PY -c "
import json,sys,urllib.request
try:
    r=urllib.request.urlopen(urllib.request.Request('$RSK_RPC',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(),headers={'Content-Type':'application/json'}),timeout=2)
    print(json.loads(r.read())['result']); sys.exit(0)
except Exception: sys.exit(1)" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
$PY -c "
import json,urllib.request
r=urllib.request.urlopen(urllib.request.Request('$RSK_RPC',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(),headers={'Content-Type':'application/json'}),timeout=5)
print('  rskj up, block', int(json.loads(r.read())['result'],16))" || {
  c_bad "  rskj did not answer on 4444. last lines of $LOGS/rskj.log:"
  tail -30 "$LOGS/rskj.log" | sed 's/^/    /'
  die "rskj startup failed"
}

# ---------------------------------------------------------------------------
if [ "$FROM" = "build" ] || [ "$FROM" = "federation" ]; then
  c_step "4. real federation change (2-of-3 votes from auth-a/auth-b)"
  $PY "$HERE/e2e.py" federation || die "federation change failed"
fi

# ---------------------------------------------------------------------------
c_step "5. powpeg-node (federator of the NEW federation)"

$PY - <<PYEOF > "$WORK/fed1.key"
import sys
sys.path.insert(0, "$HERE")
from e2e import keccak256
print(keccak256(b"e2e-fed-1").hex())
PYEOF
chmod 400 "$WORK/fed1.key"

cat > "$WORK/powpeg.conf" <<EOF
federator {
    enabled = true

    signers {
        BTC { type = "keyFile"  path = "$WORK/fed1.key" }
        RSK { type = "keyFile"  path = "$WORK/fed1.key" }
        MST { type = "keyFile"  path = "$WORK/fed1.key" }
    }

    bitcoinPeerAddresses = [ "127.0.0.1:18444" ]
    gasPrice = 0
}

rsk {
    host = "127.0.0.1"
    port = 4444
}
EOF

java -Drsk.conf.file="$WORK/powpeg.conf" -cp "$POWPEG_JAR" \
     co.rsk.federate.FederateRunner --regtest --reset \
     > "$LOGS/powpeg.log" 2>&1 &
POWPEG_PID=$!
echo "  powpeg pid $POWPEG_PID"
sleep 25
if ! kill -0 "$POWPEG_PID" 2>/dev/null; then
  c_bad "  powpeg-node exited; last lines:"
  tail -25 "$LOGS/powpeg.log"
  die "powpeg-node did not stay up"
fi
echo "  powpeg-node is running"

# ---------------------------------------------------------------------------
if [ "$FROM" = "build" ] || [ "$FROM" = "federation" ] || [ "$FROM" = "attack" ]; then
  c_step "6. attack: 40 ground Bitcoin txs + 1 honest victim peg-in"
  $PY "$HERE/e2e.py" attack || die "attack stage failed"
fi

# ---------------------------------------------------------------------------
c_step "7. measure while the window is open"

$PY "$HERE/e2e.py" measure "t0"
for i in 1 2 3; do
  sleep 40
  $PY "$HERE/e2e.py" measure "t$i"
done

c_step "8. recovery: let the retiring federation expire"

$PY "$HERE/e2e.py" recover || die "recovery stage failed"

c_step "9. verdict"

$PY - <<PYEOF
import json, os
st = json.load(open(os.path.join("$STATE", "state.json")))
m = st["measurements"]
during = m[0]
after = m[-1]
ok = True

def check(label, cond, detail):
    global ok
    print(("  PASS  " if cond else "  FAIL  ") + label + "   " + detail)
    if not cond:
        ok = False

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
