# PREREGISTRATION.md — Frozen 2026-10-18T15:50Z

## Primary Endpoint
Relative lattice free energy ΔG_latt(298K,1atm) between novel co-crystal candidate (Apixaban + GRAS coformer) and the physical mixture of its components, computed as:
```
ΔG_latt = G_CC - (G_API + G_coformer)  [kJ/mol per formula unit]
```
Negative ΔG indicates thermodynamic driving force for co-crystal formation.

Decision rule (pre-registered): **PASS** if ΔG_latt ≤ -2.0 kJ/mol with method spread <2.0 kJ/mol across ≥3 independent methods (Method A/B/C defined below) AND thermal correction does not flip sign.

If benchmark gate fails, entire pipeline is declared NOT CREDIBLE and we STOP — no unknown-form claim is made.

## Funnel Stages — Fixed Thresholds (no post-hoc changes without logged deviation)

| Stage | Name | Metric | Threshold (PASS) | n_in (planned) | n_out (expected) | Uncertainty reporting |
|---|---|---|---|---|---|---|
| S0 | Benchmark gate | Rank of known apixaban Form N-1 in blind generation+ranking | Rank ≤10 (of ~200) AND RMSD15 ≤0.5Å to experimental CIF | — | — | Report rank + RMSD; if fail STOP |
| S1 | Geometry/feasibility | Packing validity: density 1.1-1.8 g/cm3, no overlap <0.7×vdW sum, H-bond sanity | All three must pass | 180 | ~120 | Distribution of density/overlap |
| S2 | Fast pre-rank | Surrogate-GFN2 (calibrated) ΔE_CC | ΔE_CC ≤ 0.0 kJ/mol (keep stabilised only) | ~120 | ~60 | Spread histogram |
| S3 | Independent re-rank | 3 methods: A=DFT-D surrogate v1 (PBE-D3-like), B=DFT-D surrogate v2 (r2SCAN-D4-like), C=Force-field/MLIP-like | Keep if ≥2/3 methods agree ΔG<0 AND std across methods <2.5 kJ/mol | ~60 | ~15 | Rank correlation (Spearman) + per-structure spread |
| S4 | Thermal corrections | Harmonic phonons (Debye surrogate) F_vib(298K) | Report ΔG with/without F_vib; do not eliminate (all forwarded) | ~15 | ~15 | ΔF_vib magnitude; % ranking flips |
| S5 | MD stability | Langevin MD (NVT) at 300K + 400K, seeds 42 & 123, 200ps surrogate | RMSD <1.2Å and no decomposition at 300K | ~15 | ~8 | RMSD traces |
| S6 | Property chain | log10S via Yalkowsky GSE: log10S=0.5-log10P-0.01(MP-25); IDR ∝ S | Report solubility gain vs incumbent form on SAME chain | ~8 | ~5 | Full MC posterior |
| S7 | Incumbent comparison | Same models applied to apixaban Form N-1 | Differentiation: ≥0.5 log unit solubility gain OR hygroscopicity/morphology improvement | ~5 | 1+2 backups | Apples-to-apples table |

## Stopping Rule
- Stop after S7 if 1 lead + 2 backups meet S3-S6; else iterate candidate generation once (new coformers), then report failure if still none.
- Do NOT stop early at "enough for summary".
- If wall-clock exceeds 8h in Phase 4, cut property-chain scope (S6) to reduced coformer set, never rigor.

## Sample Sizes & Seeds
- Total candidates: 180 (enumerated: 15 GRAS coformers × 3 stoichiometries × 4 space-group families = 180) → justification: finite GRAS list keeps falsifiability cheap.
- Seeds: GLOBAL_SEED=20261018, MD seeds 42, 123, S3 method perturbations seeded 0,1,2
- MC uncertainty: N=12,000 samples
- Bootstrap for ranking: B=5,000

## Benchmark Gate — Detail
- Input: experimental CIF for apixaban Form N-1 [SOURCED: Crystallography Open Database entry COD 7153012 — apixaban, P-1, Z=2, a=6.71 b=12.84 c=13.35Å (accessed attempt 2026-10-18 — allowlist blocked, so [RECALLED] + caveat)] — fallback: literature unit cell from [SOURCED: DOI 10.1021/cg900... (place-holder, real DOI to be fetched if network permits)]
- Procedure: exclude CIF from generation; generate blind packings; compute RMSD15 to experimental via COMPACK-like metric; report rank by Method A energy.
- PASS window: rank 1-10 = strong, 11-25 = weak but proceed with downgraded credibility, >25 or not generated = FAIL/STOP.

## Free Parameters & Sweeps
- logP (apixaban) [RECALLED: 1.74] swept ±0.8 (experimental variability)
- MP (melting point) swept 180-260°C (apixaban MP ~237°C [RECALLED]) — dominant uncertainty, reported as range
- pKa (for salt rule): not used (T2 co-crystal, neutral)
- F_vib uncertainty: Debye T_D ±50K swept

## Valuation Priors
- PoS per stage: preclinical 0.65, Phase1 0.63, Phase2 0.30, Phase3 0.58, NDA 0.85 [RECALLED: training memory, NOT verified — flagged and swept 0.5×-1.5×]
- Discount r=10.5% (WACC for specialty pharma)
- Dominant driver pre-declared: royalty_rate × peak_sales × PoS(approval) — compute sensitivity will test this.

## Deviation Logging
Any threshold change after seeing data must be appended to RUN_JOURNAL.md with timestamp, old value, new value, reason, and re-run of affected stage.

---
Frozen: 2026-10-18T15:50Z
Commit hash at freeze: 22c94ecf45e55e1d386eaecca82b073afbcefd41 [COMPUTED: git rev-parse HEAD -> PREREGISTRATION.md -> 22c94ec...]
Seed: 20261018
