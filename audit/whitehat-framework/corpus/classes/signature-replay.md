# signature-replay

13 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2023-12-31 | Orbit Chain | Ethereum | $81,500,000 | The multi-signature verification logic in `withdraw()` accepted forged signatures as valid, allowing unauthorized withdrawals | `2023__2023-12-31_OrbitChain_SignatureForgery.json` |
| 2022-01-18 | Anyswap | Ethereum Mainnet | $3,000,000 | `anySwapOutUnderlyingWithPermit()` processed permit parameters (v=0, r/s empty) without validation, enabling unauthorized transfer of other users' WETH | `2022__2022-01-18_Anyswap_PermitSignatureReplay.json` |
| 2021-07-10 | ChainSwap | Ethereum | $800,000 | In `receive()` signature verification, the `signatory == signatures[i].signatory` check does not validate the actual signer, allowing the same signatory to be r | `2021__2021-07-10_Chainswap_ETH_SignatureReuse.json` |
| 2024-05-01 | Tradeonorion | BSC | $645,000 | A flaw in the signature verification logic of `redeemAtomic()` allowed attacker-controlled signatures to be accepted as valid, enabling the combined use of `dep | `2024__2024-05-XX_Tradeonorion_RedeemAtomicSignatureBypass.json` |
| 2022-07-21 | Quixotic | Optimism | $80,000 | `fillSellOrder()` only validates the seller's signature and omits buyer authentication | `2022__2022-07-21_Quixotic_SignatureBypass.json` |
| 2025-01-27 | ODOS Limit Order Router | Base | $50,000 | ERC-6492 signature handling in `isValidSigImpl()` allows arbitrary contract deployment and calldata execution via the `allowSideEffects=true` option | `2025__2025-01-27_ODOS_ERC6492SignatureBypass.json` |
| 2024-05-01 | TCH | BSC | $18,000 | The `burnToken(uint256 amount, uint256 nonce, bytes memory signature)` function accepts manipulated signatures as valid even when the last byte (`v` value) is a | `2024__2024-05-XX_TCH_BurnTokenSignatureMalleable.json` |
| 2022-10-01 | BEGO Token | Binance Smart Chain | ~12 WBNB | The `mint()` function accepts an empty signature array, allowing arbitrary minting without signature verification | `2022__2022-10_BEGO_SignatureBypassMinting.json` |
| 2022-11-23 | NUM Token | Ethereum Mainnet | Victim's entire NUM token balance | `anySwapOutUnderlyingWithPermit()` does not validate the EIP-2612 permit signature, allowing arbitrary victims' tokens to be bridged | `2022__2022-11-23_NUM_MultichainPermitBypass.json` |
| 2022-11-01 | Abracadabra Money | Ethereum Mainnet | Unconfirmed | `setMasterContractApproval()` processes an invalid signature with `v=0` as a valid approval | `2022__2022-11_Kashi_InvalidSignatureApproval.json` |
| 2023-07-01 | AzukiDAO | None | ? |  | `2023__2023-07-01_AzukiDAO_SignatureReplay.json` |
| 2023-07-10 | MintoFinance | None | ? |  | `2023__2023-07-10_MintoFinance_SignatureBypass.json` |
| 2026-02-27 | Squid Protocol* | BNB Chain | ? | Signature Replay Attack — nonce `0xf9a0d115` not invalidated after use | `2026__2026-02-27_SquidProtocol_SignatureReplay_BSC.json` |
