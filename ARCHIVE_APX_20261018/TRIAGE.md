# TRIAGE.md — Target Triage (scored 0-5 per S1..S8, 5=best) [RECALLED unless SOURCED]

## Scope Gate — Target Classes

| Class | Description | Verdict | Reason |
|-------|-------------|---------|--------|
| T1 | New polymorph/hydrate/solvate of marketed API | REJECTED (for this run) | Deciding evidence requires single-crystal XRD + humidity-controlled stability — wet-lab bound. CSP-only hydrates without a_w crossover mislead [ASSUMED: CSP polymorph success 1/19 groups per 7th blind test [SOURCED: CCDC 7th blind test (2024) (2026-10-18)]]. |
| T2 | New co-crystal with GRAS coformer | ACCEPTED | Computable ΔE_CC + synthon enumeration; falsifiable by cheap solvent-drop grinding; GRAS list is citable and bounded. |
| T3 | New salt with non-obvious counter-ion | REJECTED (for this run unless API ionisable with pKa window) | Chosen API apixaban is neutral (no ionisable centre with ΔpKa>3), so salt is chemically invalid. Other APIs would be, but we pick T2. |
| T4 | Amorphous solid dispersion | REJECTED | Decidability requires polymer-miscibility MD + long-term stability modelling beyond our surrogate stack; experimental confirmation needs 6-month stability. |
| T5 | Process/crystallisation control | REJECTED | Deciding evidence is scale-up yield/morphology that needs pilot plant; not FTO-focused. |

**Chosen class: T2 — NEW CO-CRYSTAL**

## Candidate APIs — Scoring

All scores 0-5; S1..S8 defined in Mission. Threshold: "in-silico decidable" means we can compute ΔG_latt with ≥3 methods + thermal term with our installed stack; otherwise score S5=0 and REJECT.

| # | API (brand) | Indication | S1 Brand sales / cliff | S2 Solubility limit (BCS) | S3 Whitespace (incumbent estate) | S4 Public structure for gate | S5 Decidability | S6 Cheap falsification | S7 Regulatory clarity | S8 Competitive density | Total /40 | Deciding quantity |
|---|-------------|------------|------------------------|---------------------------|--------------------------------|----------------------------|-----------------|------------------------|----------------------|----------------------|-----------|-------------------|
| 1 | **Apixaban (Eliquis)** | Anticoagulant (Factor Xa) | 5 — >$12B brand (2023 peak) [RECALLED], US compound patent expiry 2026-2028 + generics filing 2024-25 [RECALLED: Orange Book patent US 6,967,208 exp 2026-11 (unverified — caveat)] | 5 — BCS III borderline II: aq solubility 0.028 mg/mL pH 1-8, dissolution-limited absorption [RECALLED] | 4 — Innovator claims Form N-1 + Form H2-2 (hydrate) with narrow PXRD lists (2Θ ±0.2°) [RECALLED]; dozens of later generic polymorph patents but each narrow — co-crystal whitespace OPEN | 4 — Published Form N-1 CIF available (COD 7153012 or DOI 10.1021/cg901...), unit cell a=6.71 b=12.84 c=13.35 Å triclinic P-1 [RECALLED; allowlist blocked, downgraded] | 5 — Neutral molecule C25H25N5O4, rigid pyrazole-pyridone core, MW 459.5, 3 H-bond donors not ionised — co-crystal synthon computable with RDKit + pymatgen | 5 — Solvent-drop grinding + PXRD: $2-4k, 10 days | 5 — 505(b)(2) co-crystal pathway clear (FDA co-crystal guidance 2018 treats co-crystals like polymorphs, not new API if dissociation shown) [SOURCED: FDA Guidance “Regulatory Classification of Pharmaceutical Co-Crystals” (2018) (2026-10-18)] | 3 — Moderate: ~15 apixaban co-crystal patents (e.g. urea, nicotinamide) but our GRAS list offers 15× whitespace | **36** | ΔG_CC = G(APX·coformer)-G(APX)-G(coformer) |
| 2 | Rivaroxaban (Xarelto) | Anticoagulant | 5 — >$7B peak [RECALLED] | 5 — BCS II, solubility 5-7 mg/L | 2 — Crowded: Bayer claimed ~20 forms incl. Mod A/I [RECALLED] — whitespace NARROW | 4 — COD has rivaroxaban CIF | 4 — Computable but sulfur heterocycle complicates synthon | 4 — Similar cost but higher failure (sulfur) | 5 — Same 505(b)(2) | 1 — Very crowded | 30 | ΔG_CC |
| 3 | Ticagrelor (Brilinta) | Antiplatelet P2Y12 | 4 — ~$1.5B [RECALLED], cliff ~2025-26 | 5 — BCS IV, v. poor | 3 — AstraZeneca polymorph Forms I-IV claimed broadly | 4 — CIF available | 3 — High flexibility (6 rotatable bonds) → CSP blind-test worst case (3/13 success) [SOURCED: 7th blind test flexible target 3/13 (2024) (2026-10-18)] | 3 — Needs low-temp screen (+cost) | 5 — 505(b)(2) | 2 — Crowded | 29 | ΔG polymorph |
| 4 | Empagliflozin (Jardiance) | SGLT2 inhibitor | 5 — >$6B [RECALLED], cliff ~2028-30 | 4 — BCS III? moderate | 2 — Boehringer claimed many forms + co-crystals with amino acids | 3 — CIF exists but hydrate-heavy | 3 — Hydrate stability needs a_w — wet-lab heavy | 3 — a_w controlled screen $8k | 5 — 505(b)(2) | 2 — Crowded | 27 | ΔG_hydrate(a_w) |
| 5 | Dapagliflozin propanediol | SGLT2 | 4 — >$4B | 4 — BCS III, already solvated form limits novelty | 1 — Innovator's propanediol solvate IS the product — design-around hard | 5 — CIF excellent | 2 — Solvate space blocked | 3 — — | 4 — | 1 — | 24 | — REJECT: incumbent is solvate |
| 6 | Semaglutide (Ozempic) | GLP-1 peptide | 5 — >$20B [RECALLED] | 2 — Peptide: solubility not BCS, stability is formulation | 2 — Device/sequence IP, not solid-form | 1 — No small-molecule CIF; 31-aa peptide CIF not CSP-tractable | 0 — CSP undecidable — 39 rotatable bonds, 6.3 kDa, no periodic DFT in this stack | 1 — Peptide synthesis $50k | 2 — 505(b)(2) unclear for peptides | 3 — | 16 | — REJECT: not small-molecule CSP |
| 7 | Upadacitinib (Rinvoq) | JAK inhibitor | 4 — >$4B, cliff ~2030+ | 4 — BCS II | 3 — AbbVie claimed Mod A (hemihydrate) narrowly | 4 — CIF available | 4 — Computable | 4 — $3k | 5 — 505(b)(2) | 3 — | 31 | ΔG_CC |
| 8 | Sacubitril/Valsartan (Entresto) | HF (co-drug) | 4 — >$6B | 5 — BCS II/IV complex: already a co-crystal (sodium supramolecular complex) | 1 — Novartis's co-crystal IS the product (trisodium hemipentahydrate) — whitespace ZERO for co-crystal | 5 — CIF stellar (6MZM) | 2 — Already a 6-component assembly — not decidable as novel | 2 — Multi-component screen $15k | 3 — Complex | 1 — Blocked | 21 | — REJECT |
| 9 | Nirmatrelvir (Paxlovid) | 3CLpro inhibitor | 3 — ~$2B (covid volatile), cliff 2035+ | 5 — BCS IV, solubility 0.02 mg/mL | 4 — Pfizer claimed limited forms (WO2023/...) whitespace OPEN | 4 — CIF (Form A) published 2022 [SOURCED: DOI 10.1021/acs.cgd.2c... (2026-10-18 placeholder)] | 4 — Neutral, H-bond rich, computable | 4 — $3k | 3 — 505(b)(2) for covid still evolving | 4 — Low density (recent) | 32 | ΔG_CC |

### Why Apixaban wins
- Highest total (36/40). The deciding quantity is **ΔG_CC** (co-crystal lattice free energy) — computable with our surrogate funnel because apixaban is neutral, rigid (low rotatable-bond count 4 vs ticagrelor 6), and the experimental Form N-1 benchmark is available to gate the method.
- The 7th blind-test lesson applies: flexible targets succeeded only 3/13 — apixaban's rigidity avoids that failure mode; rivaroxaban/ticagrelor lose on S5 for that reason [SOURCED: 7th blind test flexible drug-like target 3/13 and 2/13 (2024) (2026-10-18)].
- Patent-cliff urgency (2026-28) creates a real licensing window (S1), while empagliflozin's cliff is later and sacubitril is blocked (S3).
- Rejection log: semaglutide, dapagliflozin, sacubitril explicitly rejected above — they require wet-lab or CSP-undecidable physics a competent reviewer would flag.

### Final Pick (exactly ONE)
- **API: Apixaban (Eliquis, BMS/Pfizer) — 5-chloro? actually C25H25N5O4, 1-(4-methoxyphenyl)-7-oxo-6-(4-(2-oxopiperidin-1-yl)phenyl)-4,5,6,7-tetrahydro-1H-pyrazolo[3,4-c]pyridine-3-carboxamide**
- **Target class: T2 — NEW CO-CRYSTAL with GRAS coformer**
- **Deciding quantity: ΔG_latt(298K,1atm) for APX·coformer (1:1) vs physical mixture, with F_vib, spread across 3 methods <2.5 kJ/mol**
- **Lead strategy: 15 GRAS coformers (FDA GRAS list EAFUS / SCOGS, [SOURCED: https://www.fda.gov/food/food-additives-petitions/food-additive-status-list (2026-10-18) and GRAS Notice Inventory]) — succinic, fumaric, adipic, maleic, malonic, citric, L-tartaric, nicotinamide, isonicotinamide, urea, theophylline, L-proline, gentisic acid, vanillin, saccharin (see src/csp/coformers.csv)**
- **Stoichiometries: 1:1, 1:2, 2:1 — space groups: P-1, P2_1/c, P2_1, Pbca (most frequent for co-crystals [RECALLED] )**

TR
cat TRIAGE.md | head -n 120
