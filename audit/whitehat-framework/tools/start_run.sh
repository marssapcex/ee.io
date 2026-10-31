#!/usr/bin/env bash
# Create a run directory pre-filled with the phase templates.
#   tools/start_run.sh <target-dir> [run-name]
# Then: python3 tools/triage.py <target-dir> --top 40 > "$RUN/04-triage-raw.tsv"
set -euo pipefail
target="${1:?usage: start_run.sh <target-dir> [run-name]}"
name="${2:-$(basename "$(cd "$target" && pwd)")}"
here="$(cd "$(dirname "$0")/.." && pwd)"
run="$here/runs/$name/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$run/06-poc"
cp "$here/templates/00-scope.md"   "$run/00-scope.md"
cp "$here/templates/01-map.md"     "$run/01-map.md"
cp "$here/templates/05-trace.md"   "$run/05-traces.md"
cp "$here/templates/poc.t.sol"     "$run/06-poc/poc.t.sol"
cp "$here/templates/07-report.md"  "$run/07-report.md"
: > "$run/scope.tsv"
: > "$run/02-coverage.tsv"
printf '# phase 2, one block per file\n' > "$run/02-files.md"
printf '# phase 3\n' > "$run/03-invariants.md"
printf '# phase 4\n' > "$run/04-match.md"
printf '# phase 6 log\n' > "$run/06-poc/run.log"
# seed the coverage ledger with the real in-scope file list, status = todo
( cd "$target" && find . -type f -name '*.sol' \
    -not -path '*/node_modules/*' -not -path '*/lib/*' -not -path '*/artifacts/*' \
    -not -path '*/cache/*' -not -path '*/out/*' -not -path '*/broadcast/*' \
    -not -path '*/coverage/*' -not -path '*/typechain*/*' \
    -not -path '*/interfaces/*' -not -path '*/mocks/*' -not -path '*/test/*' \
    -not -name '*.t.sol' -not -name '*Test*.sol' -not -name '*Mock*.sol' \
    | sed 's|^\./||' | awk -F'\t' '{print $1 "\ttodo\t"}' ) >> "$run/02-coverage.tsv"
echo "run: $run"
echo "in-scope files seeded: $(wc -l < "$run/02-coverage.tsv")"
echo
echo "next:"
echo "  python3 tools/triage.py '$target' --top 40 > '$run/04-triage-raw.tsv'"
echo "  \$EDITOR '$run/02-coverage.tsv'   # change todo -> read|skim|skip:<reason>"
echo "  python3 tools/gate.py '$run' 2"
