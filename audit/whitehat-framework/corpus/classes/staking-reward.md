# staking-reward

45 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2023-04-13 | yearnFinance | Ethereum | $11,000,000 | yUSDT vault incorrectly used bZx strategy parameters for USDC → manipulated yield recommendations → artificially inflated PricePerShare | `2023__2023-04-13_yearnFinance_MisconfiguredVault_ETH.json` |
| 2021-05-07 | Value DeFi / Alpaca Finance | BSC | $10,000,000 | Invalid share calculation: during Alpaca's `work()` execution, ValueDeFi read the WBNB vault balance after the transfer to the worker but before the debt was re | `2021__2021-05-07_ValueDeFi_AlpacaVault_BusinessLogic.json` |
| 2023-06-17 | Pawnfi | Ethereum | $820,000 | Unauthorized `setCollectRate()` call permitted — staking collect rate manipulated via untrusted input | `2023__2023-06-17_Pawnfi_UntrustedInput_ETH.json` |
| 2025-01-14 | The Idols NFT | Ethereum | $340,503 | Infinite reward snapshot reset loop due to missing self-transfer validation in the `_beforeTokenTransfer` hook | `2025__2025-01-14_TheIdolsNFT_BusinessLogic_ETH.json` |
| 2023-06-23 | Shido | BSC | $326,000 | Incorrect `lockTimestamp` configuration in the ShidoLock contract — a business logic flaw combining the V1→V2 conversion ratio with the token pool price discrep | `2023__2023-06-23_Shido_BusinessLogic_BSC.json` |
| 2026-03-02 | Inverse Finance FiRM | Ethereum Mainnet | $242,000 | ERC4626 sDOLA vault yield sniping + cascading liquidations via LLAMMA price manipulation | `2026__2026-03-02_InverseFinance_FiRM_sDOLA_YieldSniping_LLAMMA_ETH.json` |
| 2024-05-01 | Liquiditytokens | BSC | $200,000 | The three functions `join()` (0x28ffe6c8), `stake()` (0xa694fc3a), and `lock()` (0xdd467064) are externally callable without access control, allowing an attacke | `2024__2024-05-XX_Liquiditytokens_JoinStakeLockExploit.json` |
| 2023-05-10 | SNK | BSC | $197,000 | Child account balance summation error in `rewardPerToken()` calculation — the reward owed to a parent account is multiplied by the sum of all child account bala | `2023__2023-05-10_SNK_RewardCalculation_BSC.json` |
| 2024-05-01 | OSN | BSC | $109,000 | The reward distribution contract does not check token hold duration, allowing immediate reward claims after acquiring a large balance within a single block | `2024__2024-05-XX_OSN_RewardDistributionNoHoldDuration.json` |
| 2022-11-15 | SheepFarm | BSC | $72,000 | No call limit on register() → same address registered 402 times to accumulate rewards | `2022__2022-11-15_SheepFarm2_RegisterRewardExploit.json` |
| 2024-06-01 | INcufi | BSC | $60,000 | The `STAKE()` function allows a lock duration of 0, the `withdral()` function contains a typo that bypasses internal validation, and `swapCommision()` accumulat | `2024__2024-06-XX_INcufi_StakeZeroDayWithdralSwapCommision.json` |
| 2024-05-01 | TGC | BSC | $32,000 | Calling selector `0x836aefb0` on the vulnerable contract with a 100 trillion TGC parameter to manipulate internal state, then after a 5-hour timestamp manipulat | `2024__2024-05-XX_TGC_SelectorBasedRewardManipulation.json` |
| 2025-01-11 | LPMine | BSC | $24,000 | `extractReward()` calculates rewards based on pair reserves without updating the timestamp, allowing repeated claims | `2025__2025-01-11_LPMine_UnboundedRewardClaim.json` |
| 2024-04-01 | GFA | BSC | $14,000 | Selector functions `0x5f7938f1` and `0x3890ec92` on the reward contract were callable by anyone without access control, allowing an attacker to generate excessi | `2024__2024-04-XX_GFA_RewardSelectorExploit.json` |
| 2024-06-01 | NCD | BSC | $6,400 | `preStartTimeRewards()` allows unauthorized reward accumulation before the start time, and `ack()` allows arbitrary withdrawal of accumulated rewards — exploite | `2024__2024-06-XX_NCD_PreStartTimeRewardsAck.json` |
| 2025-02-03 | Peapods Finance | Ethereum | $3,500 | `depositFromPairedLpToken()` allows the slippage parameter to be set to 999 without input validation, enabling reward calculation manipulation | `2025__2025-02-03_PeapodsFinance_TokenRewardManipulation.json` |
| 2023-09-05 | JumpFarm | Ethereum | $2 | Reentrancy possible in reward calculation during unstake in the staking contract | `2023__2023-09-05_JumpFarm_Staking.json` |
| 2022-09-01 | DPC Token Staking | Binance Smart Chain | Unconfirmed | No reward amount validation on repeated `claimStakeLp()` calls | `2022__2022-09_DPC_StakingRewardManipulation.json` |
| 2022-10-01 | BabySwap | Binance Smart Chain | Unconfirmed (BABY tokens) | The `SwapMining` contract does not validate the Factory used by the router, allowing swap records to be manipulated via a fake Factory | `2022__2022-10_BabySwap_FakeFactoryRewardDrain.json` |
| 2022-10-01 | HPAY Bonus Staking | Binance Smart Chain | ~115 BNB | `setToken()` lacks access control, allowing arbitrary replacement of the staking token; attacker staked large amounts of a fake token then withdrew HPAY rewards | `2022__2022-10_HPAY_FakeTokenStakingDrain.json` |
| 2022-10-01 | RL Token | Binance Smart Chain | Unconfirmed | `distributeAirdrop()` does not validate whether an address has already claimed the airdrop, allowing multiple contracts deployed via CREATE2 to claim repeatedly | `2022__2022-10_RL_AirdropMultiContractDrain.json` |
| 2022-11-01 | sDAO Token | Binance Smart Chain | Unconfirmed | sDAO token transfers manipulate the `totalStakeReward` state variable, enabling excess reward extraction via `withdrawTeam()` calls | `2022__2022-11_SDAO_StakeRewardManipulation.json` |
| 2022-12-01 | Nimbus Platform | Binance Smart Chain | Unconfirmed | `StakingRewardFixedAPY.getReward()` reward calculation directly depends on the AMM spot price via `NimbusRouter.getPrice()`, allowing arbitrary reward amplifica | `2022__2022-12_Nmbplatform_StakingRewardManipulation.json` |
| 2023-01-18 | OmniEstate | BSC | Unknown (~thousands USD) | Passing `end_date=0` to `invest()` allows immediate withdrawal with no lock period | `2023__2023-01-18_OmniEstate_StakingLogicFlaw.json` |
| 2023-01-01 | Bitpaidio | None | ? |  | `2023__2023-05-xx_Bitpaidio_StakingLockBypass.json` |
| 2023-01-01 | FAPEN | None | ? |  | `2023__2023-05-xx_FAPEN_UnstakeWrongBalanceCheck.json` |
| 2023-01-01 | SELLC02 | None | ? |  | `2023__2023-05-xx_SELLC02_StakingReferralChainReward.json` |
| 2023-01-01 | SELLC | None | ? |  | `2023__2023-05-xx_SELLC_StakingRewardReferralManipulation.json` |
| 2023-01-01 | SNK | None | ? |  | `2023__2023-05-xx_SNK_StakingRewardChildMultiplier.json` |
| 2023-08-28 | EHIVE | None | ? |  | `2023__2023-08-28_EHIVE_StakingOrderManipulation.json` |
| 2023-09-05 | QuantumWN | Ethereum | ~0.5 ETH | Double reward payout due to incorrect rebase flag handling in the unstake function | `2023__2023-09-05_QuantumWN_Staking.json` |
| 2023-09-15 | FloorDAO | None | ? |  | `2023__2023-09-15_FloorDAO_StakingRebase.json` |
| 2023-09-20 | Kub | None | ? |  | `2023__2023-09-20_Kub_Split_StakingArbitrage.json` |
| 2024-03-01 | Juice Finance | Ethereum | ~54 ETH | Reward calculation logic flaw allowing disproportionately large rewards to be claimed via `harvest()` after just 1 block following `stake()` | `2024__2024-03-XX_Juice_StakingRewardLogicFlaw.json` |
| 2024-06-01 | JokInTheBox | Ethereum | ~9.2 ETH | The `unstake(uint256 index)` function does not delete the staking entry after withdrawal, allowing repeated calls with the same index=0; after a 3-day waiting p | `2024__2024-06-XX_JokInTheBox_UnstakeIndexZeroRepeat.json` |
| 2024-06-01 | WIFCOIN | Ethereum | ~3.4 ETH | `claimEarned(uint256 burnRate)` can be called repeatedly with the same burnRate=10 until the reward balance is exhausted; staking state is not invalidated after | `2024__2024-06-XX_WIFCOIN_ClaimEarnedBurnRateRepeat.json` |
| 2024-08-20 | NovaXM2E | BSC | ~25,000 USD | `stake()` converts tokens to USDT value before storing — after spot price manipulation, `withdraw()` returns more tokens than originally staked | `2024__2024-08-20_NovaXM2E_StakingPriceSandwich.json` |
| 2024-09-17 | OTSea Staking | Ethereum | ~26,000 USD | `claim()`/`withdraw()` allowed duplicate indexes in the input array, enabling repeated collection from the same staking position | `2024__2024-09-17_OTSeaStaking_DuplicateIndexDrain.json` |
| 2024-11-21 | Matez Staking | BSC | ~80,000 USD | Integer truncation in `stake()` — inputs ≥ 2^128 truncate to 0 on transfer, recording a large stake with no tokens sent, allowing free reward claims | `2024__2024-11-21_Matez_IntegerTruncationStaking.json` |
| 2025-01-08 | SorraStaking | Ethereum | ~8 ETH | During staking reward calculation, only the block timestamp was updated while the block number was not, causing accumulated reward errors on repeated withdrawal | `2025__2025-01-08_SorraStaking_RewardCalculationFlaw.json` |
