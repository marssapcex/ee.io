#!/usr/bin/env python3
"""Score a target Solidity repo against the incident corpus.

    python3 tools/triage.py <target-repo> [--top 40] [--min-score 10] [--file f.sol]

For every in-scope .sol file it intersects the identifiers found in the file
with the `signals` of each of the ~797 corpus patterns and prints a ranked
candidate list. A hit is NOT a bug: it is a pointer to the incident you must
read next, in the order of the score. Proof still has to be built (phase 6).

Stdlib only.
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "corpus")

EXCLUDE_DIRS = {
    "node_modules", "lib", "out", "cache", "artifacts", "broadcast", "coverage",
    "typechain", "typechain-types", ".git", "dependencies", "vendor",
}
EXCLUDE_DIR_HINTS = ("/interfaces/", "/mocks/", "/test/", "/tests/")
EXCLUDE_NAMES = (".t.sol", "Test.sol", "Mock.sol")

TOKEN_RE = re.compile(r"[A-Za-z_]\w{2,}")
LINE_COMMENT = re.compile(r"//[^\n]*")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)


def in_scope(path, root):
    rel = "/" + os.path.relpath(path, root).replace(os.sep, "/")
    if any(d in rel.split("/") for d in EXCLUDE_DIRS):
        return False
    if any(h in rel for h in EXCLUDE_DIR_HINTS):
        return False
    if any(n in os.path.basename(path) for n in EXCLUDE_NAMES):
        return False
    return True


def sol_files(root):
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in EXCLUDE_DIRS]
        for n in fns:
            if n.endswith(".sol"):
                p = os.path.join(dp, n)
                if in_scope(p, root):
                    out.append(p)
    return sorted(out)


def tokens_of(text):
    t = BLOCK_COMMENT.sub(" ", LINE_COMMENT.sub(" ", text))
    return set(TOKEN_RE.findall(t))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--min-score", type=float, default=8.0)
    ap.add_argument("--rare-pct", type=float, default=12.0,
                    help="a token is 'rare' if it appears in <= this %% of files")
    ap.add_argument("--min-hits", type=int, default=3)
    ap.add_argument("--file", default=None, help="only this file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    pats = []
    path = os.path.join(CORPUS, "patterns.jsonl")
    if not os.path.exists(path):
        sys.exit("no corpus/patterns.jsonl - run tools/build_corpus.py first")
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                pats.append(json.loads(line))
    # pre-compute signal weights
    for p in pats:
        p["_sig"] = {s["token"]: s["weight"] for s in p["signals"]}

    files = [args.file] if args.file else sol_files(args.target)
    if not files:
        sys.exit("no in-scope .sol files under " + args.target)

    # pass 1: token sets + document frequency, so that `balanceOf`/`mint`/`deposit`
    # (present in nearly every file) stop outranking a real match.
    toks_of, df = {}, {}
    for fp in files:
        try:
            text = open(fp, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        t = tokens_of(text)
        if not t:
            continue
        toks_of[fp] = t
        for tok in t:
            df[tok] = df.get(tok, 0) + 1
    n = max(len(toks_of), 1)
    import math

    def idf(tok):
        return math.log((n + 1) / (df.get(tok, 1) + 1)) + 1.0

    rows, class_score = [], {}
    rare_cut = max(3, int(n * args.rare_pct / 100))
    for fp, toks in toks_of.items():
        for p in pats:
            hits = [(t, w) for t, w in p["_sig"].items() if t in toks]
            if len(hits) < args.min_hits:
                continue
            scored = [(t, w * idf(t)) for t, w in hits]
            score = sum(v for _, v in scored)
            # a match needs something that is actually specific to this repo area:
            # either a rare identifier, or a sharp API token (function name, delegatecall...)
            rare = [t for t, w in hits if df.get(t, 0) <= rare_cut]
            sharp = [t for t, w in hits if w >= 4]
            if not rare and not sharp:
                continue
            if score < args.min_score:
                continue
            top_tokens = [t for t, _ in sorted(scored, key=lambda x: -x[1])[:8]]
            rows.append(
                {
                    "score": round(score, 1),
                    "hits": len(hits),
                    "pattern": p["id"],
                    "classes": ",".join(p["classes"]),
                    "protocol": p["protocol"],
                    "root_cause": (p["root_cause"] or "")[:150],
                    "file": os.path.relpath(fp, args.target),
                    "tokens": " ".join(top_tokens),
                    "rare_tokens": " ".join(sorted(rare)[:6]),
                }
            )
            for c in p["classes"]:
                class_score[c] = class_score.get(c, 0) + score * (p["loss_usd"] or 1) ** 0.25

    rows.sort(key=lambda r: -r["score"])
    top = rows[: args.top]

    if args.json:
        print(json.dumps({"candidates": top, "files_scanned": len(files)}, indent=1))
        return

    print(f"# triage: {args.target}")
    print(f"# files scanned: {len(files)}   patterns: {len(pats)}   candidates: {len(rows)}")
    print("# A hit means READ THAT INCIDENT. It is not a finding.")
    print()
    print("score\thits\tclass\tfile\tspecific tokens\tincident")
    for r in top:
        print(
            f"{r['score']}\t{r['hits']}\t{r['classes']}\t{r['file']}\t"
            f"{r['rare_tokens'] or r['tokens']}\t{r['pattern']}"
        )
    print()
    print("## per module: which incident classes to read first")
    per_file = {}
    for r in rows:
        for c in r["classes"].split(","):
            per_file.setdefault(r["file"], {}).setdefault(c, 0.0)
            per_file[r["file"]][c] += r["score"]
    for f, cs in sorted(per_file.items(), key=lambda kv: -max(kv[1].values()))[:15]:
        best = sorted(cs.items(), key=lambda kv: -kv[1])[:3]
        print(f"{f}\t" + "  ".join(f"{c}({v:,.0f})" for c, v in best))

    print()
    print("## class ranking (score x loss-weight)")
    for c, v in sorted(class_score.items(), key=lambda kv: -kv[1])[:8]:
        n = sum(1 for r in rows if c in r["classes"])
        print(f"{c}\t{v:,.0f}\t{n} candidate rows")


if __name__ == "__main__":
    main()
