#!/usr/bin/env bash
# Runs ON THE OPERATOR'S MACHINE (self-hosted runner or by hand).
# Everything this script does is committed to git, so every command the agent can
# execute is visible in history. Nothing is fetched from the network at runtime
# except the target repo itself.
set -uo pipefail
OUT="${OUT:-$PWD/agent-out}"
mkdir -p "$OUT"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$OUT/agent.log"; }

log "host: $(uname -a)"
log "pwd: $PWD"

# --- 1. what is here
{ echo "== git"; git log -1 --format='%H %s' 2>/dev/null
  echo "== toolchain"
  for t in git node npm python3 pip3 forge cast anvil solc slither aderyn echidna-test medusa jq; do
    printf '%-12s ' "$t"; command -v "$t" >/dev/null && ("$t" --version 2>&1 | head -1) || echo "MISSING"
  done
} > "$OUT/toolchain.txt" 2>&1

# --- 2. the target repo (public: clone fresh; private: it is the working tree)
if [ -n "${TARGET_REPO:-}" ] && [ ! -d "${TARGET_DIR:-}" ]; then
  log "cloning $TARGET_REPO"
  git clone --depth 1 "${TARGET_REPO}" "${TARGET_DIR:-target}" >>"$OUT/agent.log" 2>&1
fi
T="${TARGET_DIR:-.}"
{ cd "$T" && echo "commit: $(git rev-parse HEAD 2>/dev/null)"
  find . -type f -name '*.sol' \
    -not -path '*/node_modules/*' -not -path '*/lib/*' -not -path '*/out/*' \
    -not -path '*/cache/*' -not -path '*/artifacts/*' | sort
} > "$OUT/sol-files.txt" 2>&1

# --- 3. static analysis, only if installed
(cd "$T" && slither . --print human-summary > "$OUT/slither.txt" 2>&1) || log "slither: not run"
(cd "$T" && aderyn --output "$OUT/aderyn.md" > /dev/null 2>&1)        || log "aderyn: not run"

# --- 4. build + tests, only if a framework is configured
if [ -f "$T/foundry.toml" ]; then
  (cd "$T" && forge build --sizes > "$OUT/forge-sizes.txt" 2>&1) || log "forge build failed"
  (cd "$T" && [ -d test ] && forge test -vv > "$OUT/forge-test.txt" 2>&1) || log "forge test: none/failed"
fi
if [ -f "$T/hardhat.config.js" ] || [ -f "$T/hardhat.config.ts" ]; then
  (cd "$T" && npx hardhat compile > "$OUT/hardhat.txt" 2>&1) || log "hardhat failed"
fi

# --- 5. the audit framework, if present, points at the target
if [ -f "$(dirname "$0")/../audit/whitehat-framework/tools/triage.py" ]; then
  python3 "$(dirname "$0")/../audit/whitehat-framework/tools/triage.py" "$T" --top 60 \
    > "$OUT/triage.tsv" 2>&1 || log "triage failed"
fi

# --- 6. bundle
( cd "$OUT" && tar czf ../agent-bundle.tgz . ) && log "bundle: $PWD/agent-bundle.tgz ($(du -h agent-bundle.tgz | cut -f1))"
