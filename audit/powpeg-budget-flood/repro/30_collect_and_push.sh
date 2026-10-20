#!/usr/bin/env bash
# 30_collect_and_push.sh -- collect everything you produced and push it back.
#
#   ./30_collect_and_push.sh              # collect + print a summary
#   PUSH=1 ./30_collect_and_push.sh       # collect + commit + push to this branch
#
# The collected files land in results/ and are small (logs + junit xml + json).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/results"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

echo "== collecting =="
mkdir -p "$OUT"
if [ -d "$OUT" ]; then
  echo "unit:    $(ls -1 "$OUT/unit" 2>/dev/null | tr '\n' ' ')"
  echo "regtest: $(ls -1 "$OUT/regtest" 2>/dev/null | tr '\n' ' ')"
fi

# junit xml -> one-line summary
python3 - "$OUT" <<'PYEOF'
import glob, os, sys, xml.etree.ElementTree as ET
root = sys.argv[1]
rows = []
for path in glob.glob(os.path.join(root, "**", "TEST-*.xml"), recursive=True):
    try:
        t = ET.parse(path).getroot()
    except Exception:
        continue
    rows.append((os.path.basename(path), int(t.get("tests", 0)),
                 int(t.get("failures", 0)), int(t.get("errors", 0))))
if rows:
    print("\n== junit summary ==")
    for name, tests, fails, errs in rows:
        print("  %-70s tests=%d failures=%d errors=%d" % (name, tests, fails, errs))
    print("  total: %d tests, %d failures, %d errors"
          % (sum(r[1] for r in rows), sum(r[2] for r in rows), sum(r[3] for r in rows)))
else:
    print("\n(no junit xml found yet -- run 10_proof_unit.sh)")
PYEOF

SUMMARY="$OUT/SUMMARY-$STAMP.md"
{
  echo "# PoC run $STAMP"
  echo
  echo "host: $(uname -s) $(uname -m), java: $(java -version 2>&1 | head -1)"
  echo
  echo "## files"
  find "$OUT" -type f ! -name 'SUMMARY-*' | sed "s|$OUT|results|"
  echo
  echo "## unit test verdicts"
  grep -hE "evaluatePegin_|updateBridgeBtcTransactions_peginWithSubMinimum"
       "$OUT"/unit/*.log 2>/dev/null | tail -20 || true
  echo
  echo "## regtest evidence"
  cat "$OUT"/regtest/regtest_attack.log 2>/dev/null || echo "(not run)"
} > "$SUMMARY"
echo
echo "summary written to ${SUMMARY#$REPO/}"

if [ "${PUSH:-0}" = "1" ]; then
  BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  echo
  echo "== committing and pushing to $BRANCH =="
  git -C "$REPO" add audit/powpeg-budget-flood/repro/results
  git -C "$REPO" -c user.name="proof-bot" -c user.email="proof@local" \
      commit -m "proof: real run $STAMP (unit results + regtest evidence)" || echo "nothing to commit"
  git -C "$REPO" push origin "$BRANCH"
else
  echo
  echo "to push the results back for review:"
  echo "  PUSH=1 ./30_collect_and_push.sh"
fi
