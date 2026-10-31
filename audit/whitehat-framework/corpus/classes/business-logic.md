# business-logic

137 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2023-04-03 | LowCarbCrusader | Ethereum | $25,000,000 | Business logic flaw in MEV-Boost relay — block body (bundle) exposed to proposer even when block header signature is invalid | `2023__2023-04-03_LowCarbCrusader_BusinessLogic_ETH.json` |
| 2024-03-28 | PrismaFi | Ethereum | $11,600,000 | `MigrateTroveZap.migrate()` does not validate the `account` parameter, allowing an arbitrary account's collateral (wstETH) to be transferred to the attacker | `2024__2024-03-28_PrismaFi_MigrateExploit_ETH.json` |
| 2021-05-16 | bEarn Fi | BSC | $11,000,000 | Repeated deposit→emergencyWithdraw cycle on bVault pool 13 manipulates internal accounting to enable duplicate withdrawals | `2021__2021-05-16_bEarn_BUSD_DepositWithdrawLoop.json` |
| 2021-12-21 | Visor Finance | Ethereum | $8,200,000 | RewardsHypervisor.deposit() trusted the return value of the recipient's owner(), allowing an attacker contract to return an arbitrary address as owner and drain | `2021__2021-12-21_Visor_Finance_DepositUnprotected.json` |
| 2021-06-02 | PancakeHunny | BSC | $7,000,000 | mintFor() calculates mint amount using the contract's current balanceOf() instead of the received token amount, making it manipulable via direct transfer | `2021__2021-06-02_PancakeHunny_BalanceOf_MintManipulation.json` |
| 2024-06-01 | Velocore | Linea | $6,880,000 | Calling `velocore__execute()` 3 times with the same parameters causes cumulative errors in the pool's internal balance accounting, allowing withdrawal of more U | `2024__2024-06-XX_Velocore_ExecutePoolAccountingBug.json` |
| 2025-03-05 | 1inch Fusion V1 Settlement | Ethereum | $5,000,000 | Calldata corruption via unsigned integer comparison error in Yul assembly (Business Logic Flaw) | `2025__2025-03-05_1inchFusionV1_BusinessLogic_ETH.json` |
| 2025-07-09 | ZKSwap | Ethereum | $5,000,000 | `verifyExitProof()` unconditionally returns `true` without validating the actual ZK proof — a business logic flaw that allowed draining of L1 bridge funds | `2025__2025-07-09_ZKSwap_BusinessLogic_ETH.json` |
| 2024-09-20 | Shezmu | Ethereum | $4,900,000 | Missing access control on `mint()` in the collateral token (MockERC20) — anyone could mint unlimited collateral | `2024__2024-09-20_Shezmu_BusinessLogic_ETH.json` |
| 2024-03-01 | SSS | Blast | $4,800,000 | Bypassed `maxAmountPerTx()` transfer limit via recursive self-transfer, then sent the excessively accumulated SSS tokens to the pool and swapped for WETH | `2024__2024-03-XX_SSS_TransferLimitBypass.json` |
| 2024-05-24 | Kraken | Base | $3,000,000 | Failure to distinguish internal transfer status in deposit transactions — immediate credit on main transaction success without detecting internal revert | `2024__2024-05-24_Kraken_AccountingError_Base.json` |
| 2026-02-01 | CrossCurve | Multi-chain | $2,760,000 | Business logic flaw due to missing access control on `expressExecute()` and Axelar gateway validation bypass | `2026__2026-02-01_CrossCurve_BusinessLogic_Celo.json` |
| 2025-05-11 | MBU Token | BSC | $2,157,126 | Explosive token mint inflation caused by a duplicate `1e18` multiplication in price calculation within the `deposit()` function | `2025__2025-05-11_MBUToken_BusinessLogic_BSC.json` |
| 2022-04-03 | GymNetwork | BSC | $2,100,000 | `LiquidityMigrationV2.migrate()` does not validate the token source, allowing attacker LP to be exchanged for GYMNET LP | `2022__2022-04-03_GymNetwork_MigrationExploit.json` |
| 2024-09-26 | Bedrock | Ethereum | $2,000,000 | Misconfiguration — ETH/uniBTC exchange rate not set | `2024__2024-09-26_RockX_UniBTC_Misconfiguration_ETH.json` |
| 2025-10-04 | Abracadabra | Ethereum | $1,793,766 | An unimplemented Action (ID=0) in the `cook()` function initializes `CookStatus` to its default value, allowing bypass of the solvency check | `2025__2025-10-04_Abracadabra_BusinessLogic_ETH.json` |
| 2023-12-17 | Floor Protocol | Ethereum | $1,600,000 | The `extMulticall` function of ERC1967Proxy allows execution of arbitrary calldata against arbitrary contracts without any caller validation | `2023__2023-12-17_FloorProtocol_BusinessLogic_ETH.json` |
| 2022-06-29 | GymNetwork | BSC | $1,400,000 | The `depositFromOtherContract()` function can be called directly by external contracts without proper authorization checks, and a logic error allows calling `wi | `2022__2022-06-29_GymNetwork2_DepositWithdrawExploit.json` |
| 2023-10-11 | BH Token | BSC | $1,270,000 | LP ratio manipulation via repeated `Upgrade()` calls — Business Logic Flaw (Price Manipulation via Business Logic Flaw) | `2023__2023-10-11_BHToken_BusinessLogic_BSC.json` |
| 2023-05-02 | Level Finance | BSC | $1,100,000 | Missing duplicate epoch ID validation in the `claimMultiple()` input array, allowing unlimited repeated claims of the same epoch's rewards | `2023__2023-05-02_LevelFinance_ReferralClaimDrain_BSC.json` |
| 2022-04-21 | Zeed Finance | BSC | $1,000,000 | The automatic reward mechanism on YEED token transfers deposits additional YEED into the LP pool, allowing an attacker to repeatedly call `skim()` to drain the  | `2022__2022-04-21_Zeed_SkimRewardManipulation.json` |
| 2023-08-27 | Balancer | Ethereum | $979,000 | BPT (Balancer Pool Token) exchange rate manipulation via precision loss in the Boosted Pool (Linear Pool) | `2023__2023-08-27_Balancer_BoostedPoolVuln_ETH.json` |
| 2024-05-26 | Normie | Base | $881,686 | `_get_premarket_user()` flawed authorization logic → conditional unlimited minting triggered inside `_transfer()` | `2024__2024-05-26_Normie_BusinessLogic_Base.json` |
| 2023-12-05 | BEARNDAO | BSC | $769,000 | Missing `amountOutMin` validation in the `convertDustToEarned()` function's token swap enables price manipulation via flash loan | `2023__2023-12-05_BEARNDAO_SlippageProtection_BSC.json` |
| 2024-03-14 | MO Token | Optimism | $750,000 | Business logic flaw enabling unlimited MO token withdrawal from the LP pool via repeated `borrow()` + `redeem()` calls | `2024__2024-03-14_MOToken_BusinessLogic_OP.json` |
| 2023-05-23 | CS Token | BSC | $714,285 | Excessive LP burn using outdated global variable `sellAmount` — business logic flaw | `2023__2023-05-23_CSToken_BusinessLogic_BSC.json` |
| 2026-03-23 | BCE Token | BNB Smart Chain | $679,000 | The state variable `scheduledDestruction`, which can be influenced by users, burns tokens directly from the PancakeSwap pair — the destruction amount derived fr | `2026__2026-03-23_BCEToken_BusinessLogic_BSC.json` |
| 2024-05-28 | Orion Protocol | BSC | $645,000 | `redeemAtomic()` business logic flaw — double-draining stake balance via signed orders during stake release request, then over-withdrawing | `2024__2024-05-28_OrionProtocol_BusinessLogic_BSC.json` |
| 2024-07-21 | UtopiaSphere | BSC | $521,225 | `_swapBurn()` logic burns 95% of the transferred amount, reducing the AMM reserve to 1 wei and causing an extreme imbalance | `2024__2024-07-21_UPS_BusinessLogic_BSC.json` |
| 2026-03-22 | Cyrus Finance | BSC | $512,000 | `slot0()` spot price dependency in `withdrawUSDTFromAny()` → price manipulable within the same transaction (Business Logic Flaw) | `2026__2026-03-22_CyrusFinance_BusinessLogic_BSC.json` |
| 2024-12-10 | CloberDEX | Base | $501,279 | `pool.reserveA/B` state variables updated after the external `burnHook` callback executes in the `_burn` function — Checks-Effects-Interactions pattern violatio | `2024__2024-12-10_CloberDEX_Reentrancy_Base.json` |
| 2024-05-01 | NORMIE | Base | $490,000 | Transferring NORMIE fee-on-transfer tokens to the pair and repeatedly calling `skim()` 50 times accumulates a discrepancy between the actual balance and reserve | `2024__2024-05-XX_NORMIE_SkimFeeOnTransferExploit.json` |
| 2024-01-12 | Wise Lending | Ethereum | $464,000 | Empty pool first depositor inflation + Faulty health factor calculation (Business Logic Flaw) | `2024__2024-01-12_WiseLending_BusinessLogic_ETH.json` |
| 2024-05-14 | Predy Finance | Arbitrum | $464,000 | Cross-pair liquidity theft inside `trade()` callback (accounting validation ordering error) | `2024__2024-05-14_PredyFinance_AccountingError_ARB.json` |
| 2026-02-13 | OCA | BNB Smart Chain | $433,000 | Business Logic Flaw — `sellOCA()` / `swapHelper()` functions allowed unauthorized LP reserve manipulation during flash swap callbacks | `2026__2026-02-13_OCA_BusinessLogic_BSC.json` |
| 2025-08-29 | Cozy Finance | Optimism | $427,606 | Missing validation of the `receiver_` argument in `unwrapWrappedAssetViaConnectorForWithdraw` | `2025__2025-08-29_CozyFinance_BusinessLogic_OP.json` |
| 2024-03-01 | MO Finance | Optimism | $413,000 | `Loan.borrow()` can be called repeatedly without proper collateral or duplicate borrow validation, and `redeem()` executes without position validity checks, dra | `2024__2024-03-XX_MO_BorrowRedeemLogicFlaw.json` |
| 2024-12-04 | VestraDAO | Ethereum | $378,400 | Missing `isActive` state validation in `unStake()` — repeated calls on an already-unstaked position extracted 20,000 VSTR profit each time | `2024__2024-12-04_VestraDAO_BusinessLogic_ETH.json` |
| 2020-08-04 | Opyn Protocol | Ethereum Mainnet | $371,260 | The `exercise` function allowed options to be exercised against multiple vaults using the same `msg.value` (ETH) | `2020__2020-08-04_Opyn_DoubleExercise.json` |
| 2025-01-14 | The Idols NFT | Ethereum | $340,503 | Infinite reward snapshot reset loop due to missing self-transfer validation in the `_beforeTokenTransfer` hook | `2025__2025-01-14_TheIdolsNFT_BusinessLogic_ETH.json` |
