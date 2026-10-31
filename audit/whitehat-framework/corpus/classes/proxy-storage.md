# proxy-storage

12 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2024-04-30 | PikeFinance | Ethereum | $1,695,841 | Storage layout change after upgrade shifted the `initialized` variable slot → unauthorized re-invocation of the initializer function | `2024__2024-04-30_PikeFinance_StorageCollision_ETH.json` |
| 2023-12-13 | Hypr Network | Ethereum | $220,000 | The `clearLegacySlot` modifier resets `Initializable`'s initialization flag (storage slot 0), allowing re-initialization | `2023__2023-12-13_HyprNetwork_BusinessLogic_ETH.json` |
| 2024-02-09 | DN404 | Ethereum | $200,000 | The proxy contract's `init()` function was callable by anyone, allowing re-initialization with arbitrary parameters and subsequent full FLIX balance drain via ` | `2024__2024-02-09_DN404_ProxyInitExploit.json` |
| 2024-04-01 | NGFS | BSC | $190,000 | The NGFS token contract exposes `delegateCallReserves()`, `setProxySync(address)`, and `reserveMultiSync(address, uint256)` without access control, allowing an  | `2024__2024-04-XX_NGFS_DelegateCallReservesExploit.json` |
| 2025-02-12 | Unverified Contract | BSC | $15,200 | The proxy contract's `initialize()` function was never called after deployment, allowing anyone to initialize it and execute `withdrawFees()` without authorizat | `2025__2025-02-12_Unverified_d4f1_UninitializedProxy.json` |
| 2023-02-27 | LaunchZone | BSC | Unknown | Upgradeable proxy contract implementation allowed execution of arbitrary callData, enabling abuse of user approvals | `2023__2023-02-27_LaunchZone_ProxyStorageCollision.json` |
| 2023-01-01 | LFI | None | ? |  | `2023__2023-05-xx_LFI_DelegatecallRewardLoop.json` |
| 2023-01-01 | LocalTrader | None | ? |  | `2023__2023-05-xx_LocalTrader_ProxyStorageSlotManipulation.json` |
| 2023-06-09 | DEPUSDT / LEVUSDC | Ethereum | ~36K (LEVUSDC) + ~69K (DEPUSDT) = ~105K USD | No access control on the proxy contract's `approveToken()` function | `2023__2023-06-09_DEPUSDT_LEVUSDC_ProxyApproval.json` |
| 2023-12-26 | Telcoin | None | ? |  | `2023__2023-12-26_Telcoin_ProxyReinitialization.json` |
| 2025-03-30 | LeverageSIR | Ethereum | ~353,800 USD (17,814 USDC + 1.4085 WBTC + 119.87 WETH) | Transient storage slot collision (EIP-1153): `uniswapV3SwapCallback` reads pool address from `tload(1)` but overwrites the same slot via `tstore(1, amount)`, le | `2025__2025-03-30_LeverageSIR_Create2Exploit.json` |
| 2025-06-11 | AAVEBoost | Ethereum | 14,800 USD | Arithmetic error in AaveBoost.proxyDeposit() that over-distributes aToken balances when called repeatedly with amount 0 | `2025__2025-06-11_AAVEBoost_ProxyDepositDrain.json` |
