#!/usr/bin/env bash
# 10_proof_unit.sh -- PROOF 1: run the real powpeg-node and rskj code under test.
#
#   export JAVA_HOME=...           (see 00_install_tools.sh)
#   ./10_proof_unit.sh
#
# What this does:
#   1. clones rskj at the audited commit and powpeg-node at the release tag,
#   2. applies the two patches in ../patches,
#   3. runs ONLY the affected test classes with Gradle,
#   4. copies the logs and the JUnit XML into ./results/.
#
# This executes production code: BtcToRskClient.updateBridgeBtcTransactions(),
# BtcToRskClient.shouldSendTx(), PegUtils.isValidPegInTx() and
# rskj PegUtils.evaluatePegin(). Nothing in the decision path is re-implemented.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/powpeg-proof}"
RES="$HERE/results/unit"
RSKJ_COMMIT="1e95a3b039b2f2e12837400533e88dc4aedeefb8"
POWPEG_TAG="VETIVER-9.0.4.0"

mkdir -p "$WORK" "$RES"

# pick up JAVA_HOME / PYTHON written by 00_install_tools.sh
# shellcheck disable=SC1091
[ -f "$HERE/env.sh" ] && . "$HERE/env.sh"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing $1 (run 00_install_tools.sh)"; exit 1; }; }
need git; need java
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "$JAVA_MAJOR" = "17" ] || echo "WARNING: java $JAVA_MAJOR detected, both projects expect 17"

# ------------------------------------------------------------------ rskj
echo
echo "== rskj @ $RSKJ_COMMIT =="
if [ ! -d "$WORK/rskj/.git" ]; then
  git clone https://github.com/rsksmart/rskj "$WORK/rskj" || exit 1
fi
cd "$WORK/rskj" || exit 1
git fetch -q --all --tags
git checkout -q "$RSKJ_COMMIT" || { echo "cannot check out $RSKJ_COMMIT"; exit 1; }
echo "HEAD: $(git rev-parse --short HEAD)"

if git apply --check "$HERE/../patches/rskj-PegUtilsEvaluatePeginTest.patch" 2>/dev/null; then
  git apply "$HERE/../patches/rskj-PegUtilsEvaluatePeginTest.patch"
  echo "patch applied"
else
  echo "patch already applied (or conflicts -- run: git checkout -- .) "
fi

echo "running co.rsk.peg.PegUtilsEvaluatePeginTest ..."
./gradlew --no-daemon :rskj-core:test \
    --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest' \
    2>&1 | tee "$RES/rskj-test.log" | tail -40
RSKJ_RC=${PIPESTATUS[0]}
cp -R rskj-core/build/test-results/test "$RES/rskj-junit-xml" 2>/dev/null

# ------------------------------------------------------------------ powpeg-node
echo
echo "== powpeg-node @ $POWPEG_TAG =="
if [ ! -d "$WORK/powpeg-node/.git" ]; then
  git clone https://github.com/rsksmart/powpeg-node "$WORK/powpeg-node" || exit 1
fi
cd "$WORK/powpeg-node" || exit 1
git fetch -q --all --tags
git checkout -q "$POWPEG_TAG" || exit 1
echo "HEAD: $(git rev-parse --short HEAD)"

if git apply --check "$HERE/../patches/powpeg-node-BtcToRskClientTest.patch" 2>/dev/null; then
  git apply "$HERE/../patches/powpeg-node-BtcToRskClientTest.patch"
  echo "patch applied"
else
  echo "patch already applied (or conflicts -- run: git checkout -- .)"
fi

# the pinned gradle wrapper is not in the repo; configure.sh fetches it
[ -f gradle/wrapper/gradle-wrapper.jar ] || ./configure.sh

echo "running co.rsk.federate.BtcToRskClientTest ..."
./gradlew --no-daemon test \
    --tests 'co.rsk.federate.BtcToRskClientTest' \
    2>&1 | tee "$RES/powpeg-test.log" | tail -40
POWPEG_RC=${PIPESTATUS[0]}
cp -R build/test-results/test "$RES/powpeg-junit-xml" 2>/dev/null

# ------------------------------------------------------------------ verdict
echo
echo "================ RESULT ================"
echo "rskj         exit=$RSKJ_RC   log: $RES/rskj-test.log"
echo "powpeg-node  exit=$POWPEG_RC log: $RES/powpeg-test.log"
echo
echo "The tests that must be green:"
echo "  rskj         evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount"
echo "  rskj         evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_activeClient_shouldBeInformed"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_retiringClient_shouldNotBeInformed"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_isSentAgainOnNextTurn"
echo
echo "now run: ./30_collect_and_push.sh"
[ "$RSKJ_RC" = "0" ] && [ "$POWPEG_RC" = "0" ] && exit 0 || exit 1
