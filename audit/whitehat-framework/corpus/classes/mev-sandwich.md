# mev-sandwich

4 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2025-02-11 | FourMeme | BSC | $183,000 | Attacker pre-created a PancakeSwap pool with an extreme price before the official liquidity migration, inducing the platform to inject liquidity into the manipu | `2025__2025-02-11_FourMeme_PoolCreationFrontrun.json` |
| 2024-04-01 | SQUID | BSC | $87,000 | After swapping SQUID_1→SQUID_2 via `SquidSwap.swapTokens()`, repeatedly calling `sellSwappedTokens()` ~8,000 times distorts internal price calculations, causing | `2024__2024-04-XX_SQUID_SwapTokensSellSandwich.json` |
| 2023-08-22 | CurveBurner | None | ? |  | `2023__2023-08-22_CurveBurner_SandwichAttack.json` |
| 2024-01-25 | Shell Protocol MEV | BSC | ~1,000 BUSD | Sandwich attack on Shell Protocol transactions by MEV bot | `2024__2024-01-25_ShellProtocol_MEVSandwich.json` |
