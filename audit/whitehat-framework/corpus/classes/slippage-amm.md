# slippage-amm

26 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2021-04-28 | Uranium Finance | BSC | $50,000,000 | Bug where the constant used in the K invariant check after `swap()` (1000) differs from the fee calculation constant (10000), causing K to effectively increase  | `2021__2021-04-28_Uranium_Finance_KInvariantMismatch.json` |
| 2021-05-02 | Spartan Protocol | BSC | $30,500,000 | `removeLiquidity()` calculates withdrawal amounts using the current `balanceOf()` instead of synchronized reserve variables, making it manipulable via direct to | `2021__2021-05-02_Spartan_Protocol_SpotBalanceLPCalc.json` |
| 2021-02-04 | Yearn Finance | Ethereum | $11,000,000 | yVault calculates prices based on Curve 3Pool's current balances, allowing price distortion when pool imbalance is manipulated | `2021__2021-02-04_Yearn_yDAI_CurvePoolImbalance.json` |
| 2022-04-30 | Saddle Finance | Ethereum Mainnet | $11,000,000 | A virtual price calculation bug in the legacy Saddle pool allowed profit to be extracted simply by repeatedly swapping sUSD back and forth between Curve and Sad | `2022__2022-04-30_Saddle_StableSwapArbitrage.json` |
| 2023-05-28 | Jimbos Protocol | Arbitrum | $7,500,000 | Price manipulation followed by protocol asset drain due to missing slippage validation in the investment function (shift) | `2023__2023-05-28_JimbosProtocol_SlippageExploit_ARB.json` |
| 2024-06-02 | Velocore | Linea | $6,880,000 | Missing caller validation in AMM pool's `velocore__execute()` + arithmetic underflow caused by allowing `effectiveFee1e9` to exceed 100% | `2024__2024-06-02_Velocore_InvariantFlaw_zkSync.json` |
| 2023-12-05 | BEARNDAO | BSC | $769,000 | Missing `amountOutMin` validation in the `convertDustToEarned()` function's token swap enables price manipulation via flash loan | `2023__2023-12-05_BEARNDAO_SlippageProtection_BSC.json` |
| 2024-10-05 | EGA Token | BSC | $554,000 | Internal function that purchases EGA tokens from the PancakeSwap pair sets `amountOutMin = 0`, providing no slippage protection — callable after flash loan pric | `2024__2024-10-05_EGAToken_SlippageProtection_BSC.json` |
| 2024-11-24 | DCF Token | BSC | $442,029 | Missing slippage protection + forced token burn inside LP pair during transfer, enabling unlimited price manipulation | `2024__2024-11-24_DCFToken_SlippageProtection_BSC.json` |
| 2024-09-16 | Inferno | Ethereum | $433,000 | `amountBlazeMin = 0` in `swapTitanXForInfernoAndBurn()` — missing slippage protection forces swap execution at manipulated price | `2024__2024-09-16_Inferno_SlippageProtection_ETH.json` |
| 2023-11-06 | TheStandard.io | Arbitrum | $290,000 | `amountOutMinimum = 0` setting in `SmartVaultV2.swap()` allowed price manipulation through an attacker-controlled low-liquidity pool | `2023__2023-11-06_TheStandard_SlippageProtection_ARB.json` |
| 2025-03-01 | Zoth | Ethereum | $285,000 | LTV validation inside `mintWithStable()` references the initial deposit amount (`amount`) instead of actual collateral received (`collateralReceived`) + zero sw | `2025__2025-03-01_ZeUSD_SlippageProtection_ETH.json` |
| 2026-04-07 | HERMES | BNB Chain | $193,937 | `_handleBuy` directly deducts the buy tax from the LP pool's HB balance → pool k=0 collapse | `2026__2026-04-07_HERMES_HB_PoolTaxDrain_AMM_k_Zero.json` |
| 2025-10-20 | Sharwa Finance | Arbitrum | $146,000 | Missing post-insolvency check after position liquidation + Uniswap V3 spot price oracle dependency | `2025__2025-10-20_SharwaFinance_BusinessLogic_ARB.json` |
| 2023-05-28 | BabyDogeCoin | BSC | $135,000 | Fee exemption configuration in the FarmZAP contract + lack of slippage protection in the BabyDoge contract, enabling price manipulation and asset theft | `2023__2023-05-28_BabyDogeCoin_SlippageProtection_BSC.json` |
| 2024-04-01 | Z123 | BSC | $135,000 | Each swap through the victim router excessively burns Z123 liquidity; after 79 iterations the supply reduction distorts the price, allowing the attacker to real | `2024__2024-04-XX_Z123_ConsecutiveSwapLiquidityBurn.json` |
| 2025-02-07 | ADACash | BSC | $107,000 | Zero slippage protection due to hardcoded `amountOutMin = 0` in the token's internal swap functions (`swapTokensForEth`, `swapTokensForADA`, `addLiquidity`) — e | `2025__2025-02-07_ADACash_SlippageProtection_BSC.json` |
| 2021-06-26 | xWin Finance | BSC | $80,000 | `priceImpactTolerance=10000` (100%) in the swap inside `subscribe()` effectively disables slippage control — allows cumulative XWIN price inflation on each repe | `2021__2021-06-26_xWin_SlippageControl_Bypass.json` |
| 2022-10-27 | Team Finance | Ethereum Mainnet | $16 | The `migrate()` function does not validate the `sqrtPriceX96` parameter, allowing an arbitrary price range to be set when creating a Uniswap V3 position | `2022__2022-10-27_TeamFinance_MigrateSqrtPrice.json` |
| 2021-09-21 | Nimbus DEX | Ethereum | ~1.45 ETH (DeFiHackLabs README) | Identical to Uranium Finance — K invariant constant mismatch: reserves multiplied by 10000, but K validation uses 1000^2 | `2021__2021-09-21_Nimbus_KInvariant_1000vs10000.json` |
| 2022-11-01 | BDEX | Binance Smart Chain | Unconfirmed | The `convertDustToEarned()` function executes against an externally manipulable pair reserve state, causing a token balance discrepancy | `2022__2022-11_BDEX_ConvertDustManipulation.json` |
| 2022-12-02 | Overnight Finance | Avalanche | Unconfirmed | Reserve imbalance created via repeated add/remove liquidity cycles on the Platypus stableswap pool, combined with the USD+ `buy()`/`redeem()` mechanism and Benq | `2022__2022-12-02_Overnight_USDPlusPlatypusManipulation.json` |
| 2023-06-05 | Viral INU | Ethereum | ~6K USD | `addLiquidityETH` function callable externally with arbitrary parameters | `2023__2023-06-05_VINU_AddLiquidityExploit.json` |
| 2025-06-23 | GradientMakerPool | Ethereum | ~5,000 USD | Share calculation in provideLiquidity/withdrawLiquidity without validating the ETH-to-token ratio | `2025__2025-06-23_GradientMakerPool_LiquidityImbalance.json` |
| 2025-11-10 | DRLVaultV3 | Ethereum Mainnet | ? |  | `2025__2025-11-10_DRLVaultV3_SlippageAmm_ETH.json` |
| 2026-02-22 | LAXO Token | BNB Smart Chain | ~263,904 USDT lost by LP liquidity providers | LAXO token's LP burn trigger mechanism — small self-transfer triggers 19x LP burn | `2026__2026-02-22_LAXOToken_LPBurnManipulation_BSC.json` |
