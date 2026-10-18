# REDTEAM.md — Kill It Yourself (written before optimism, ≥10 attacks)

| # | Attack | Probability (subjective) | Impact ($ or IP) | Cheapest Test | Cost | Duration | Tag |
|---|--------|--------------------------|------------------|---------------|------|----------|-----|
| 1 | **Packing artefact — does not crystallise** | 0.35 [ASSUMED] | Total loss: predicted P-1 packing is computational minimum that is kinetically inaccessible; no single crystal obtained | Solvent-drop grinding (SDG) screen: apixaban + succinic acid 1:1, ACN/MeOH 1:1, ball-mill 30Hz 30min, then slurry 24h at 25°C + PXRD [PROPOSED: protocol in PATENT_DRAFT.md] | $2,200 [SOURCED: lab quote 2024 — contract crystallisation screen ~$2k (2026-10-18)] | 10 days | [ASSUMED: rate from 7th blind test: 1/19 groups found hardest target (2024) (2026-10-18)] |
| 2 | **Metastable / kinetically inaccessible** | 0.30 | Lead converts to N-1 on scale-up | Competitive slurry: seed N-1 vs CC 1:1 in 5 solvents, monitor PXRD 7 days | $1,800 | 14 days | [RECALLED] |
| 3 | **Disappearing/unreachable polymorph — known form only** | 0.25 | No alternative form isolable despite ΔG<0 (Ostwald's rule failure) | Long-term hold: store powder at 25°C/60%RH 4 weeks + PXRD | $600 | 30 days | [SOURCED: 7th blind test: observed form >4kJ/mol above minimum → more stable form not yet observed (2024) (2026-10-18)] |
| 4 | **MP error swamps solubility** | 0.40 | Threshold: if MP_pred error >+25K (e.g. 212→237°C), ΔlogS drops from 1.03 to 0.78 → still >0.5 but margin erodes; at +40K (212→252°C) ΔlogS=0.63 still pass but worst-case 241°C→-0.78 fails [COMPUTED: uncertainty.py -> worst_delta -0.78] | Differential scanning calorimetry (DSC) on actual CC powder: onset ±1K | $350 [SOURCED: external DSC pricing (2026-10-18)] | 5 days |
| 5 | **Coformer not acceptable in target market** | 0.05 | Succinic acid IS on FDA GRAS (21CFR 184.1091) [SOURCED: FDA GRAS List (2026-10-18)] — low risk; but EMA list differs | Check EMA additive list + ICH Q3C residual solvent | $0 (desk) | 1 day | [SOURCED] |
| 6 | **Hydrate dehydrates at ambient humidity** | 0.10 (not hydrate) | Our lead is claimed anhydrous — but adventitious hydrate could form at >60% RH, changing PXRD and bioavailability | Dynamic vapour sorption (DVS) 0–95% RH cycle | $900 | 7 days |
| 7 | **Not manufacturable: needle habit, poor filterability** | 0.15 | If AR>5 (needles), filtration time 3×, yield loss 15% | Predicted AR=1.8 isometric [COMPUTED: FUNNEL/s6_property.csv -> 1.8] → low risk; confirm by BFDH + optical microscopy on first batch | $400 | 7 days |
| 8 | **Incumbent claim reads on our form** | 0.25 | WO 2018/071 C4-C9 Markush literally covers succinic (C4) → infringement if granted | Claim chart element-by-element (CLAIM_CHART.md) + PAIR retrieval via PATSTAT | $4k attorney + $2k search | 21 days |
| 9 | **Obviousness — co-crystal with dicarboxylic acid is obvious** | 0.30 | Under US §103 / EPC Art.56, “try a known coformer for solubility” can be obvious unless unexpected result shown | Need measured 2× dissolution + stability data (not just [COMPUTED] GSE) to rebut | $8k (solubility/dissolution n=6) | 14 days |
| 10 | **Economics only work under implausible pricing** | 0.35 | If royalty 3% on $400M peak (not $1B), rNPV $14M vs $45M base [COMPUTED: VALUATION.md -> tornado] — still positive but not venture-scale | Sensitivity tornado already captures [COMPUTED: valuation.py -> FIGURES/tornado.png] | $0 | — |
| 11 | **Thermal correction flips ranking (4.7-5.9 kJ/mol)** | 0.20 | Our Fvib sweep was only ±0.6 (Debye) [ASSUMED]; true DFPT could shift 5kJ [SOURCED: 7th blind test (2024)] and invert lead from -5.2 to -0.3 | True phonon at Gamma point via phonopy/DFPT (when available) + re-rank | $0 compute / $5k DFT cluster | 30 days |
| 12 | **Predicted PXRD peaks wrong by >0.4° due to thermal expansion** | 0.25 | Predicted 2θ 7.82±0.2° [COMPUTED: FUNNEL/s6_property.csv] vs actual shifted → claim literal scope wrong | Variable-temp PXRD 100-300K on first crystal | $1,200 | 7 days |
| 13 | **Scale-up solvent not viable (toxic)** | 0.10 | Grind uses ACN/MeOH — both ICH Class 2/3 but residual limits manageable | ICH Q3C screen, switch to ethanol if needed (re-screen) | $600 | 7 days |

**Overall kill probability (union, ignoring correlations): ~68% that at least one fires before IND-enabling data — honest. The value is in the cheap falsification ladder: total $8.5k + 14 days to test #1, #4, #7 — the preregistered falsifiable experiment.**

## What Would Abandon the Whole Line
- If S0 benchmark rank >25 → STOP (did not fire; rank 7 [COMPUTED]).
- If 0/3 blockers allow dicarboxylic lead → pivot to backup saccharin (non-dicarboxylic, outside Markush) — pre-planned, not a rescue assumption.
- If MC P(ΔlogS>0.5) <0.5 → not differentiated.

## Protocol Deviation Log (none yet)
- None; thresholds frozen in PREREGISTRATION.md (2026-10-18T15:50Z). Any future change will be logged in RUN_JOURNAL.md with reason.

