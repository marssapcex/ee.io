import glob, json, datetime
sections, total_pass, total_fail = {}, 0, 0
for f in sorted(glob.glob('poc/last_run.*.json')):
    name = f.split('.')[1]
    d = json.load(open(f))
    sections[name] = d
    total_pass += d.get('pass', 0)
    total_fail += d.get('fail', 0)
out = {
    "target": "tari-project/tari-ootle @ 3460b2ff19640c5a3b758de9ec407eac8e372044",
    "artefact": "@tari-project/ootle-wasm 0.48.0 (npm, 2026-10-29T12:11Z, commit 6a25dbc5)",
    "generated": datetime.datetime.utcnow().isoformat() + "Z",
    "totals": {"pass": total_pass, "fail": total_fail},
    "sections": sections,
}
json.dump(out, open('poc/audit.json', 'w'), indent=2)
print(json.dumps(out["totals"]))
