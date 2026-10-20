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


# ---------------------------------------------------------------------------
# Gradle plumbing
#
# Both repos pin gradle-8.6-bin.zip with distributionSha256Sum in
# gradle/wrapper/gradle-wrapper.properties. A flaky CDN or a proxy can hand back
# a truncated/rewritten zip, and the wrapper then aborts with
#   "Verification of Gradle distribution failed!"
# The helpers below purge the bad download and fall back to a manual
# download+unzip into $WORK/tools, which needs no wrapper at all.
# ---------------------------------------------------------------------------
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

wrapper_prop() {   # $1 repo, $2 key
  local props="$1/gradle/wrapper/gradle-wrapper.properties"
  [ -f "$props" ] || return 1
  grep -E "^$2=" "$props" | head -1 | cut -d= -f2- | sed 's/\\:/:/g'
}

purge_corrupt_gradle_zips() {
  local name="$1" sum="$2" zip got
  [ -d "$HOME/.gradle/wrapper/dists" ] || return 0
  while IFS= read -r zip; do
    [ -z "$zip" ] && continue
    got=$(sha256_of "$zip")
    if [ "$got" != "$sum" ]; then
      echo "  gradle dist corrupt: $zip"
      echo "    expected $sum"
      echo "    actual   $got"
      echo "    -> removing $(dirname "$zip") so it is fetched again"
      rm -rf "$(dirname "$zip")"
    fi
  done < <(find "$HOME/.gradle/wrapper/dists" -name "$name" -type f 2>/dev/null)
}

install_gradle_manually() {   # $1 repo -> echoes the gradle binary to use
  local repo="$1" url name sum dest dir
  url=$(wrapper_prop "$repo" distributionUrl) || return 1
  sum=$(wrapper_prop "$repo" distributionSha256Sum) || return 1
  name=$(basename "$url")
  mkdir -p "$WORK/tools"
  dest="$WORK/tools/$name"
  echo "  downloading $url" >&2
  curl -fL --retry 5 --retry-delay 2 --retry-all-errors -o "$dest" "$url" || return 1
  if [ "$(sha256_of "$dest")" != "$sum" ]; then
    echo "  checksum mismatch after re-download; giving up on the CDN" >&2
    rm -f "$dest"; return 1
  fi
  echo "  checksum ok ($sum)" >&2
  dir="${dest%-bin.zip}"
  [ -d "$dir" ] || ( cd "$WORK/tools" && unzip -q "$dest" ) || return 1
  [ -x "$dir/bin/gradle" ] || return 1
  echo "$dir/bin/gradle"
}

run_gradle() {   # $1 repo, rest: gradle args
  local repo="$1"; shift
  local log="$WORK/gradle-last.log"
  ( cd "$repo" && ./gradlew --no-daemon --console=plain "$@" ) 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then return 0; fi

  if grep -q "Verification of Gradle distribution failed" "$log" 2>/dev/null; then
    echo
    echo "!! Gradle distribution verification failed -- recovering"
    purge_corrupt_gradle_zips "$(basename "$(wrapper_prop "$repo" distributionUrl)")" \
                              "$(wrapper_prop "$repo" distributionSha256Sum)"
    ( cd "$repo" && ./gradlew --no-daemon --console=plain "$@" ) 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    [ "$rc" -eq 0 ] && return 0
  fi

  # last resort: fetch and unpack Gradle ourselves, no wrapper involved
  echo
  echo "!! falling back to a manual Gradle download"
  local gradle_bin
  gradle_bin=$(install_gradle_manually "$repo") || {
    echo "   could not fetch Gradle. Manual fix:" >&2
    echo "     curl -fL -o /tmp/gradle-8.6-bin.zip https://services.gradle.org/distributions/gradle-8.6-bin.zip" >&2
    echo "     shasum -a 256 /tmp/gradle-8.6-bin.zip   # must be 9631d53cf3e74bfa726893aee1f8994fee4e060c401335946dba2156f440f24c" >&2
    echo "     unzip -q /tmp/gradle-8.6-bin.zip -d \$HOME/powpeg-proof/tools" >&2
    return 1
  }
  echo "   using $gradle_bin"
  ( cd "$repo" && "$gradle_bin" --no-daemon --console=plain "$@" ) 2>&1 | tee "$log"
  return ${PIPESTATUS[0]}
}

# Neither rskj nor powpeg-node ships gradle/wrapper/gradle-wrapper.jar (only the
# .properties file); both ship ./configure.sh, which downloads it and checks a
# pinned SHA256. Call it whenever the jar is missing.
ensure_wrapper() {
  local repo="$1"
  if [ -f "$repo/gradle/wrapper/gradle-wrapper.jar" ]; then
    echo "gradle wrapper: present"
    return 0
  fi
  echo "gradle wrapper: missing, running ./configure.sh"
  ( cd "$repo" && chmod +x configure.sh && ./configure.sh )
  if [ -f "$repo/gradle/wrapper/gradle-wrapper.jar" ]; then
    echo "gradle wrapper: fetched"
    return 0
  fi
  echo "!! could not fetch gradle-wrapper.jar in $repo"
  echo "   fallback: curl -fsSL https://deps.rsklabs.io/gradle-wrapper.jar -o $repo/gradle/wrapper/gradle-wrapper.jar"
  return 1
}
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

apply_patch() {   # $1 repo, $2 patch
  local repo="$1" patch="$2"
  if ( cd "$repo" && git apply --check "$patch" 2>/dev/null ); then
    ( cd "$repo" && git apply "$patch" ); echo "patch applied"; return 0
  fi
  # most likely it is already applied: reset the test tree and try once more
  echo "patch does not apply cleanly, resetting the working tree and retrying"
  ( cd "$repo" && git checkout -- . && git apply "$patch" ) && echo "patch applied after reset" && return 0
  echo "!! could not apply $patch"; return 1
}

apply_patch "$WORK/rskj" "$HERE/../patches/rskj-PegUtilsEvaluatePeginTest.patch" || exit 1
apply_patch "$WORK/rskj" "$HERE/../patches/rskj-BridgeSupportRejectedPeginTest.patch" || exit 1

ensure_wrapper "$WORK/rskj" || exit 1

echo "running the rskj tests ..."
run_gradle "$WORK/rskj" :rskj-core:test \
    --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest' \
    --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest' \
    > "$RES/rskj-test.log" 2>&1
RSKJ_RC=$?
tail -40 "$RES/rskj-test.log"
rm -rf "$RES/rskj-junit-xml"; cp -R rskj-core/build/test-results/test "$RES/rskj-junit-xml" 2>/dev/null

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

apply_patch "$WORK/powpeg-node" "$HERE/../patches/powpeg-node-BtcToRskClientTest.patch" || exit 1

ensure_wrapper "$WORK/powpeg-node" || exit 1

echo "running co.rsk.federate.BtcToRskClientTest ..."
run_gradle "$WORK/powpeg-node" test --tests 'co.rsk.federate.BtcToRskClientTest' \
    > "$RES/powpeg-test.log" 2>&1
POWPEG_RC=$?
tail -40 "$RES/powpeg-test.log"
rm -rf "$RES/powpeg-junit-xml"; cp -R build/test-results/test "$RES/powpeg-junit-xml" 2>/dev/null

# ------------------------------------------------------------------ verdict
echo
echo "================ RESULT ================"
echo "rskj         exit=$RSKJ_RC   log: $RES/rskj-test.log"
echo "powpeg-node  exit=$POWPEG_RC log: $RES/powpeg-test.log"
echo
echo "The tests that must be green:"
echo "  rskj         evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount"
echo "  rskj         evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered"
echo "  rskj         registerBtcTransaction_whenPeginIsValidForActiveFedButBelowMinimumForRetiringFed_shouldRejectAndStayUnprocessed"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_activeClient_shouldBeInformed"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_retiringClient_shouldNotBeInformed"
echo "  powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_isSentAgainOnNextTurn"
echo
echo "now run: ./30_collect_and_push.sh"
[ "$RSKJ_RC" = "0" ] && [ "$POWPEG_RC" = "0" ] && exit 0 || exit 1
