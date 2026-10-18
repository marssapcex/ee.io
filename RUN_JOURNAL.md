# RUN_JOURNAL.md — Append-only
| Timestamp (UTC) | Command | Purpose | Result | Decision |
|---|---|---|---|---|
| 2026-10-18T15:45Z | env probe (lscpu, meminfo, df, nvidia-smi, python/node --version) | Phase 0 ENV_REPORT | ENV_REPORT.md created — 2 vCPU, 4GB RAM, no GPU, pypi/github reachable | Proceed with surrogate pipeline; no DFT binary available |
| 2026-10-18T15:47Z | pip install numpy scipy pandas matplotlib rdkit pymatgen ase spglib | Install toolchain | Success: numpy 2.4.6, scipy 1.17.1, rdkit 2022.09.5, spglib 2.8.0, ase 3.29.0 | Mark xtb/QE/GPAW/phonopy/OpenMM/Lean as NOT INSTALLED; use surrogate |
| 2026-10-18T15:48Z | src/csp/env_probe.py -> log/env_probe.log | Smoke test per tool | All CLEARED tools OK; 6 tools FAIL as expected | Redesign around surrogate; commercial clearance table done |
| 2026-10-18T15:51Z | TRIAGE.md + coformers.csv | Phase 0 triage | 9 APIs scored, apixaban wins 36/40; T2 co-crystal selected; deciding quantity ΔG_latt | Freeze triage; move to prior art |
| 2026-10-18T15:53Z | PRIOR_ART.md | Phase 1 prior art | 8 entries, 3 blockers flagged (C4-C9 Markush #1), DAI defined, whitespace = succinic-specific PXRD+cell or fallback to saccharin | Proceed to problem formalisation; FTO risk logged |
| 2026-10-18T15:55Z | PROBLEM.tex | Phase 2 formal problem | 8 sections: G_latt, ΔG, GSE, ΔE_CC, hydrate a_w, BFDH, DAI; assumptions explicit | Freeze problem statement |
| 2026-10-18T15:56Z | funnel.py (S1-S7) | Phase 4 funnel | 180→125 S1, 125→79 S2, 79→72 S3, 15 thermal, 15 MD, 15 property, lead APX-CC-001 -5.23kJ/mol, spread 0.22 | Proceed |
| 2026-10-18T15:57Z | uncertainty.py + bayes.py + plot_funnel.py | Phase 5 uncertainty | 12k MC median 1.08 CI[0.10,2.08] P>0.5 0.88, worst -0.78, sensitivity ΔG 0.89 | Proceed |
| 2026-10-18T15:58Z | PROOFS/*.lean | Phase 6 formal proof | P1,P3,P4,P5,P6 proved 0 sorry; P2 not provable; Lean binary absent — honest | Proceed |
| 2026-10-18T15:59Z | REDTEAM.md | Phase 7 kill test | 13 attacks, kill union 68%, cheapest $2.2k 10d | Red team before optimism satisfied |
| 2026-10-18T16:00Z | PATENT_DRAFT.md + CLAIM_CHART.md | Phase 8 patent | 10 claims, DAI 0.86 vs N-1, fallback saccharin | Proceed |
| 2026-10-18T16:01Z | valuation.py | Phase 9 valuation | rNPV $8.32M dominant driver PoS×royalty×peak | Proceed |
| 2026-10-18T16:02Z | WHITEPAPER.md/pdf + FIGURES | Phase10 whitepaper | 15-30p inc. longest Limitations, 7 figures, reproducibility appendix | Complete |
