# Tari Ootle — stealth-path security assessment

Deliverable for the Tari Ootle security bug hunt (2026-10-01 .. 2026-11-01).

| File | What it is |
|---|---|
| `whitepaper/TariOotle_Stealth_Audit.pdf` | the report (11 pages) |
| `REPORT.md` | same content as Markdown, generated from `report_content.py` |
| `poc/stealth_audit.mjs` | 27 executable invariant checks, one section per process |
| `poc/dup_out.mjs` | PoC for F-01 (duplicate output commitments accepted) |
| `poc/audit.json`, `poc/last_run.*.json` | machine-readable results of every executed check |
| `poc/log.*.txt` | console logs quoted in the report |
| `poc/iso*.mjs`, `poc/memprobe.mjs` | isolation probes used while narrowing two observations |
| `poc/run_all.sh` | runs every section and re-aggregates `poc/audit.json` |
| `report_content.py` → `build_report.py`, `make_markdown.py` | the PDF / Markdown generators |

## Target

- repo `tari-project/tari-ootle` at `3460b2ff19640c5a3b758de9ec407eac8e372044`
- executable artefact `@tari-project/ootle-wasm` 0.48.0 (npm, 2026-10-29T12:11Z, built from `6a25dbc5`)

## Reproduce

```bash
npm i @tari-project/ootle-wasm@0.48.0        # into this directory
./poc/run_all.sh                             # expects 27/27 PASS + the F-01 acceptance line
python3 build_report.py                      # regenerate the PDF
python3 make_markdown.py                     # regenerate REPORT.md
```

The PDF build needs `fpdf2` and the DejaVu fonts (`/usr/share/fonts/truetype/dejavu`); it renders with no
network access.
