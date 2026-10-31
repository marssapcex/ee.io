# approval-abuse

13 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2022-10-02 | TransitSwap | Binance Smart Chain | $28,900,000 | Missing `owner` parameter validation in `transferFrom` of the ClaimTokens contract, allowing an arbitrary victim to be specified | `2022__2022-10-02_TransitSwap_TransferFromOwnerBypass.json` |
| 2023-04-09 | SushiSwap | Ethereum | $3,300,000 | Unvalidated external call in RouteProcessor2 `processRoute()` allows theft of approved tokens | `2023__2023-04-09_SushiSwap_RouteProcessor_ETH.json` |
| 2026-05-05 | Ekubo Protocol | Ethereum Mainnet | $1,356,033 | `IPayer.pay` (selector `0x599d0714`) only checks `msg.sender == EkuboCore` but trusts an attacker-supplied `payer` field, allowing `transferFrom(payer, Core, am | `2026__2026-05-05_Ekubo_IPayerCallbackPayerSpoofing_ETH.json` |
| 2023-10-24 | Maestro | Ethereum Mainnet | $485,000 | Missing access control on function `0x9239127f` in the proxy pattern's logic contract — arbitrary token addresses and calldata could be passed to unauthorized s | `2023__2023-10-24_Maestro_ArbitraryCall_ETH.json` |
| 2022-10-01 | ULME Token | Binance Smart Chain | $250,000 | `buyMiner(address user, uint256 usdt)` function consumes the USDT allowance of an arbitrary address without validating the `user` parameter | `2022__2022-10_ULME_BuyMinerAllowanceDrain.json` |
| 2023-07-16 | USDTStakingContract28 | Ethereum | $21 | `tokenAllowAll()` function externally callable, allowing arbitrary token approvals | `2023__2023-07-16_USDTStaking_Approval.json` |
| 2023-10-22 | UniBot | None | ? |  | `2023__2023-10-22_UniBot_UnauthorizedTransfer.json` |
| 2024-02-14 | Babyloogn | BSC | ~2.24 WBNB | Airdrop contract holds `setApprovalForAll` over the Babyloogn NFT, and internal function selector `0xfbe81135` can be called repeatedly without access control | `2024__2024-02-14_Babyloogn_AirdropApprovalExploit.json` |
| 2024-04-01 | BNBX | BSC | ~5 ETH | The vulnerable contract uses selector `0x11834d4c` to call `transferFrom()` on BNBX tokens pre-approved by victims, then swaps them for WBNB | `2024__2024-04-XX_BNBX_AllowanceDrain.json` |
| 2024-08-12 | AAVE / Paraswap Repay Adapter | Ethereum | ~56,000 USD | `fromToken` approval granted to AUGUSTUS_SWAPPER after `swapAndRepay()` was not cleared, allowing reuse | `2024__2024-08-12_AAVERepayAdapter_ApprovalExploit.json` |
| 2024-09-04 | Unverified Contract 0x16d0 | Ethereum | ~329 USD | multiCallWithRevert() executes arbitrary calldata without validation — exploits addr2's USDT approval to execute transferFrom | `2024__2024-09-04_Unverified16d0_MultiCallTransferFrom.json` |
| 2024-10-29 | BUBAI / ORAAI Token | Ethereum | ~131,000 USD | ORAAI token contains logic that grants an unlimited allowance to the UniswapV2Pair address — attacker drains all tokens held by the LP via `transferFrom(Pair, a | `2024__2024-10-29_BUBAI_TransferFromAllowanceExploit.json` |
| 2025-08-13 | Coinbase | Ethereum | ~300,000 USD | Coinbase fee account mistakenly granted unlimited ERC-20 approve to 0x Settler, which allows arbitrary transferFrom execution | `2025__2025-08-13_Coinbase_ExcessiveApprovalDrain.json` |
