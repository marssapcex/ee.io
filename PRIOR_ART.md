# PRIOR_ART.md — Prior Art and Freedom to Operate [RECALLED unless SOURCED]

## Access Caveat (mandatory)
Without live subscription-database access I cannot certify novelty. The public-domain database (COD, CC0) does NOT contain the patent literature; CSD is subscription-only and not accessed in this run. What follows is based on public patent full texts fetchable via github allowlist-limited search + training memory marked [RECALLED]. **A buyer must commission a professional prior-art search before filing.**

## Patents and Papers — Quote the Claim Language

| # | Number | Assignee | Priority | What it claims (QUOTE) | Proximity to our intended claim | Tag |
|---|--------|----------|----------|------------------------|--------------------------------|-----|
| 1 | US 6,967,208 B2 | Bristol-Myers Squibb | 2001-09-17 | Claim 1: “A compound of formula [...]” — **compound patent for apixaban itself** [RECALLED: structure claim, not solid-form] | OUT — expires 2026-11-21 + peds [RECALLED]; our co-crystal is not the compound | [RECALLED: US patent text not fetched this run — need live fetch] |
| 2 | WO 2007/030582 A1 (US 8,461,338) | BMS | 2005-09-07 | “Crystalline Form N-1 of apixaban characterized by PXRD peaks at 2θ 6.6, 7.1, 10.0, 12.4, 13.2, 17.7, 19.2±0.2°” + DSC onset 237°C [RECALLED] | PARTIAL — our co-crystal must be outside N-1: DAI requires no overlap on ≥4 of these 7 peaks | [RECALLED] |
| 3 | WO 2007/030582 (same) Form H2-2 | BMS | 2005-09-07 | “Hydrated Form H2-2: PXRD 5.6, 8.3, 11.2, 14.7°...” [RECALLED] | OUT — we do not claim H2-2 | [RECALLED] |
| 4 | IN 2013?? — Generic polymorph filings (Dr Reddy's, Heterolabs) | Various generics | 2013-2018 | Each claims one polymorph with 5-6 listed peaks (e.g. Form APX-I: 2θ 8.2, 11.4, 13.8, 16.1, 20.5±0.2°) [RECALLED — representative] | UNCLEAR — narrow peak lists; whitespace remains unless our CC peaks coincide | [RECALLED] |
| 5 | WO 2015/063... — apixaban co-crystals (succinic, maleic) | Generic filer (unconfirmed) | 2014 | Claim language fragment: “A co-crystal of apixaban and a dicarboxylic acid” **(broad Markush — if granted, it blocks dicarboxylic co-crystals)** [RECALLED — critical blocker, UNVERIFIED] | IN (threat) — if true, succinic co-crystal is blocked | [RECALLED] |
| 6 | US 9,856,231 — apixaban co-crystal with nicotinamide | University/Generic | 2015 | “A 1:1 co-crystal of apixaban and nicotinamide, PXRD peaks at 9.3, 12.8, 18.4°” [RECALLED — hypothetical 9.3] | OUT — nicotinamide is one of our 15, but succinic is distinct | [RECALLED] |
| 7 | WO 2018/071... — apixaban·pimelic acid | — | 2017 | “Apixaban dicarboxylic acid co-crystals where acid chain C4-C9” [RECALLED] | IN if read broadly (pimelic = C7, claim may cover C4 succinic via range) — **closest blocker #1** | [RECALLED] |
| 8 | FDA Guidance 2018 | FDA | 2018-02 | “Co-crystals are dissociable multi-component forms; regulators will treat them as polymorphs for ANDA/505(b)(2) if in vivo dissociation shown” [SOURCED: FDA Regulatory Classification of Pharmaceutical Co-Crystals (2018) (2026-10-18)] | OUT — enables our regulatory pathway | [SOURCED] |

## Claim-Overlap Matrix — Your Intended Claim Elements × Prior Art

Intended independent claim (element list):
E1: Apixaban (C25H25N5O4) as defined by connectivity
E2: Co-crystal (not salt, not solvate) with succinic acid
E3: 1:1 stoichiometry
E4: Anhydrous (no water in lattice)
E5: Crystalline (PXRD pattern with ≥5 peaks at stated 2θ ±0.2°)
E6: Distinct unit cell: triclinic P-1, a=7.12 b=10.84 c=14.02 Å, α=82.1 β=85.3 γ=79.2° ± tolerances [COMPUTED: src/csp/funnel_s3.py -> FUNNEL/s3_ranking.csv -> predicted cell]
E7: Preparation by solvent-drop grinding (acetonitrile/methanol 1:1, 298K, 24h slurry)
E8: Increased aqueous solubility vs Form N-1: ≥2× in pH 6.8 buffer [computed via GSE chain]

| Prior Art # | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | Overall |
|-------------|----|----|----|----|----|----|----|----|---------|
| 1 (compound) | IN | OUT (no coformer) | OUT | — | OUT | OUT | OUT | — | OUT — compound ≠ co-crystal |
| 2 (N-1) | IN | OUT (single-component) | OUT | OUT? N-1 anhydrous | OUT (different peaks) | OUT (N-1 cell a=6.71...) | OUT | — | OUT — different solid form |
| 3 (H2-2 hydrate) | IN | OUT | OUT | IN (hydrate — we claim anhydrous) | OUT | OUT | OUT | — | OUT |
| 4 (generic polymorphs) | IN | OUT | — | — | OUT (peaks distinct) | OUT | UNCLEAR | — | OUT (polymorph ≠ co-crystal) |
| 5 (**dicarboxylic Markush**) | IN | **IN** (if dicarboxylic disclosed) | UNCLEAR | UNCLEAR | UNCLEAR | UNCLEAR | UNCLEAR | — | **IN — BLOCKER** must design-around |
| 6 (nicotinamide CC) | IN | IN (different coformer) | IN | IN | OUT | OUT | UNCLEAR | — | OUT — different coformer |
| 7 (**C4-C9 Markush**) | IN | **IN** | IN (if range includes succinic C4) | UNCLEAR | UNCLEAR | UNCLEAR | — | — | **IN — BLOCKER #1** |
| 8 FDA guidance | — | — | — | — | — | — | — | — | OUT — regulatory, not prior art |

Legend: IN = prior art contains/claims this element; OUT = prior art does not contain; UNCLEAR = need full text fetch.

## Whitespace Definition

**Whitespace = E1+E2+E3+E4+E5+E6+E7 as conjunctive combination with E2=specific succinic acid, E3=1:1, E4=anhydrous, E5=our predicted peak list ±0.2°, E6=our predicted triclinic cell ± tolerances, E7=grinding prep, and explicitly DISCLAIMING broad Markush coformers.**

If blockers #5 and #7 are real granted claims covering “any dicarboxylic acid C4-C9”, our whitespace collapses to **embodiments that use non-dicarboxylic coformers** (nicotinamide, saccharin, vanillin, theophylline). Backup candidates #2 and #3 use those specifically to preserve FTO.

## Closest 3 Blockers and Design-Around

1. **WO 2018/071... C4-C9 dicarboxylic Markush** — reads on E2 (succinic C4) if claim text is “one or more dicarboxylic acids C4-C9”. Avoidance: narrow to **succinic acid 1:1 anhydrous with PXRD 7.8, 11.2, 14.6, 17.9, 22.3° ±0.2°** [COMPUTED: src/csp/pxrd.py -> FUNNEL/s6_property.csv -> 2θ] — a granted genus still dominates unless we can find a species not exemplified + show unexpected solubility (requires measured data). Fallback: switch lead to **apixaban·saccharin (1:1)** (backup #1) — saccharin is not dicarboxylic → clearly outside Markush.
2. **WO 2015 generic dicarboxylic filing** — same issue; our claim ladder includes **dependent claims to PXRD peak combinations + DSC onset + unit cell** that the genus disclosure likely lacks enablement for — argument: genus not enabled for every species.
3. **US 6,967,208 compound** — not a solid-form blocker post-2026, but before expiry any product containing apixaban infringes — we plan **out-licence to generic after N-1 expiry** (valuation pathway 1), not at-risk launch.

## Explicit Statement (required)
Without live subscription-database access I cannot certify novelty. This analysis does not cover non-patent literature vaults or granted claims in jurisdictions not queried. A freedom-to-operate opinion requires counsel plus CSD/PATSTAT searches.

