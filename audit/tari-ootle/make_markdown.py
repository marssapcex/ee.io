"""Render REPORT.md from the same content module that builds the PDF."""
import sys
sys.path.insert(0, "/home/user/ee.io/audit/tari-ootle")
from report_content import BLOCKS, COVER

out = []
out.append(f"# {COVER['title']} — {COVER['subtitle']}\n")
out.append(f"*{COVER['kicker']} · report date 2026-10-30*\n")
out.append(COVER["abstract"] + "\n")
out.append("| | |")
out.append("|---|---|")
for k, v in COVER["meta"]:
    out.append(f"| **{k}** | {v} |")
out.append("")
out.append("| Severity | Count |")
out.append("|---|---|")
for k, v in COVER["verdict"]:
    out.append(f"| {k} | {v} |")
out.append("")

for kind, payload in BLOCKS:
    if kind == "h1":
        out.append(f"\n## {payload}\n")
    elif kind == "h2":
        out.append(f"\n### {payload}\n")
    elif kind == "p":
        out.append(payload + "\n")
    elif kind == "bullets":
        out += [f"- {it}" for it in payload]
        out.append("")
    elif kind == "code":
        out.append("```")
        out.append(payload)
        out.append("```\n")
    elif kind == "note":
        out.append(f"> **Note.** {payload}\n")
    elif kind == "quote":
        out.append(f"> {payload}\n")
    elif kind == "kv":
        for k, v in payload:
            out.append(f"**{k}:** " + str(v).replace("\n", "  \n"))
        out.append("")
    elif kind == "table":
        header, rows = payload["header"], payload["rows"]
        out.append("| " + " | ".join(header) + " |")
        out.append("|" + "|".join(["---"] * len(header)) + "|")
        for r in rows:
            out.append("| " + " | ".join(str(c) for c in r) + " |")
        out.append("")
    elif kind == "coverage":
        for title, items, _ in payload:
            out.append(f"**{title}**\n")
            out += [f"- {it}" for it in items]
            out.append("")
    elif kind == "closing":
        out.append(f"**{payload['title']}.** {payload['body']}\n")
        out.append("| " + " | ".join(k for k, _ in payload["cols"]) + " |")
        out.append("|" + "|".join(["---"] * len(payload["cols"])) + "|")
        out.append("| " + " | ".join(v.replace("\n", " ") for _, v in payload["cols"]) + " |")
        out.append("")
    elif kind == "pagebreak":
        out.append("\n---\n")
    else:
        raise ValueError(kind)

out.append("\n## Appendix C — findings at a glance\n")
out.append("| ID | Finding | Severity | Status |")
out.append("|---|---|---|---|")
for r in COVER["glance"]:
    out.append("| " + " | ".join(r) + " |")

open("/home/user/ee.io/audit/tari-ootle/REPORT.md", "w").write("\n".join(out) + "\n")
print("wrote REPORT.md", len(out), "blocks")
