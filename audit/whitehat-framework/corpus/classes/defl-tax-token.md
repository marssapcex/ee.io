# defl-tax-token

31 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2020-06-28 | Balancer Protocol | Ethereum Mainnet | $500,000 | Pool balance discrepancy due to incompatibility with deflationary token (STA) that charges a transfer fee | `2020__2020-06-28_Balancer_DeflatTokenManipulation.json` |
| 2023-05-24 | GPT Token | BSC | $155,000 | Flawed fee distribution logic in GPT token `_transfer` — unlimited fee extraction via `pair.skim()` | `2023__2023-05-24_GPTToken_FeeMechanism_BSC.json` |
| 2026-03-26 | Turing | BNB Chain | $133,490 | 2.45x multiplier vulnerability in TR burn-redistribution mechanism + `tx.origin` validation bypass via EIP-7702 | `2026__2026-03-26_Turing_TR_NOBEL_BurnRedistribution_EIP7702.json` |
| 2024-04-01 | MARS | BSC | $100,000 | The reflection tax mechanism updates only `balanceOf` without updating the pair's internal reserves, causing an accumulated divergence between reserves and actu | `2024__2024-04-XX_MARS_ReflectionTaxSwapSyncManipulation.json` |
| 2022-07-25 | LPC Token | BSC | $45,715 | Balance infinite-growth bug when fee token `transfer()` is called with self as recipient | `2022__2022-07-25_LPC_FeeTokenSelfTransfer.json` |
| 2026-01-12 | MTToken | BSC | $37,000 | `transactionFee()` distributes fees without validating that the sum of shares ≤ 100, causing the sender to lose far more tokens than the transfer amount, and ma | `2026__2026-01-12_MTToken_IncorrectFeeLogic.json` |
| 2024-06-01 | Crb2 | BSC | $15,000 | CRB token's tax/reward mechanism triggered an internal balance accumulation bug via repeated buy/sell cycles (70x) and direct transfers to the contract address  | `2024__2024-06-XX_Crb2_BuySellTransferIteration.json` |
| 2022-10-01 | HEALTH Token | Binance Smart Chain | ~16.64 BNB | When `transfer(address, 0)` is called 1,000 times repeatedly, the burn logic inside `_transfer()` burns tokens from the LP pair on every call, reducing the rese | `2022__2022-10_HEALTH_ZeroTransferBurnDrain.json` |
| 2022-11-01 | MBC Token / ZZSH Token | Binance Smart Chain | Unconfirmed | `swapAndLiquifyStepv1()` is callable by anyone without access control and uses `amountOutMin=0` for internal swaps, forcing execution even under manipulated res | `2022__2022-11_MBC_ZZSH_SwapLiquifyManipulation.json` |
| 2022-12-01 | RFB Token | Binance Smart Chain | Unconfirmed | RFB fee-on-transfer fees are injected directly into the pair without calling `sync()` after the swap, causing a `balanceOf(pair) > reserve(pair)` discrepancy. I | `2022__2022-12_RFB_FeeOnTransferSwapManipulation.json` |
| 2023-01-12 | BEVO Token | BSC | 144 BNB | The reflective token's `deliver()` function can be used to manipulate the LP balance, then `skim()` can be called to withdraw the surplus | `2023__2023-01-12_BEVO_ReflectiveTokenExploit.json` |
| 2023-01-19 | QTN Token | Ethereum | Unknown | Tax collection by the reflective tax token modifies the LP pair balance, but the reserve is not updated | `2023__2023-01-19_QTN_ReflectiveTaxSandwich.json` |
| 2023-01-19 | Upswing Finance | Ethereum | ~22 ETH | The reflective pressure calculation in `myPressure()` relies on manipulable LP balances | `2023__2023-01-19_Upswing_ReflectivePressureExploit.json` |
| 2023-01-25 | TINU | Ethereum | 22 ETH | Reflective ERC-20 `deliver()` function allows LP balance manipulation | `2023__2023-01-25_TINU_ReflectiveDeliverBalancer.json` |
| 2023-04-14 | OLIFE | None | ? |  | `2023__2023-04-14_OLIFE_DeliverReflectionDrain.json` |
| 2023-05-12 | HODLCapital | Ethereum | ~2.3 ETH | Reflective token `deliver()` call induces LP reserve imbalance, exploited via `skim()` | `2023__2023-05-12_HODLCapital_ReflectiveDeliver.json` |
| 2023-06-08 | STRAC Token | BSC | ~13 ETH equivalent | STRAC token's burn mechanism on transfer causes LP reserve imbalance, enabling arbitrage | `2023__2023-06-08_STRAC_TokenBurnExploit.json` |
| 2023-06-17 | Baby Doge Coin | BSC | ~100K USD | Fee mechanism not synchronized with LP reserves, allowing imbalance extraction via FeeFreeRouter | `2023__2023-06-17_BabyDogeCoin02_FeeLPManipulation.json` |
| 2023-06-22 | BUNN Token | BSC | Unknown | Calling the reflective token `deliver()` function reduces LP pair balance, enabling profit via swap | `2023__2023-06-22_BUNN_ReflectiveDeliver.json` |
| 2023-08-28 | Leetswap | None | ? |  | `2023__2023-08-28_Leetswap_FeeManipulation.json` |
| 2024-05-01 | Burner | Ethereum | ~1.7 ETH | The `convertAndBurn(address[] calldata tokens)` function accepts `address(0)` as a token address, causing ETH/token balance calculation errors during null addre | `2024__2024-05-XX_Burner_ConvertAndBurnNullToken.json` |
| 2024-10-01 | FIRE Token | Ethereum | ~20,000 USD (8.45 ETH) | FIRE `_transfer()` L274-279: Logic that inflates LP reserves when FIRE is transferred to the UniswapV2Pair address — the `isContract` check can be bypassed by r | `2024__2024-10-01_FireToken_TransferLPDrainExploit.json` |
| 2024-10-11 | P719 Token | BSC | ~312,000 USD (547 BNB) | When P719 transfer() sends tokens to itself, fee tokens are mishandled, causing price distortion | `2024__2024-10-11_P719Token_SellMechanism.json` |
| 2024-12-11 | LABUBU Token | BSC | ~12,048 USD (17.4 BNB) | The LABUBU token's `BuyOrSell()` function is automatically invoked on every transfer and relies on AMM reserve-based pricing, allowing price manipulation; repea | `2024__2024-12-11_LABUBU_TransferFeeManipulation.json` |
| 2024-12-18 | SlurpyCoin | BSC | ~3,000 USD | SlurpyCoin's `_transfer()` triggers BuyOrSell logic on direct transfers to the WBNB/SLURPY LP — repeated calls enable price manipulation | `2024__2024-12-18_SlurpyCoin_TransferFeeLoop.json` |
| 2025-03-07 | DUCKVADER | Base | ~5 ETH | `buyTokens()` allows token purchase by bypassing the fee without validating `msg.value` | `2025__2025-03-07_DUCKVADER_FeeManipulation.json` |
| 2025-03-20 | BBX Token | BSC | 11,902 BUSD | Exploitation of timing and burn amount calculation logic vulnerabilities in the auto-burn mechanism | `2025__2025-03-20_BBXToken_BurnMechanism.json` |
| 2025-04-04 | AIRWA Token | BSC | ~56.73 BNB | No access control on `setBurnRate()`, allowing anyone to set the burn rate to 100% | `2025__2025-04-04_AIRWA_BurnRateManipulation.json` |
| 2025-07-04 | RANT Token | BSC | ~311.4 BNB | `_autoBurnLiquidityPairTokens()` is triggered on every non-pair transfer and calls `rant_center.updateAllAverage()` using the current LP balance; an attacker wh | `2025__2025-07-04_RANTToken_ReflectionManipulation.json` |
| 2025-09-24 | NGP Token | BSC | ~2,000,000 USDT | Manipulation of `sync()` trigger conditions inside NGP token's `_update()`, drastically distorting pair price | `2025__2025-09-24_NGP_ReflectionToken-Manipulation.json` |
| 2026-03-10 | MovieToken | None | ? |  | `2026__2026-03-10_MovieToken_MT_PendingBurnLP_BSC.json` |
