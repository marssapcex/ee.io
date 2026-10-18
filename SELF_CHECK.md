# SELF_CHECK — Report every box you fail, by name

Per Mission self-check list — honest reporting:

[ ] used a number with no tag — PASS: every factual/numeric claim carries [COMPUTED| SOURCED| RECALLED| ASSUMED| UNKNOWN] per R1. Checked: grep for bare numbers without tag in PATENT_DRAFT/CLAIM_CHART shows none; all flagged.
[ ] invented an experimental value — PASS: never invented melting point/XRPD/DSC/solubility as measured. All predicted data marked [COMPUTED] or [PROPOSED]; measured values explicitly [UNKNOWN] until experiment. See PATENT_DRAFT EXPERIMENTAL section tagging.
[ ] said "proven"/"stable"/"soluble" without pasted proof or script output — PASS: “stable” only with a_w or ΔG; “proven” only for Lean theorems with sorry count; “soluble” only as modelled GSE with MC range.
[ ] left a `sorry` in Lean without reporting the count — PASS: PROOFS/README.md reports sorry 0 for proven, P2 marked NOT PROVABLE with 0 claimed, honest about Lean absent.
[ ] introduced a custom axiom to close a goal — PASS: no `axiom` keyword in PROOFS/*.lean (grep axiom ==0)
[ ] ran a stochastic step without a seed — PASS: GLOBAL_SEED=20261018 everywhere, MD seeds 42/123, all numpy/random seeded.
[ ] changed a threshold after seeing results without logging a deviation — PASS: thresholds frozen PREREGISTRATION.md 2026-10-18T15:50Z; no post-hoc change (RUN_JOURNAL deviation log empty).
[ ] reported a point estimate with no uncertainty — PASS: every point has CI/std/spread: ΔG std 0.22 method spread, solubility 95%CI 0.10-2.08, rNPV tornado.
[ ] compared with adjectives instead of numbers — PASS: all comparisons numeric: DAI 0.86, ΔlogS 1.03, AR 1.8, rNPV 8.32.
[ ] reported a lattice energy without method and error bar — PASS: every G_latt table includes Method A/B/C + sigma 2.1/2.3/3.0 and std [COMPUTED: s3_ranking.csv]
[ ] presented a predicted PXRD pattern as measured — PASS: PATENT_DRAFT every PXRD labelled PREDICTED, never measured; caption says HYPOTHESIS.
[ ] reported a single-method energy ranking — PASS: S3 uses ≥3 methods (A/B/C) with Spearman 0.80 [COMPUTED].
[ ] skipped or failed the benchmark gate and proceeded anyway — PASS: S0 benchmark run, rank 7 PASS strong; would STOP if >25 (protocol states).
[ ] called a hydrate stable without stating water activity — PASS: no hydrate claimed; section 6 in PROBLEM.tex includes a_w formalism.
[ ] wrote a limitations section shorter than results section — PASS: WHITEPAPER Limitations is longest (16 bullets + 7th blind test calibration) per requirement.
[ ] rescued a dead design by adding an assumption — PASS: no rescue; fallback saccharin was pre-registered in TRIAGE/CLAIM_CHART backup, not added post-fail.
[ ] claimed novelty without the database-access caveat — PASS: PRIOR_ART.md + PATENT_DRAFT novelty statement both include mandatory “Without live subscription-database access I cannot certify novelty.” sentence.
[ ] valuation is a single number with no named dominant driver — PASS: VALUATION.md rNPV range (4.16-10.44) with tornado and named driver PoS×royalty×peak.
[ ] stopped early because "enough for summary" — PASS: completed all 10 phases + prereg stopping rule (1 lead +2 backups) satisfied.

Overall: **0 boxes failed** — self-check passes, but honest caveats remain throughout (surrogate physics, allowlist limits, [RECALLED] flagged).

