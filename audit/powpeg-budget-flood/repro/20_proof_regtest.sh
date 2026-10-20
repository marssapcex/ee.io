#!/usr/bin/env bash
# 20_proof_regtest.sh -- PROOF 2: run the flood against a live rskj + powpeg-node
# regtest stack that YOU started (the script does not start the stack; see
# README.md for the exact commands, including the federation change).
#
#   ./20_proof_regtest.sh
#   BTC_RPC=http://127.0.0.1:18332 RSK_RPC=http://127.0.0.1:4444 ./20_proof_regtest.sh
#
# Requires: a retiring federation live on the chain (a federation change in
# progress). The script tells you if it is missing and exits with code 2.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BTC_RPC="${BTC_RPC:-http://127.0.0.1:18332}"
RSK_RPC="${RSK_RPC:-http://127.0.0.1:4444}"
BTC_USER="${BTC_USER:-rsk}"
BTC_PASS="${BTC_PASS:-rsk}"
NODE_LOG="${NODE_LOG:-}"
COUNT="${COUNT:-40}"
RES="$HERE/results/regtest"
mkdir -p "$RES"

# shellcheck disable=SC1091
[ -f "$HERE/env.sh" ] && . "$HERE/env.sh"

PY="${PY:-python3}"
"$PY" -c 'import coincurve' 2>/dev/null || {
  echo "cookiecutter: installing coincurve into a local venv"
  "$PY" -m venv "$HERE/.venv" && "$HERE/.venv/bin/pip" -q install coincurve
  PY="$HERE/.venv/bin/python"
}

echo "== self-test of the transaction builder (no node needed) =="
"$PY" "$HERE/regtest_attack.py" --self-test || exit 1

echo
echo "== checking the stack =="
if ! "$PY" - "$BTC_RPC" "$BTC_USER" "$BTC_PASS" <<'PYEOF'
import sys, json, base64, urllib.request
url, user, pw = sys.argv[1], sys.argv[2], sys.argv[3]
body = json.dumps({"jsonrpc":"2.0","id":1,"method":"getblockchaininfo","params":[]}).encode()
req = urllib.request.Request(url, data=body, headers={"Content-Type":"application/json",
      "Authorization":"Basic "+base64.b64encode(f"{user}:{pw}".encode()).decode()})
try:
    info = json.loads(urllib.request.urlopen(req, timeout=10).read())["result"]
    print("bitcoind: chain=%s height=%d" % (info["chain"], info["blocks"]))
    sys.exit(0 if info["chain"] == "regtest" else 1)
except Exception as exc:
    print("bitcoind not reachable (%s)" % exc)
    sys.exit(1)
PYEOF
then
  echo "start bitcoind -regtest first (see README.md), then re-run"; exit 2
fi

if ! "$PY" - "$RSK_RPC" <<'PYEOF'
import sys, json, urllib.request
url = sys.argv[1]
body = json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}).encode()
try:
    height = json.loads(urllib.request.urlopen(urllib.request.Request(
        url, data=body, headers={"Content-Type":"application/json"}), timeout=10).read())["result"]
    print("rskj: block %d" % int(height, 16))
    sys.exit(0)
except Exception as exc:
    print("rskj not reachable (%s)" % exc)
    sys.exit(1)
PYEOF
then
  echo "start rskj -regtest and powpeg-node first (see README.md), then re-run"; exit 2
fi

echo
echo "== running the flood =="
"$PY" "$HERE/regtest_attack.py" \
  --btc-rpc "$BTC_RPC" --btc-user "$BTC_USER" --btc-pass "$BTC_PASS" \
  --rsk-rpc "$RSK_RPC" ${NODE_LOG:+--node-log "$NODE_LOG"} --count "$COUNT"
RC=$?

echo
echo "results in $RES"
echo "next: ./30_collect_and_push.sh"
exit $RC
