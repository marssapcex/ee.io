#!/usr/bin/env bash
# fix_gradle.sh -- recover from "Verification of Gradle distribution failed!".
#
#   ./fix_gradle.sh
#
# Both repos pin gradle-8.6-bin.zip by sha256 in
# gradle/wrapper/gradle-wrapper.properties:
#   9631d53cf3e74bfa726893aee1f8994fee4e060c401335946dba2156f440f24c
# A flaky CDN or a proxy can return a truncated file, and the wrapper refuses it.
# This script removes every cached copy whose hash is wrong, then downloads the
# zip itself, verifies the same hash and unpacks it next to the other tools.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/powpeg-proof}"
URL="https://services.gradle.org/distributions/gradle-8.6-bin.zip"
SUM="9631d53cf3e74bfa726893aee1f8994fee4e060c401335946dba2156f440f24c"
ZIP="$WORK/tools/gradle-8.6-bin.zip"
DIR="$WORK/tools/gradle-8.6"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

echo "== 1. purging cached Gradle distributions with a wrong hash =="
if [ -d "$HOME/.gradle/wrapper/dists" ]; then
  found=0
  while IFS= read -r zip; do
    [ -z "$zip" ] && continue
    got="$(sha256_of "$zip")"
    if [ "$got" != "$SUM" ]; then
      echo "  removing $(dirname "$zip")"
      echo "    expected $SUM"
      echo "    actual   $got"
      rm -rf "$(dirname "$zip")"
      found=1
    fi
  done < <(find "$HOME/.gradle/wrapper/dists" -name 'gradle-8.6-bin.zip' -type f 2>/dev/null)
  [ "$found" = "0" ] && echo "  nothing corrupt cached"
else
  echo "  no wrapper cache yet"
fi

echo
echo "== 2. downloading Gradle 8.6 and verifying the hash =="
mkdir -p "$WORK/tools"
if [ -f "$ZIP" ] && [ "$(sha256_of "$ZIP")" = "$SUM" ]; then
  echo "  already present and correct: $ZIP"
else
  rm -f "$ZIP"
  for attempt in 1 2 3; do
    echo "  attempt $attempt"
    if curl -fL --retry 5 --retry-delay 2 --retry-all-errors \
            --http1.1 -C - -o "$ZIP" "$URL"; then
      got="$(sha256_of "$ZIP")"
      if [ "$got" = "$SUM" ]; then
        echo "  checksum ok"
        break
      fi
      echo "  wrong hash ($got), retrying"
      rm -f "$ZIP"
    fi
  done
fi

if [ ! -f "$ZIP" ] || [ "$(sha256_of "$ZIP")" != "$SUM" ]; then
  echo
  echo "!! could not obtain a clean gradle-8.6-bin.zip"
  echo "   check your network / proxy, or use a mirror:"
  echo "     https://downloads.gradle.org/distributions/gradle-8.6-bin.zip"
  exit 1
fi

echo
echo "== 3. unpacking =="
rm -rf "$DIR"
unzip -q "$ZIP" -d "$WORK/tools" && echo "  $DIR/bin/gradle"

cat > "$HERE/env.sh.gradle" <<EOF
export GRADLE_BIN="$DIR/bin/gradle"
EOF

echo
echo "done. the proof script falls back to this binary automatically;"
echo "if you want to run Gradle by hand:"
echo "  \"$DIR/bin/gradle\" --no-daemon --console=plain :rskj-core:test --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest'"
