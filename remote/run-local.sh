#!/usr/bin/env bash
# No runner, no queue: run the same pipeline right now and hand the agent the zip.
#   ./run-local.sh [target-dir]
# Then upload agent-bundle.tgz to the chat (drag & drop) or unzip it into the repo.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export TARGET_DIR="${1:-$PWD}"
export OUT="$here/agent-out"
echo "target: $TARGET_DIR"
"$here/job.sh"
echo
echo "now give this file to the agent: $here/agent-bundle.tgz"
echo "  unzip -l $here/agent-bundle.tgz   # what is inside"
