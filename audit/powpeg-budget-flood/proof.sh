#!/usr/bin/env bash
# proof.sh -- ONE command, end-to-end proof of the bug. No docs needed.
#
#   ./proof.sh              # 6 targeted tests, ~20-40s (incremental)
#   ./proof.sh --budget     # also run the JVM 40-slot budget proof
#   ./proof.sh --all        # whole test classes (slower, more coverage)
#   ./proof.sh --fresh      # force re-apply patches + recompile
#
# Proves, on production classes:
#   1. the powpeg node SENDS a peg-in the Bridge will reject
#   2. the retiring federation's client DROPS that same entry
#   3. the entry is SENT AGAIN on the next turn
#   4. the Bridge REJECTS it (INVALID_AMOUNT, all live federations)
#   5. the rejection does NOT mark it processed  <-- why it retries forever
#   6. the same tx is CREDITED once the retiring federation is gone
#
# Exit code 0 only if every claim passes.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/powpeg-proof}"
PATCHES="$HERE/patches"
[ -d "$PATCHES" ] || PATCHES="$HERE/../patches"
RSKJ_COMMIT="1e95a3b039b2f2e12837400533e88dc4aedeefb8"
POWPEG_TAG="VETIVER-9.0.4.0"
WANT_BUDGET=0
FRESH=0
RUN_ALL=0
for a in "$@"; do
  case "$a" in
    --budget) WANT_BUDGET=1 ;;
    --fresh)  FRESH=1 ;;
    --all)    RUN_ALL=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

[ -f "$HERE/env.sh" ] && . "$HERE/env.sh"
[ -f "$HERE/repro/env.sh" ] && . "$HERE/repro/env.sh"
if ! java -version 2>&1 | grep -q 'version "17'; then
  for h in "$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home" \
           /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
           /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home; do
    [ -x "$h/bin/java" ] && export JAVA_HOME="$h" && export PATH="$h/bin:$PATH" && break
  done
fi

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "--------------------------------------------------------------"; }

# --- repos -------------------------------------------------------------
ensure_repo() {  # $1 dir, $2 url, $3 ref
  if [ ! -d "$1/.git" ]; then
    say "cloning $2 (one time, ~270 MB for rskj)"
    git clone -q "$2" "$1" || exit 1
  fi
  ( cd "$1" && git fetch -q origin >/dev/null 2>&1
    git checkout -q "$3" >/dev/null 2>&1 || true )
}

# --- patches -----------------------------------------------------------
apply_patch() {  # $1 repo, $2 patch
  local repo="$1" patch="$2"
  [ -f "$patch" ] || { say "!! missing patch $patch"; exit 1; }
  if ( cd "$repo" && git apply --reverse --check "$patch" >/dev/null 2>&1 ); then
    echo "  already applied: $(basename "$patch")"
    return 0
  fi
  if [ "$FRESH" = "1" ]; then ( cd "$repo" && git checkout -q -- . ); fi
  if ( cd "$repo" && git apply "$patch" >/dev/null 2>&1 ); then
    echo "  applied: $(basename "$patch")"
  else
    ( cd "$repo" && git checkout -q -- . && git apply "$patch" >/dev/null 2>&1 ) \
      && echo "  applied after reset: $(basename "$patch")" \
      || { say "!! cannot apply $(basename "$patch")"; exit 1; }
  fi
}

# --- gradle ------------------------------------------------------------
gradle() {  # $1 repo, rest = args
  local repo="$1"; shift
  ( cd "$repo" && ./gradlew --no-daemon --console=plain -x jacocoTestReport \
      -x checkstyleMain -x checkstyleTest "$@" )
}

# --- verdict -----------------------------------------------------------
verdict() {  # $1 xml dir, rest: "label|TestClass|method"  (method may be *)
  python3 - "$@" <<'PY'
import glob, os, sys, xml.etree.ElementTree as ET
args = sys.argv[1:]
xmldirs = [a for a in args if "|" not in a]
specs = [a for a in args if "|" in a]
rows, ok_all = [], True
cases = []
files = []
for d in xmldirs:
    files += glob.glob(os.path.join(d, "**", "TEST-*.xml"), recursive=True)
for path in files:
    try:
        root = ET.parse(path).getroot()
    except Exception:
        continue
    for tc in root.iter("testcase"):
        cases.append((tc.get("classname", ""), tc.get("name", ""),
                      tc.find("failure") is not None or tc.find("error") is not None))
for spec in specs:
    label, klass, method = spec.split("|")
    hits = [c for c in cases
            if klass.split(".")[-1] in c[0] and (method == "*" or method in c[1])]
    if not hits:
        rows.append((label, "NOT RUN", ""))
        ok_all = False
    elif any(c[2] for c in hits):
        rows.append((label, "FAIL", ""))
        ok_all = False
    else:
        rows.append((label, "PASS", "(%d case%s)" % (len(hits), "" if len(hits) == 1 else "s")))
w = max(len(r[0]) for r in rows) + 2
print()
print("=" * (w + 12))
print("%-*s %s" % (w, "CLAIM", "RESULT"))
print("=" * (w + 12))
for label, res, note in rows:
    print("%-*s %-6s %s" % (w, label, res, note))
print("=" * (w + 12))
print("OVERALL: %s" % ("PASS -- every claim holds" if ok_all else "FAIL -- see above"))
sys.exit(0 if ok_all else 1)
PY
}

# ======================================================================
say ""
say "powpeg-node / rskj  --  registerBtcTransaction budget starvation"
say "repos: $WORK      patches: $PATCHES"
hr

ensure_repo "$WORK/rskj"        https://github.com/rsksmart/rskj        "$RSKJ_COMMIT"
ensure_repo "$WORK/powpeg-node" https://github.com/rsksmart/powpeg-node  "$POWPEG_TAG"

say "[1/3] applying patches"
apply_patch "$WORK/rskj"        "$PATCHES/rskj-PegUtilsEvaluatePeginTest.patch"
apply_patch "$WORK/rskj"        "$PATCHES/rskj-BridgeSupportRejectedPeginTest.patch"
apply_patch "$WORK/powpeg-node" "$PATCHES/powpeg-node-BtcToRskClientTest.patch"

say ""
say "[2/3] running production code (rskj)"
rm -rf "$WORK/rskj/rskj-core/build/test-results/test"
if [ "$RUN_ALL" = "1" ]; then
  FILTER=( --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest'
           --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest' )
else
  FILTER=( --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest.evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount'
           --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest.evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered'
           --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest.registerBtcTransaction_whenPeginIsValidForActiveFedButBelowMinimumForRetiringFed_shouldRejectAndStayUnprocessed' )
fi
gradle "$WORK/rskj" :rskj-core:test "${FILTER[@]}" > "$WORK/rskj-run.log" 2>&1
RSKJ_RC=$?
if [ "$RSKJ_RC" != "0" ] && grep -q "No tests found for given includes" "$WORK/rskj-run.log"; then
  echo "  (method filter not supported here, falling back to whole classes)"
  gradle "$WORK/rskj" :rskj-core:test \
    --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest' \
    --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest' > "$WORK/rskj-run.log" 2>&1
  RSKJ_RC=$?
fi
tail -3 "$WORK/rskj-run.log" | sed 's/^/  /'
[ "$RSKJ_RC" != "0" ] && { echo "  --- last errors ---"; grep -E "FAILED|Exception|expected" "$WORK/rskj-run.log" | head -15 | sed 's/^/  /'; }

say ""
say "[3/3] running production code (powpeg-node)"
rm -rf "$WORK/powpeg-node/build/test-results/test"
if [ "$RUN_ALL" = "1" ]; then
  PFILTER=( --tests 'co.rsk.federate.BtcToRskClientTest' )
else
  PFILTER=( --tests '*BtcToRskClientTest*peginWithSubMinimumOutputToRetiringFed*' )
fi
gradle "$WORK/powpeg-node" test "${PFILTER[@]}" > "$WORK/powpeg-run.log" 2>&1
POWPEG_RC=$?
if [ "$POWPEG_RC" != "0" ] && grep -q "No tests found for given includes" "$WORK/powpeg-run.log"; then
  echo "  (method filter not supported here, falling back to the whole class)"
  gradle "$WORK/powpeg-node" test --tests 'co.rsk.federate.BtcToRskClientTest' > "$WORK/powpeg-run.log" 2>&1
  POWPEG_RC=$?
fi
tail -3 "$WORK/powpeg-run.log" | sed 's/^/  /'
[ "$POWPEG_RC" != "0" ] && { echo "  --- last errors ---"; grep -E "FAILED|Exception|expected" "$WORK/powpeg-run.log" | head -15 | sed 's/^/  /'; }

BUDGET_RC=0
if [ "$WANT_BUDGET" = "1" ]; then
  say ""
  say "[+] 40-slot budget proof on a real JVM (poc/run_poc.sh)"
  ( cd "$HERE/poc" && ./run_poc.sh ) > "$WORK/budget.log" 2>&1
  BUDGET_RC=$?
  grep -E "turn 1:|all 1764 turns:|bin index of" "$WORK/budget.log" | tail -4 | sed 's/^/  /'
fi

say ""
say "verdict"
V=( "node sends a peg-in the Bridge rejects|BtcToRskClientTest|updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_activeClient_shouldBeInformed"
    "retiring client drops the same entry|BtcToRskClientTest|updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_retiringClient_shouldNotBeInformed"
    "entry is re-sent on the next turn|BtcToRskClientTest|updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_isSentAgainOnNextTurn"
    "Bridge rejects with INVALID_AMOUNT|PegUtilsEvaluatePeginTest|evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount"
    "rejection does NOT mark it processed|BridgeSupportRejectedPeginTest|registerBtcTransaction_whenPeginIsValidForActiveFedButBelowMinimumForRetiringFed_shouldRejectAndStayUnprocessed"
    "same tx credited after the window|PegUtilsEvaluatePeginTest|evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered" )

verdict "$WORK/rskj/rskj-core/build/test-results/test" \
        "$WORK/powpeg-node/build/test-results/test" "${V[@]}"
VRC=$?

if [ "$WANT_BUDGET" = "1" ]; then
  if [ "$BUDGET_RC" = "0" ]; then say "40 ground wtxids exhaust the 40-slot budget: PASS"; else say "40 ground wtxids exhaust the 40-slot budget: FAIL (see $WORK/budget.log)"; VRC=1; fi
fi

say ""
say "logs: $WORK/rskj-run.log   $WORK/powpeg-run.log"
[ "$VRC" = "0" ] && exit 0 || exit 1
