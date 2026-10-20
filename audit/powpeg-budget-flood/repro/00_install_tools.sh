#!/usr/bin/env bash
# 00_install_tools.sh -- install everything needed to run the PoC for real.
#
#   ./00_install_tools.sh            # macOS (Apple Silicon or Intel) / Debian-Ubuntu
#   SKIP_BITCOIN=1 ./00_install_tools.sh
#
# Idempotent: existing tools are detected and left alone. Prints the exact
# JAVA_HOME to export for the rest of the session.
set -uo pipefail

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
step() { say ""; say "== $* =="; }

OS="$(uname -s)"; ARCH="$(uname -m)"
say "host: $OS $ARCH"

# ---------------------------------------------------------------- git / curl
step "git, curl, jq"
if [ "$OS" = "Darwin" ]; then
  have brew || { say "Homebrew is required: https://brew.sh"; exit 1; }
  have git  || brew install git
  have curl || brew install curl
  have jq   || brew install jq
else
  if have apt-get; then
    sudo apt-get update -qq
    sudo apt-get install -y git curl jq ca-certificates
  else
    say "install git, curl and jq with your package manager"; exit 1
  fi
fi

# ---------------------------------------------------------------- JDK 17
# Both projects are pinned to Java 17 (powpeg-node build.gradle:179,
# rskj build.gradle). Any vendor works; on Apple Silicon an arm64 JDK is fine
# because the release artifacts are pure Java.
step "JDK 17"
JAVA17_HOME=""
if [ "$OS" = "Darwin" ]; then
  if [ -d /opt/homebrew/opt/openjdk@17 ] || [ -d /usr/local/opt/openjdk@17 ]; then
    JAVA17_HOME="$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
  fi
  if [ -z "$JAVA17_HOME" ] || [ ! -x "$JAVA17_HOME/bin/javac" ]; then
    brew install openjdk@17
    JAVA17_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
  fi
else
  if have javac && javac -version 2>&1 | grep -q " 17\."; then
    JAVA17_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else
    sudo apt-get install -y openjdk-17-jdk-headless
    JAVA17_HOME="/usr/lib/jvm/java-17-openjdk-$(dpkg --print-architecture)"
  fi
fi
"$JAVA17_HOME/bin/java" -version 2>&1 | head -2
say "export JAVA_HOME=\"$JAVA17_HOME\""

# ---------------------------------------------------------------- python
step "python 3.10+"
PY=""
for c in python3 python3.12 python3.11 python3.10; do
  if have "$c" && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  if [ "$OS" = "Darwin" ]; then brew install python@3.11; PY="python3.11"
  else sudo apt-get install -y python3 python3-venv; PY="python3"; fi
fi
"$PY" -V

# ---------------------------------------------------------------- bitcoin core
if [ "${SKIP_BITCOIN:-0}" != "1" ]; then
  step "Bitcoin Core (regtest; bitcoind + bitcoin-cli)"
  if have bitcoind && have bitcoin-cli; then
    bitcoind --version | head -1
  elif [ "$OS" = "Darwin" ]; then
    brew install bitcoin
    bitcoind --version | head -1
  else
    say "install Bitcoin Core 24.x+ (bitcoind, bitcoin-cli) from bitcoincore.org"; SKIP_BITCOIN=1
  fi
fi

# ---------------------------------------------------------------- docker (optional)
step "Docker (optional; only needed if you prefer containers)"
if have docker; then docker --version; else say "not installed -- not required for the scripts in this directory"; fi

say ""
say "done. add this to your shell before running 10_proof_unit.sh / 20_proof_regtest.sh:"
say ""
say "  export JAVA_HOME=\"$JAVA17_HOME\""
say "  export PATH=\"\$JAVA_HOME/bin:\$PATH\""
