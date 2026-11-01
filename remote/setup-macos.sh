#!/usr/bin/env bash
# Registers THIS mac as an agent-executable runner for the audit repo.
#
#   ./setup-macos.sh            # install + register + run in foreground (Ctrl-C to stop)
#   ./setup-macos.sh --remove   # unregister and delete everything
#
# What you are consenting to: the agent can dispatch a job that runs remote/job.sh
# on your machine, with your user's permissions, for as long as this runner is up.
# Every command it can run is a committed file in the repo. Kill switch = Ctrl-C,
# or ./setup-macos.sh --remove, or turn off the runner in Settings > Actions > Runners.
set -euo pipefail
REPO="${REPO:-marssapcex/ee.io}"
LABEL="agent-exec"
DIR="$HOME/.agent-runner"

if [ "${1:-}" = "--remove" ]; then
  [ -d "$DIR" ] && ( cd "$DIR" && ./config.sh remove --token "$(gh api -X POST repos/$REPO/actions/runners/remove-token --jq .token)" ) || true
  rm -rf "$DIR"; echo "runner removed"; exit 0
fi

command -v gh >/dev/null || { echo "need gh cli: brew install gh"; exit 1; }
ARCH=$([ "$(uname -m)" = "arm64" ] && echo "arm64" || echo "x64")
VER=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"].lstrip("v"))')
mkdir -p "$DIR" && cd "$DIR"
[ -f actions-runner.tar.gz ] || {
  echo "downloading runner $VER ($ARCH)"
  curl -fsSL -o actions-runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v$VER/actions-runner-osx-$ARCH-$VER.tar.gz"
}
tar xzf actions-runner.tar.gz

TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)
./config.sh --url "https://github.com/$REPO" --token "$TOKEN" \
  --labels "$LABEL" --name "agent-exec-$HOSTNAME" --unattended --replace

echo
echo "runner registered. starting in foreground (Ctrl-C to stop):"
exec ./run.sh
