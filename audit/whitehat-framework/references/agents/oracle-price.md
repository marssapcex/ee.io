# Lens: price and oracle

- Where does the price come from: `slot0`/`getReserves` (spot, manipulable in one block),
  `latestRoundData` (check `updatedAt`/`answeredInRound`/decimals), a custom aggregator (check who can
  push), or a cached value (check the freshness check exists).
- TWAP window vs the cost of moving the price for that window. Write the budget: capital, fee, blocks.
- Decimal normalisation: an 8-dec feed multiplied into an 18-dec rate with no scale is a real,
  recurring bug.
- Lending shape: can a single collateral pump change the borrow limit inside one transaction?
- Is the same price used for both entry and exit, or can the attacker pick the better one?

Corpus: `corpus/classes/oracle-price-manipulation.md`, `slippage-amm.md`.
Start with `2021__2021-10-15_IndexedFinance_ReweightManipulation.json` (spot pool plus missing
slippage) and any 2025–2026 `PriceManipulation` entry for the modern variants.
