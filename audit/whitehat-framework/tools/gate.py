#!/usr/bin/env python3
"""Phase gate. Stops the audit from skipping ahead.

    python3 tools/gate.py runs/<target>/<stamp>            # all phases
    python3 tools/gate.py runs/<target>/<stamp> 4          # up to phase 4
    python3 tools/gate.py runs/<target>/<stamp> 6 --exec   # + actually run forge

Exit 1 with the reason. Phases are ordered; a later phase is only "open" when
every earlier one passes.
"""
import argparse
import glob
import os
import re
import subprocess
import sys

PHASES = [
    (0, "scope", ["00-scope.md", "scope.tsv"]),
    (1, "map", ["01-map.md"]),
    (2, "sweep", ["02-coverage.tsv", "02-files.md"]),
    (3, "invariants", ["03-invariants.md"]),
    (4, "match", ["04-match.md"]),
    (5, "trace", ["05-traces.md"]),
    (6, "prove", ["06-poc/run.log"]),
    (7, "report", ["07-report.md"]),
]
PASS_RE = re.compile(r"Suite result: ok|0 failed|\[PASS\]|Tests: ok")


def check(run, phase, run_poc=False):
    errs, warns = [], []
    for n, name, files in PHASES:
        if n > phase:
            break
        for f in files:
            p = os.path.join(run, f)
            if not os.path.exists(p):
                errs.append(f"phase {n} ({name}): missing {f}")
            elif os.path.getsize(p) == 0:
                errs.append(f"phase {n} ({name}): {f} is empty")
    if not errs and phase >= 2:
        cov = os.path.join(run, "02-coverage.tsv")
        rows = [l for l in open(cov, encoding="utf-8").read().splitlines() if l.strip() and not l.startswith("#")]
        if len(rows) < 5:
            errs.append("phase 2: 02-coverage.tsv has fewer than 5 rows - the whole repo was not swept")
        bad = [l for l in rows if len(l.split("\t")) < 3]
        if bad:
            errs.append(f"phase 2: {len(bad)} coverage rows do not have file<TAB>status<TAB>note")
        todo = [l for l in rows if l.split("\t")[1].strip() in ("todo", "")]
        if todo:
            errs.append(
                f"phase 2: {len(todo)} files still marked todo - "
                f"first: {todo[0].split(chr(9))[0]}"
            )
    if not errs and phase >= 4:
        txt = open(os.path.join(run, "04-match.md"), encoding="utf-8").read()
        if "corpus/incidents/" not in txt and "incidents/" not in txt:
            errs.append("phase 4: 04-match.md cites no corpus/incidents/<id>.json - the corpus was not read")
    if not errs and phase >= 5:
        tr = open(os.path.join(run, "05-traces.md"), encoding="utf-8").read()
        if tr.count("sink:") < 1:
            errs.append("phase 5: 05-traces.md has no `sink:` line - a trace without a sink is a guess")
        if tr.count("file:") < 1:
            errs.append("phase 5: 05-traces.md has no `file:` citation")
    if not errs and phase >= 6:
        log = os.path.join(run, "06-poc/run.log")
        body = open(log, encoding="utf-8", errors="replace").read()
        if not PASS_RE.search(body):
            errs.append("phase 6: 06-poc/run.log has no PASS marker (Suite result: ok / 0 failed / [PASS])")
        if not glob.glob(os.path.join(run, "06-poc", "*.t.sol")):
            errs.append("phase 6: no 06-poc/*.t.sol")
        if run_poc:
            import shutil
            if not shutil.which("forge"):
                errs.append("phase 6: --exec was passed but forge is not installed")
                return errs
            ok = True
            for f in glob.glob(os.path.join(run, "06-poc", "*.t.sol")):
                r = subprocess.run(["forge", "test", "--match-path", f, "-vv"], capture_output=True, text=True)
                open(log, "a", encoding="utf-8").write("\n$ forge test --match-path " + f + "\n" + r.stdout + r.stderr)
                if r.returncode != 0:
                    ok = False
            if not ok:
                errs.append("phase 6: forge test failed - a PoC that does not run is a LEAD, not a FINDING")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("phase", nargs="?", type=int, default=7)
    ap.add_argument("--exec", dest="exec_poc", action="store_true",
                    help="also execute forge on the PoCs in phase 6")
    a = ap.parse_args()
    errs = check(a.run, a.phase, a.exec_poc)
    if errs:
        print("GATE CLOSED")
        for e in errs:
            print(" -", e)
        return 1
    print(f"GATE OPEN through phase {a.phase}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
