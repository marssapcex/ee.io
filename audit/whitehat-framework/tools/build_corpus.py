#!/usr/bin/env python3
"""Build the incident corpus from kismp123/DeFi-Security-Incident.

Parses every incident markdown into a machine-readable record:
  corpus/incidents/<id>.json    metadata + vuln/fixed code + attack steps
  corpus/classes/<class>.md     per-class primitive checklist + worst incidents
  corpus/patterns.jsonl         one line per incident: signals to grep for
  corpus/INDEX.md               human table (date, protocol, chain, loss, class)
  corpus/provenance.json        repo + commit + build time (nothing is invented)

Stdlib only. Re-runnable: `python3 tools/build_corpus.py`.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "corpus", ".source")
OUT = os.path.join(ROOT, "corpus")
REPO = "https://github.com/kismp123/DeFi-Security-Incident"

# classes that are not code bugs - kept in the index, excluded from the pattern set
NON_CODE = {"private-key-compromise", "weak-randomness", "mev-sandwich"}

FIELD_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*$")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
ADDR_RE = re.compile(r"0x[a-fA-F0-9]{6,40}")
CODE_RE = re.compile(r"```[a-zA-Z0-9_+-]*\n(.*?)```", re.S)
USD_RE = re.compile(r"\$\s?([0-9][0-9,\.]*)")
FUNC_RE = re.compile(r"function\s+([A-Za-z_]\w*)")
CALL_RE = re.compile(r"\.\s*([A-Za-z_]\w{2,})\s*\(")
IDENT_RE = re.compile(r"\b([A-Za-z_]\w{2,})\b")

# words that carry no signal when grepping a target repo
STOP = set("""function returns return public external internal private view pure payable memory
calldata storage uint uint256 uint128 uint64 uint32 int int256 address bool bytes bytes32 string
true false require if else for while emit event modifier constructor override virtual constant
immutable msg sender value block timestamp number chainid this now new delete mapping struct
library contract interface import pragma solidity let const var the and that with from have
this that with into than then when which while where also such only more most some any all""".split())

SAFETY_TOKENS = {
    "delegatecall": 3, "call{": 2, "staticcall": 2, "tx.origin": 4, "selfdestruct": 3,
    "approve": 1, "transferFrom": 2, "balanceOf": 1, "totalSupply": 2, "mulDiv": 3,
    "mulDivUp": 3, "mulDivDown": 2, "getReserves": 3, "slot0": 3, "latestRoundData": 3,
    "getPrice": 2, "initialize": 3, "onlyOwner": 1, "hasRole": 1, "nonReentrant": 2,
    "safeTransfer": 1, "swap": 1, "flashLoan": 2, "onFlashLoan": 3, "uniswapV3SwapCallback": 3,
    "uniswapV2Call": 3, "execute": 1, "withdraw": 1, "deposit": 1, "shares": 2,
    "convertToAssets": 3, "previewRedeem": 2, "upgradeTo": 2, "initialize(": 3,
}


def sh(*args):
    return subprocess.run(args, cwd=SRC, capture_output=True, text=True).stdout.strip()


def ensure_source():
    if os.path.isdir(os.path.join(SRC, ".git")):
        return
    print("cloning corpus source ...")
    os.makedirs(os.path.dirname(SRC), exist_ok=True)
    subprocess.run(["git", "clone", "--depth", "1", REPO, SRC], check=True)


def clean(s):
    s = LINK_RE.sub(lambda m: m.group(1), s)
    return s.strip().strip("|").strip()


def parse_meta(text):
    meta = {}
    for line in text.splitlines():
        m = FIELD_RE.match(line.strip())
        if m:
            meta[m.group(1).strip().lower()] = clean(m.group(2))
    return meta


def parse_sections(text):
    out, cur, buf = {}, "intro", []
    for line in text.splitlines():
        if line.startswith("## "):
            out[cur] = "\n".join(buf).strip()
            cur, buf = line[3:].strip(), []
        else:
            buf.append(line)
    out[cur] = "\n".join(buf).strip()
    return out


def tidy_date(raw):
    """'2026-06-09 20:00:00 UTC (news broke ~2026-06-10)' -> '2026-06-09'."""
    if not raw:
        return None
    m = re.search(r"(\d{4})-(\d{2})-?(\d{2})?", raw)
    if not m:
        m2 = re.search(r"(\d{4})", raw)
        return m2.group(1) if m2 else None
    y, mo, d = m.group(1), m.group(2), m.group(3) or "01"
    return f"{y}-{mo}-{d}"


def tidy_protocol(raw):
    """'TOP / "Token of Power" governance - an Aragon DAO on Ethereum.' -> 'TOP'."""
    if not raw:
        return None
    s = re.split(r"\s+[—-]\s+|\s*\(|,\s+(?:an?|the)\s", raw)[0]
    s = s.strip(" .,")
    return (s[:60] or raw[:60])


def _date_from(rel):
    """No Date field? Take it from the path: 2024/2024-05-12_Foo.md -> 2024-05-12."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", rel)
    if m:
        return "-".join(m.groups())
    m = re.search(r"(\d{4})-(\d{2})/", rel)
    if m:
        return m.group(1) + "-" + m.group(2) + "-01"
    m = re.search(r"^(\d{4})/", rel)
    return m.group(1) + "-01-01" if m else None


def _proto_from(rel, title):
    """No Protocol field? Use the filename stem, else the title before the dash."""
    stem = rel.rsplit("/", 1)[-1][:-3]
    parts = stem.split("_")
    if len(parts) >= 2:
        return parts[1][:40]
    return (re.split(r"\s+[—-]\s+", title)[0] or "")[:40] or None


def parse_loss(raw):
    if not raw:
        return None
    m = USD_RE.search(raw.replace(",", ""))
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def code_blocks(text):
    return [b.strip() for b in CODE_RE.findall(text)]


def split_before_after(blocks):
    before, after, other = [], [], []
    for b in blocks:
        has_bad, has_good = "❌" in b, "✅" in b
        if has_bad and not has_good:
            before.append(b)
        elif has_good and not has_bad:
            after.append(b)
        elif has_bad and has_good:
            # mixed block: split on the markers
            for part in re.split(r"(?=❌|✅)", b):
                if "❌" in part:
                    before.append(part.strip())
                elif "✅" in part:
                    after.append(part.strip())
        else:
            other.append(b)
    return before, after, other


def signals_of(code, klass):
    """Identifiers worth grepping for in a target repo, with weights."""
    sig = {}
    for fn in FUNC_RE.findall(code):
        sig[fn] = max(sig.get(fn, 0), 4)
    for tok, w in SAFETY_TOKENS.items():
        if tok.rstrip("(") in code:
            sig[tok.rstrip("(")] = max(sig.get(tok, 0), w)
    for call in CALL_RE.findall(code):
        if call not in STOP:
            sig[call] = max(sig.get(call, 0), 2)
    for ident in IDENT_RE.findall(code):
        if ident not in STOP and len(ident) > 4 and ident.lower() == ident.lower():
            sig.setdefault(ident, 1)
    # keep the sharpest 24
    top = sorted(sig.items(), key=lambda kv: -kv[1])[:24]
    return [{"token": t, "weight": w} for t, w in top]


def attack_steps(sections):
    txt = ""
    for k, v in sections.items():
        if "attack flow" in k.lower() or "exploit" in k.lower():
            txt += "\n" + v
    steps = []
    for line in txt.splitlines():
        s = re.sub(r"[│├└┌┐┘─┬┴┼╔╗╚╝║═]", " ", line).strip()
        s = re.sub(r"\s+", " ", s).strip(" |")
        if len(s) < 12 or set(s) <= set("-|=+ ."):
            continue
        if re.match(r"^(step\s*)?\d+[\).\s:-]", s, re.I) or "→" in s or "->" in s or "•" in s:
            s = s.replace("•", "-")
            if s not in steps:
                steps.append(s[:300])
    return steps[:20]


def main():
    ensure_source()
    sha = sh("git", "rev-parse", "HEAD")
    os.makedirs(os.path.join(OUT, "incidents"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "classes"), exist_ok=True)

    # 1. class index (authoritative) : incident path -> [class]
    classes = {}
    for name in sorted(os.listdir(os.path.join(SRC, "vulns"))):
        if not name.endswith(".md") or name == "README.md":
            continue
        klass = name[:-3]
        body = open(os.path.join(SRC, "vulns", name), encoding="utf-8").read()
        for m in re.finditer(r"\]\(\.\./([^)]+\.md)\)", body):
            classes.setdefault(m.group(1), []).append(klass)

    incidents, patterns = [], []
    files = []
    for dirpath, _, names in os.walk(SRC):
        if "/.git" in dirpath or dirpath.endswith("/vulns"):
            continue
        for n in names:
            if n.endswith(".md") and n != "README.md":
                files.append(os.path.relpath(os.path.join(dirpath, n), SRC))
    files.sort()

    for rel in files:
        text = open(os.path.join(SRC, rel), encoding="utf-8").read()
        meta = parse_meta(text)
        sections = parse_sections(text)
        title = text.splitlines()[0].lstrip("# ").strip() if text.startswith("#") else rel
        blocks = code_blocks(text)
        before, after, other = split_before_after(blocks)
        step = attack_steps(sections)
        klass = classes.get(rel, []) or ["other"]
        iid = rel[:-3].replace("/", "__")
        rec = {
            "id": iid,
            "source_file": rel,
            "title": title,
            "date": tidy_date(meta.get("date")) or _date_from(rel),
            "protocol": tidy_protocol(meta.get("protocol")) or _proto_from(rel, title),
            "chain": (meta.get("chain") or "").split(" /")[0].split(" (")[0][:40] or None,
            "loss_raw": meta.get("loss"),
            "loss_usd": parse_loss(meta.get("loss")),
            "root_cause": meta.get("root cause"),
            "attack_tx": meta.get("attack tx") or meta.get("representative transaction"),
            "vulnerable_contract": meta.get("vulnerable contract")
            or meta.get("vulnerable contract (replica proxy)")
            or meta.get("vulnerable contracts"),
            "classes": klass,
            "code_before": [b[:3000] for b in before][:3],
            "code_after": [b[:2000] for b in after][:2],
            "steps": step,
            "other_code": [b[:800] for b in other][:2],
        }
        incidents.append(rec)
        with open(os.path.join(OUT, "incidents", iid + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)

        code = "\n".join(before) or "\n".join(other) or text[:3000]
        if not any(c in NON_CODE for c in klass):
            patterns.append(
                {
                    "id": iid,
                    "classes": klass,
                    "protocol": rec["protocol"],
                    "chain": rec["chain"],
                    "loss_usd": rec["loss_usd"],
                    "root_cause": rec["root_cause"],
                    "signals": signals_of(code, klass[0] if klass else ""),
                    "code_shape": [re.sub(r"\s+", " ", l)[:120] for l in code.splitlines() if "❌" in l][:6],
                }
            )

    with open(os.path.join(OUT, "patterns.jsonl"), "w", encoding="utf-8") as f:
        for p in patterns:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    # per-class pages
    by_class = {}
    for rec in incidents:
        for c in rec["classes"]:
            by_class.setdefault(c, []).append(rec)
    for c, recs in sorted(by_class.items()):
        recs = sorted(recs, key=lambda r: -(r["loss_usd"] or 0))
        lines = [f"# {c}", "", f"{len(recs)} incidents.", "", "## Worst first", "",
                 "| date | protocol | chain | loss | root cause | file |", "|---|---|---|---|---|---|"]
        for r in recs[:40]:
            loss = f"${r['loss_usd']:,.0f}" if r["loss_usd"] else (r["loss_raw"] or "?")
            rc = (r["root_cause"] or "").replace("|", "/")[:160]
            lines.append(f"| {r['date']} | {r['protocol']} | {r['chain']} | {loss} | {rc} | `{r['id']}.json` |")
        with open(os.path.join(OUT, "classes", c + ".md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    # index
    inc_sorted = sorted(incidents, key=lambda r: (r["date"] or "0"), reverse=True)
    total = sum(r["loss_usd"] or 0 for r in incidents)
    lines = ["# Incident index", "",
             f"{len(incidents)} incidents, {len(patterns)} patterns, "
             f"${total:,.0f} of quoted losses.", "",
             "| date | protocol | chain | loss | class |", "|---|---|---|---|---|"]
    for r in inc_sorted:
        loss = f"${r['loss_usd']:,.0f}" if r["loss_usd"] else (r["loss_raw"] or "?")
        lines.append(
            f"| {r['date']} | {r['protocol']} | {r['chain']} | {loss} | "
            f"{', '.join(r['classes'])} |"
        )
    with open(os.path.join(OUT, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    prov = {
        "source": REPO,
        "commit": sha,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "incidents": len(incidents),
        "patterns": len(patterns),
        "classes": sorted(by_class),
        "note": "Every record is derived from a file in source_file; nothing is generated content.",
    }
    with open(os.path.join(OUT, "provenance.json"), "w", encoding="utf-8") as f:
        json.dump(prov, f, indent=1)
    print(json.dumps({k: prov[k] for k in ("commit", "incidents", "patterns")}, indent=1))
    print("classes:", len(by_class))


if __name__ == "__main__":
    sys.exit(main())
