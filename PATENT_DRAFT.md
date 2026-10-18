# PATENT_DRAFT.md — Draft Specification (provisional-quality, NOT FILED)

## Title
**Novel Co-Crystal of Apixaban and Succinic Acid, Pharmaceutical Composition Thereof, and Preparation Method** — [PROPOSED]

## Field
This invention relates to solid forms of Factor Xa inhibitor apixaban (BMS-562247), specifically a 1:1 co-crystal with succinic acid providing improved dissolution [COMPUTED: FUNNEL/s6_property.csv -> delta_logS 1.03 → 10.7×].

## Background — Real Citations

- Apixaban compound: US 6,967,208 (BMS, prio 2001) [RECALLED]
- Apixaban polymorphs Forms N-1 (anhydrate) and H2-2 (hydrate) characterised by PXRD peaks at 6.6, 7.1, 10.0, 12.4±0.2° [RECALLED: WO 2007/030582]
- Generic polymorph filings claim single forms with narrow 5-peak lists [RECALLED]
- Potential blocking filing WO 2018/071 alleging dicarboxylic acid C4-C9 co-crystals [RECALLED — unverified; included as putative art]
- FDA co-crystal guidance: co-crystals treated as polymorphs for ANDA if dissociation shown in vivo [SOURCED: FDA 2018 (2026-10-18)]
- Blind-test calibration: DFT-D ranking error up to 15 places, thermal corrections 4.7-5.9 kJ/mol [SOURCED: 7th CSP blind test (2024) (2026-10-18)]

## Summary

A crystalline 1:1 co-crystal of apixaban (1-(4-methoxyphenyl)-7-oxo-6-(4-(2-oxopiperidin-1-yl)phenyl)-4,5,6,7-tetrahydro-1H-pyrazolo[3,4-c]pyridine-3-carboxamide) and succinic acid (butanedioic acid, GRAS [SOURCED: 21 CFR 184.1091 (2026-10-18)]) is disclosed, with triclinic P-1 unit cell a=7.12Å b=10.84Å c=14.02Å α=82.1° β=85.3° γ=79.2°±0.05Å/±0.5°, PXRD peaks at 2θ 7.82, 11.24, 14.61, 17.92, 22.34±0.2° (CuKα, λ=1.5418Å) [COMPUTED: FUNNEL/s6_property.csv -> PXRD_2theta_pred_deg -> 7.82,11.24...; unit_cell_pred -> a=7.12], predicted ΔG_CC = -5.23 kJ/mol (with Fvib) [COMPUTED: FUNNEL/s4_thermal.csv -> -5.227], and aqueous solubility gain ΔlogS=1.03±0.51 vs Form N-1 [COMPUTED: UNCERTAINTY/summary.json -> q50 1.08].

Back-up embodiments: 1:1 apixaban·saccharin (P-1) [COMPUTED: APX-CC-169 -> PXRD 8.47,11.67,14.87,18.07,21.27] and 1:1 apixaban·nicotinamide (P-1) [COMPUTED: APX-CC-085 -> 8.82,12.02,15.22,18.43] preserve FTO if dicarboxylic genus is granted.

## Detailed Description — ENABLED Preparation Route

**Example 1 (prophetic, to be performed):** [PROPOSED: lab protocol, not yet measured]

1. Weigh apixaban Form N-1 (459.5 mg, 1.00 mmol) [SOURCED: MW 459.5] and succinic acid (118.1 mg, 1.00 mmol) [SOURCED: coformers.csv]. Place in 10 mL stainless jar with 2× 5mm steel balls.
2. Add 50 µL acetonitrile/methanol 1:1 (solvent-drop) — both ICH Q3C Class 2/3.
3. Mill in Retsch MM400 at 30 Hz for 30 min at 298 K [PROPOSED].
4. Scrape, slurry in 4 mL same solvent (saturated in both components) with seeding (1 mg of prior CC powder) at 298 K, stir 24 h.
5. Filter, wash with 1 mL cold MTBE, dry under vacuum 12 h at 40°C.

**Characterisation (PREDICTED, not measured — every datum labelled):**

- **PXRD (predicted):** peaks at 2θ = 7.82 (vs), 11.24 (s), 14.61 (m), 17.92 (m), 22.34 (w) ±0.2° with relative intensities est. from structure factor [COMPUTED: src/csp/pxrd.py -> FUNNEL/s6_property.csv -> PXRD]. Measured pattern must be obtained — predicted pattern is a HYPOTHESIS, not proof [ASSUMED].
- **Unit cell (predicted):** a=7.12 b=10.84 c=14.02 Å α=82.1 β=85.3 γ=79.2° P-1 Z=2 [COMPUTED: FUNNEL/s6_property.csv -> unit_cell_pred].
- **DSC (predicted):** onset 212°C [COMPUTED: FUNNEL/s6_property.csv -> MP 212] vs N-1 237°C [RECALLED]. Must be measured — MP prediction error 20-40K expected [SOURCED: MP benchmarks (2026-10-18)].
- **Thermal stability:** ΔG_CC = -4.61 kJ/mol (static) [COMPUTED: FUNNEL/s3_ranking.csv -> -4.607] and -5.23 kJ/mol with Fvib [COMPUTED: FUNNEL/s4_thermal.csv -> -5.227], spread across 3 methods σ=0.22 kJ/mol [COMPUTED: s3 -> std 0.22], method sigma 2.1/2.3/3.0 [ASSUMED]. Ranking survives Fvib [COMPUTED: s4 -> flips 0].
- **Solubility (modelled):** logS_CC = -2.33 vs logS_N1 = -3.36 (GSE) → gain 10.7× [COMPUTED: FUNNEL/s6_property.csv -> 10.7]. With MP sweep 180-260°C, gain 0.10–2.08 95% CI [COMPUTED: UNCERTAINTY/summary.json -> 0.10,2.08]. IDR proportional to S per Noyes-Whitney [ASSUMED].
- **Morphology (predicted):** BFDH aspect ratio 1.8 isometric [COMPUTED: FUNNEL/s6_property.csv -> 1.8], vs N-1 needles AR ~4.5 [RECALLED] — filterability improved.

**Ranges and Embodiments:**

- Stoichiometry 1:1 (preferred), 1:2, 2:1 disclosed but only 1:1 reduced to practice [COMPUTED: CANDIDATES.csv enumeration].
- Coformer list: succinic (lead), saccharin, nicotinamide (backups) — all GRAS [SOURCED: FDA GRAS List (2026-10-18)].
- PXRD tolerance claimed as ±0.2° (instrument reproducibility) [ASSUMED].

## Claims (ladder, ≥1 independent + ≥8 dependent)

**Independent Claim 1 (broadest enabled):**
> A crystalline co-crystal comprising apixaban and succinic acid in a 1:1 molar ratio, characterized by a powder X-ray diffraction pattern comprising peaks at 2θ 7.82±0.2°, 11.24±0.2°, and 14.61±0.2° (CuKα) [COMPUTED: s6_property.csv -> 7.82,11.24,14.61], wherein the co-crystal is anhydrous.

**Dependent Claim 2:** The co-crystal of Claim 1 further comprising peaks at 17.92±0.2° and 22.34±0.2° [COMPUTED].

**Claim 3:** The co-crystal of Claim 2 wherein the unit cell is triclinic P-1 with parameters a=7.12±0.05Å, b=10.84±0.05Å, c=14.02±0.05Å [COMPUTED].

**Claim 4:** The co-crystal of Claim 1 wherein the melting onset by DSC is 212±5°C [COMPUTED: MP 212 — but measured range must be inserted after experiment [PROPOSED]].

**Claim 5:** The co-crystal of Claim 1 wherein the aqueous solubility at pH 6.8, 37°C is at least 2× that of apixaban Form N-1 under identical conditions [COMPUTED: 10.7× modelled, but requires measured data [PROPOSED]].

**Claim 6:** A process for preparing the co-crystal of Claim 1 by solvent-drop grinding apixaban and succinic acid in 1:1 ratio with acetonitrile/methanol 1:1 followed by slurry seeding [PROPOSED: Example 1].

**Claim 7:** A pharmaceutical composition comprising the co-crystal of Claim 1 and a pharmaceutically acceptable excipient.

**Claim 8:** Use of the co-crystal of Claim 1 for treating thromboembolic disorder (Factor Xa inhibition) — second medical use, EP-type.

**Claim 9:** A crystalline co-crystal of apixaban and saccharin (1:1) as fallback (peaks 8.47,11.67,14.87±0.2° [COMPUTED: APX-CC-169]) — preserves FTO if C4-C9 art grants.

**Claim 10:** A crystalline co-crystal of apixaban and nicotinamide (1:1) peaks 8.82,12.02,15.22±0.2° [COMPUTED: APX-CC-085].

## Novelty Statement (with caveat)

Without live subscription-database access we cannot certify novelty [mandatory]. Based on COD (CC0, ~535k entries, no patent literature) and WO 2007/030582 N-1 disclosure alone, the predicted peak set 7.82/11.24/14.61 does not appear. But CSD/PATSTAT not searched — buyer must commission search.

## Freedom to Operate Assessment (per claim, summarized)

See CLAIM_CHART.md. Closest blocker WO 2018/071 C4-C9 genus — we argue species not enabled + provide saccharin fallback outside genus.

## What is Deliberately NOT Claimed (keep defensible)

- Broad dicarboxylic genus (would collide with WO 2018/071)
- Hydrates/solvates (a_w stability not modelled)
- Amorphous (not in CANDIDATES.csv)
- Process yields >90% (not enabled)

## Experimental Section — Tagging

Every datum labelled [COMPUTED] or [PROPOSED] or [SOURCED]; none presented as measured. After [PROPOSED] experiment, replace with [MEASURED: lab report #].

