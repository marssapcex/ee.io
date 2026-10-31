# unprotected-callback

11 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2024-05-01 | Predy Finance | Arbitrum | $464,000 | Registering a malicious pair via `registerPair()` and draining assets from the Predy Finance pool through arbitrary call execution inside the `predyTradeAfterCa | `2024__2024-05-XX_PredyFinance_RegisterPairCallbackExploit.json` |
| 2022-09-13 | BNB48 MEV Bot | Binance Smart Chain | $140,000 | The MEV Bot's `pancakeCall()` function does not validate the caller, allowing any arbitrary address to withdraw tokens | `2022__2022-09-13_BNB48MEVBot_UnprotectedCallback.json` |
| 2024-05-01 | MixedSwapRouter | Arbitrum | $10,000 | The `algebraSwapCallback()` function does not validate `msg.sender`, allowing an attacker to call the callback directly and transfer tokens held by the router t | `2024__2024-05-XX_MixedSwapRouter_AlgebraSwapCallbackValidation.json` |
| 2023-05-09 | LW | None | ? |  | `2023__2023-05-09_LW_ReceiveFunctionUnprotectedSwap.json` |
| 2024-07-18 | MEV Bot | Ethereum | ~18,000 USD | Missing caller validation in uniswapV3SwapCallback() allowing arbitrary token withdrawal | `2024__2024-07-18_MEVbot_0xdd7c_UniswapV3CallbackExploit.json` |
| 2024-07-28 | Unverified Contract | Ethereum | ~27 ETH | Missing `msg.sender` validation in `uniswapV3SwapCallback()`, allowing arbitrary WETH withdrawal | `2024__2024-07-28_UnverifiedContr_0x452E25_UniswapV3CallbackExploit.json` |
| 2024-09-06 | Unverified Contract 0x03f9 | Ethereum | ~1,700 USD | No msg.sender validation in uniswapV3SwapCallback — WETH drained via direct call | `2024__2024-09-06_Unverified03f9_SwapCallback.json` |
| 2024-09-18 | Unverified Contract | BNB Chain | ~100 USD | The `pancakeV3SwapCallback(int256, int256, bytes)` function does not validate `msg.sender`, allowing any arbitrary caller to force a WBNB transfer | `2024__2024-09-18_unverified_766a_PancakeV3CallbackExploit.json` |
| 2024-11-23 | AK1111 Token | BSC | ~31,500 USD | No access control on nonblockingLzReceive1() — anyone can call it to mint AK1111 tokens without limit | `2024__2024-11-23_Ak1111_UnprotectedLzReceive.json` |
| 2025-04-11 | Unverified Contract | Base | ~62,300 USD | Missing caller validation in the Uniswap V3 swap callback function of an unverified contract | `2025__2025-04-11_Unverified6077_CallbackExploit.json` |
| 2025-07-25 | WETC Token | BSC | ~101,000 USD | PancakeSwap swap callback allows mass token transfer without caller validation | `2025__2025-07-25_WETC_Token_PancakeSwapCallback.json` |
