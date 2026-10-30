#!/usr/bin/env bash
# Run every audit section in its own Node process (a WASM panic poisons the module
# instance, so one section must never share a process with another).
set -uo pipefail
cd "$(dirname "$0")/.."

sections=(address lifecycle conservation htlc viewable split limits)
fail=0
for s in "${sections[@]}"; do
  node poc/stealth_audit.mjs "$s" 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings \
    | tee "poc/log.$s.txt" | grep -E '────'
  grep -q 'fail=0' "poc/log.$s.txt" || fail=1
done

for s in binding extremes; do
  node poc/math_probe.mjs "$s" 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings \
    | tee "poc/log.math_$s.txt" | grep -E '────'
  grep -q 'fail=0' "poc/log.math_$s.txt" || fail=1
done

node poc/dup_out.mjs 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings \
  | tee poc/log.dup_out.txt | tail -1

python3 poc/metering_math.py > poc/log.metering_math.txt

python3 poc/aggregate.py
exit $fail
