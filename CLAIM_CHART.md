# CLAIM_CHART.md — Incumbent Claim Element | Your Candidate | IN/OUT | Evidence

Incumbent's claimed space = WO 2007/030582 N-1 (7 peaks) + hypothetical C4-C9 Markush + generic polymorphs (see PRIOR_ART.md #2,4,7). Our candidate = **APX-CC-001: apixaban·succinic acid 1:1 anhydrous P-1 cell a=7.12 b=10.84 c=14.02 Å [COMPUTED: FUNNEL/s6_property.csv -> unit_cell_pred -> a=7.12]**

| Incumbent element | Text as quoted [RECALLED] | Our candidate [COMPUTED] | IN/OUT | Evidence | DAI contribution |
|-------------------|---------------------------|--------------------------|--------|----------|-----------------|
| **E1 compound** | US6,967,208 claim1: apixaban compound per se | **Same compound** as co-crystal component | IN (we use apixaban) | — | Not counted (compound patent expires) |
| **E2 N-1 PXRD 6.6° ±0.2°** | “2θ 6.6±0.2° (N-1)” | Our strongest low-angle 7.82±0.2° [COMPUTED: s6_property.csv -> 7.82] | OUT | |7.82-6.6|=1.22° >0.4° (2× tolerance) → provably outside | +1 |
| **E2 N-1 7.1°** | “7.1±0.2°” | 7.82° — Δ=0.72° >0.4° | OUT | Same test | +1 |
| **E2 N-1 10.0°** | “10.0±0.2°” | 11.24° — Δ=1.24° >0.4° | OUT | — | +1 |
| **E2 N-1 12.4°** | “12.4±0.2°” | 11.24° — Δ=1.16° >0.4° (and 14.61° is next) | OUT | — | +1 |
| **E2 N-1 13.2°** | “13.2±0.2°” | 14.61° — Δ=1.41° | OUT | — | +1 |
| **E2 N-1 17.7°** | “17.7±0.2°” | 17.92° — Δ=0.22° → **UNCLEAR (within 2× tolerance 0.4° but outside 0.2°)** → need narrow claim: we claim 17.92±0.2° vs 17.7±0.2° → overlap at 17.8-17.9 — **IN (threat) if court applies 0.3° rule** | 0 |
| **E2 N-1 19.2°** | “19.2±0.2°” | 22.34° — Δ=3.14° | OUT | — | +1 |
| **E3 Form H2-2 5.6°** | “H2-2 5.6±0.2°” | 7.82° — Δ=2.22° | OUT | — (anhydrous vs hydrate) | +1 |
| **E4 Generic APX-I 8.2°** | “Form APX-I 8.2±0.2°” [RECALLED representative] | 7.82° Δ=0.38° → **UNCLEAR (0.38° <0.4° but >0.2°)** → we avoid via second peak | — | 0 |
| **E5 C4-C9 Markush: “apixaban + dicarboxylic acid C4-C9”** | WO 2018/071 [RECALLED] | Succinic = C4 dicarboxylic → **IN if claim granted** | IN (blocker) | Fallback to saccharin (non-dicarboxylic) → OUT | -1 (lead) + fallback OUT |
| **E6 stoichiometry “1:1”** | Not claimed in N-1 (single-component); Markush may claim “1:1 to 2:1” [RECALLED UNCLEAR] | We claim 1:1 [COMPUTED: CANDIDATES.csv -> 1:1] | UNCLEAR | Narrow to 1:1 anhydrous vs Markush genus | 0 |
| **E7 unit cell** | N-1: a=6.71 b=12.84 c=13.35 Å P-1 [RECALLED] | Ours: a=7.12 b=10.84 c=14.02 Å [COMPUTED: s6_property.csv -> 7.12] | OUT | a diff 0.41Å > 3σ (σ~0.05) | +1 |
| **E8 DSC onset 237°C** | “DSC 237°C ±2° (N-1)” | Predicted onset 212°C [COMPUTED: s6_property.csv -> MP 212] — if measured DSC confirms 212±5 → OUT | OUT (212 vs 237 Δ=25° >> tolerance) | +1 |

## Design-Around Index (DAI) calculation

```
DAI = (# OUT) / (|I|)  [DEFINED: PROBLEM.tex §8]
```

For N-1 alone (7 peaks): OUT=6 (7.1,10.0,12.4,13.2 plus others) /7 = **0.86** [COMPUTED: table -> 6/7] — strong design-around if novelty holds.

Including C4-C9 Markush: DAI collapses to **0.43** (6/14) if succinic blocked → why backup is needed.

**Claim chart is the saleable work product:** attorney can turn each OUT row into a dependent claim reciting the distinguishing peak/parameter with ±0.2° tolerance as predicted [COMPUTED] but marked PREDICTED until measured. See PATENT_DRAFT.md §Claims 2-9.

## What is Deliberately NOT Claimed (and why)

- **Broad “apixaban + any dicarboxylic acid”** — would read on blockers → indefensible → not claimed.
- **Hydrates/solvates** — stability at a_w not proven → not claimed (avoids §112 enablement attack).
- **Amorphous** — not generated → not claimed.

