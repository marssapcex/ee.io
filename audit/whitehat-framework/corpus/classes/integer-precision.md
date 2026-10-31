# integer-precision

27 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2025-05-22 | Cetus Protocol | Sui | $223,000,000 | Unchecked bit-shift (`shl`) in `checked_shlw` produces silent integer overflow in Move, causing near-zero denominators in sqrt price computation and allowing po | `2025__2025-05-22_Cetus_ArithmeticOverflow_Sui.json` |
| 2025-11-03 | Balancer V2 | Arbitrum, Ethereum, Polygon, Base, Sonic | $128,000,000 | Invariant D manipulation via Rounding Direction Mismatch in scaling logic | `2025__2025-11-03_BalancerV2_PrecisionLoss_ARB.json` |
| 2025-03-25 | Abracadabra Money | Arbitrum | $13,408,309 | `sendValueInCollateral()` does not update internal accounting variables (`inputAmount`, `minOut`) after actually withdrawing tokens, enabling repeated borrowing | `2025__2025-03-25_MIMSpell_CauldronRounding_ARB.json` |
| 2023-04-15 | Hundred Finance | Optimism | $7,400,000 | Exchange rate inflation via direct WBTC donation to the hWBTC cToken — borrowing all protocol assets after inflating collateral value | `2023__2023-04-15_HundredFinance_ERC4626Inflation_OP.json` |
| 2024-01-30 | Abracadabra / MIM Spell | Ethereum | $6,500,000 | Rounding down error in `rayDiv()` causes debt to be eliminated by 1 unit every 90 borrow-repay cycles, enabling artificial debt erasure | `2024__2024-01-30_MIMSpell2_PrecisionLossManipulation.json` |
| 2023-11-10 | Raft Protocol | Ethereum | $3,300,000 | cbETH donation inflates the rcbETH-c index → precision loss causes excessive rcbETH-c minting per 1 wei cbETH → excess R stablecoin issuance using over-collater | `2023__2023-11-10_Raft_FlashMintPrecision_ETH.json` |
| 2022-03-09 | Fantasm Finance | Fantom | $2,600,000 | The `mint()` function accepted native FTM via `msg.value` but the deposit check compared it against an FSM token amount without proper equivalence validation, a | `2022__2022-03-09_Fantasm_DecimalErrorMinting.json` |
| 2023-11-01 | OnyxProtocol | Ethereum | $2,100,000 | Artificially inflating the exchangeRate via direct donation to an empty cToken market in a Compound v2 fork, then exploiting precision loss to evade debt collat | `2023__2023-11-01_OnyxProtocol_ERC4626Inflation_ETH.json` |
| 2023-08-27 | Balancer | Ethereum | $979,000 | BPT (Balancer Pool Token) exchange rate manipulation via precision loss in the Boosted Pool (Linear Pool) | `2023__2023-08-27_Balancer_BoostedPoolVuln_ETH.json` |
| 2023-10-18 | Hope.money / HopeLend | Ethereum Mainnet | $825,000 | Share/asset conversion precision loss via liquidityIndex manipulation (division floor error) | `2023__2023-10-18_HopeMoney_PrecisionLoss_ETH.json` |
| 2022-03-17 | Umbrella Network | Ethereum Mainnet | $700,000 | Missing underflow check in the `withdraw(amount)` function during `_balances[user] - amount` computation, allowing any address with zero staked balance to withd | `2022__2022-03-17_Umbrella_StakingUnderflowDrain.json` |
| 2023-06-17 | Midas Capital XYZ | BNB Smart Chain | $600,000 | Empty Market + direct donation to ERC4626 Vault inflating exchangeRate → precision loss allows large LP redemption with fractional cTokens | `2023__2023-06-17_MidasCapitalXYZ_PrecisionLoss_BSC.json` |
| 2024-01-14 | Wise Lending | Ethereum | $464,000 | Same share price inflation pattern as WL02 + health factor validation bypass via 1-wei withdrawal to force bad debt creation | `2024__2024-01-14_WiseLending03_SharePriceInflation.json` |
| 2026-01-10 | FutureSwap | Arbitrum | $394,743 | Fees are calculated and passed as token unit amounts, but FeeManager interprets them as basis points (bps), resulting in abnormally large fees being charged | `2026__2026-01-10_FutureSwap_UnitMismatch.json` |
| 2026-03-17 | dTRINITY | Ethereum | $257,300 | `liquidityIndex` inflation and precision loss due to repeated flash loan fee accumulation in an empty cbBTC market | `2026__2026-03-17_dTRINITY_PrecisionLoss_ETH.json` |
| 2024-07-05 | DeFiPlaza V2 | Ethereum | $196,000 | In `removeLiquidity`, when the LP redemption ratio exceeds 15/16 of total supply, the fixed-point squaring computation truncates the `F_` value to 0, allowing t | `2024__2024-07-05_DeFiPlaza_PrecisionLoss_ETH.json` |
| 2023-06-12 | Compounder Finance | Ethereum | $27,174 | ERC-4626 vault first depositor attack (share price inflation) | `2023__2023-06-12_CompounderFinance_ERC4626Inflation.json` |
| 2024-02-01 | PANDORA | Ethereum | $17,000 | Integer underflow bug in the `transferFrom()` implementation of the PANDORA ERC404 token, causing a mismatch between pair reserves and actual balances — WETH dr | `2024__2024-02-XX_PANDORA_IntegerUnderflow.json` |
| 2026-01-08 | Truebit | Ethereum | $26 | The bonding curve calculation in `getPurchasePrice()` overflows on extreme quantity inputs, returning an artificially low price | `2026__2026-01-08_Truebit_BondingCurveOverflow.json` |
| 2024-05-14 | SonneFinance | Optimism | Optimism | $7 | Direct donation to newly added VELO market to manipulate soVELO exchange rate — Precision Loss (ERC4626 Inflation Attack) | `2024__2024-05-14_SonneFinance_ERC4626Inflation_OP.json` |
| 2023-03-15 | Poolz Finance | BSC | ~665K USD | Integer overflow due to missing `SafeMath` in Solidity 0.6.x | `2023__2023-03-15_poolz_IntegerOverflow.json` |
| 2023-10-26 | WiseLending | None | ? |  | `2023__2023-10-26_WiseLending_PrecisionLoss.json` |
| 2024-09-14 | PLN Token | Ethereum | ~400,000 USD | Calling `transferFrom(addr, dead, 0)` on the PLN token corrupts internal contract state, allowing subsequent transfer amount manipulation | `2024__2024-09-14_PLN_TransferFromZeroAmount.json` |
| 2024-11-17 | MFT Token | BSC | ~33,700 USD | Integer truncation bug in `stake()` — values ≥ 2^128 are truncated to 0, but the contract records them as a large stake | `2024__2024-11-17_MFT_IntegerTruncation.json` |
| 2025-06-25 | ResupplyFi | Ethereum | ~9,600,000 USD | Collateral value oracle relies on manipulable sCRVUSD pool ratio | `2025__2025-06-25_ResupplyFi_OracleManipulation.json` |
| 2026-03-05 | Solv Protocol -- BitcoinReserveOffering | None | ? |  | `2026__2026-03-05_SolvProtocol_BRO_DoubleMint_ETH.json` |
| 2026-06-07 | Flooring Protocol | Ethereum | ? | BT404 packs NFT ownership/indexing into bitfields for gas. A forged high-bit token-ID alias makes the ownership check record the attacker as owner ("ghost owner | `2026__2026-06-07_FlooringProtocol_BT404GhostOwnershipUnderflow_ETH.json` |
