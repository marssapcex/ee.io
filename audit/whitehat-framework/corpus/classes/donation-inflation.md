# donation-inflation

10 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2023-03-13 | Euler Finance | Ethereum | $197,000,000 | Unlimited debt creation without collateral via donateToReserves + mint combination, followed by self-liquidation to realize profit | `2023__2023-03-13_EulerFinance_DonateToReserves_ETH.json` |
| 2024-05-01 | Sonne Finance | Optimism | $20,000,000 | Exploited a timelock-scheduled soVELO parameter change to mint a small amount of soVELO, then directly donated a large amount of VELO to the soVELO contract to  | `2024__2024-05-XX_Sonne_CompoundDonateExploit.json` |
| 2025-02-12 | zkLend | Starknet | $9,500,000 | Precision loss in `safe_decimal_math::div()`: an attacker uses flash loans to inflate the `lending_accumulator` to `~4.069×10^45`, then exploits integer truncat | `2025__2025-02-12_zkLend_PrecisionLoss_Starknet.json` |
| 2024-11-19 | Polter Finance | Fantom | $8,700,000 | The oracle for the newly listed BOO lending market relied directly on SpookySwap liquidity pool spot prices — the attacker drained the pool via flash loan to in | `2024__2024-11-19_PolterFinance_EmptyMarket_FTM.json` |
| 2024-01-02 | Radiant Capital | Arbitrum | $4,500,000 | Manipulation of `liquidityIndex` to an extreme value by exploiting `rayDiv` rounding errors in the newly deployed, empty USDC market | `2024__2024-01-02_RadiantCapital_EmptyMarketRounding_ARB.json` |
| 2026-03-15 | Venus Protocol | BNB Smart Chain | $1 | Exchange rate inflation via donation + monetizing inflated collateral value via borrowBehalf | `2026__2026-03-15_Venus_THE_BorrowBehalf_Donation_Attack.json` |
| 2023-12-29 | ChannelsFinance | None | ? |  | `2023__2023-12-29_ChannelsFinance_DonationAttack.json` |
| 2025-02-27 | Venus Protocol | zkSync Era | ~86.7 WETH | Directly donating USDM to the wUSDM vault to artificially inflate share value, then repeatedly triggering over-collateralized liquidations to acquire vWETH | `2025__2025-02-27_Venus_ZKSync_DonationAttack.json` |
| 2025-06-14 | BankrollNetwork | BSC | ~24.5 WBNB | Exploitation of logic in the `donatePool` function that distributes excessive dividends to existing token holders | `2025__2025-06-14_BankrollNetwork_DonatePoolExploit.json` |
| 2025-06-19 | Gangster Finance | BSC | ~16,500 USD | After donate, a small depositTo immediately makes the donated amount harvestable as profit | `2025__2025-06-19_Gangsterfinance_DonateDepositExploit.json` |
