"""SHA256 manifest of every result file — one-command reproducibility"""
import hashlib, pathlib, csv
files = [
    "CANDIDATES.csv",
    "FUNNEL/s0_benchmark.csv","FUNNEL/S0_REPORT.md","FUNNEL/s1_geometry.csv","FUNNEL/s2_prerank.csv",
    "FUNNEL/s3_ranking.csv","FUNNEL/s4_thermal.csv","FUNNEL/s5_md.csv","FUNNEL/s6_property.csv",
    "FUNNEL/s7_comparison.csv","FUNNEL/FUNNEL_RESULTS.csv",
    "UNCERTAINTY/mc_samples.csv","UNCERTAINTY/summary.json","UNCERTAINTY/bayes.json",
    "VALUATION.json","ENV_REPORT.md","TRIAGE.md","PRIOR_ART.md","PROBLEM.tex","PATENT_DRAFT.md",
    "CLAIM_CHART.md","VALUATION.md","REDTEAM.md","PROOFS/P1_existence_min.lean","PROOFS/P3_enumeration_completeness.lean",
    "PROOFS/README.md","WHITEPAPER.pdf"
]
manifest=[]
for p in files:
    path=pathlib.Path(p)
    if path.exists():
        h=hashlib.sha256(path.read_bytes()).hexdigest()
        manifest.append((p,h))
    else:
        manifest.append((p,"MISSING"))
with open("SHA256_MANIFEST.csv","w",newline="") as f:
    w=csv.writer(f)
    w.writerow(["file","sha256"])
    w.writerows(manifest)
print("manifest written")
for p,h in manifest:
    print(f"{h}  {p}")
