# private-key-compromise

14 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2022-03-23 | Ronin Network | Ethereum Mainnet | $625,000,000 | 5 of 9 validator keys were compromised (4: Sky Mavis, 1: Axie DAO), satisfying the multisig quorum (5/9) required by `withdrawERC20For()` to drain the bridge | `2022__2022-03-23_Ronin_CompromisedValidatorSignatures.json` |
| 2021-03-07 | PAID Network | Ethereum | $180,000,000 | The key with access to the mint() function was compromised (or rug pulled), enabling unlimited token minting | `2021__2021-03-07_PAID_Network_UnauthorizedMint.json` |
| 2022-06-23 | Harmony Horizon Bridge | Ethereum Mainnet | $100,000,000 | 2 validator keys compromised from a 2/5 multisig bridge — immediate large-scale asset withdrawal | `2022__2022-06-23_Harmony_CompromisedMultisig.json` |
| 2025-07-15 | BigONE | Ethereum | $27,000,000 | Supply Chain Compromise — tampering of hot wallet withdrawal approval logic via third-party software | `2025__2025-07-15_BigONE_Exploit_ETH.json` |
| 2025-12-24 | Trust Wallet Chrome Browser Extension | Ethereum | $8,500,000 | Sha1-Hulud npm supply chain attack stole developer credentials → Chrome Web Store API key leaked → malicious extension (v2.68) deployed → seed phrases transmitt | `2025__2025-12-24_TrustWallet_Exploit_ETH.json` |
| 2021-09-17 | Sushi MISO | Ethereum | $3,000,000 | Attacker injected an init() callback into the deployment script, replacing the auction wallet address with the attacker's address | `2021__2021-09-17_SushiMiso_DutchAuction_AccessControl.json` |
| 2021-07-20 | Levyathan | BSC | Entire protocol TVL (exact amount unconfirmed) | Development team exposed the private key of the mint-privileged wallet on GitHub — attacker waited out the Timelock delay, seized MasterChef ownership, and mint | `2021__2021-07-20_Levyathan_PrivateKeyLeak_MintOwnership.json` |
| 2022-06-09 | Optimism | Optimism | 20,000,000 OP tokens temporarily taken — an unknown actor deployed to the vanity address and claimed the tokens, but returned all 20M OP to Wintermute after negotiations (~1 week). Net permanent loss: $0. | Wintermute sent OP tokens to a vanity address (CREATE opcode-based) that was deployed on Ethereum but had never been deployed on Optimism. The PoC demonstrates  | `2022__2022-06-09_Optimism_WintermuteVanityAddress.json` |
| 2025-03-25 | YziAI Token | BSC | ~376 BNB | Hidden backdoor in transferFrom activated when a special magic number (1199002345) is passed as the amount | `2025__2025-03-25_YziAIToken_Backdoor.json` |
| 2025-05-13 | IRYSAI Token | BSC | 69,600 USD | Backdoor mechanism that changes the tax wallet via setTaxWallet() and then drains LP pool assets | `2025__2025-05-13_IRYSAI_Rugpull.json` |
| 2025-05-21 | YDT Token | BSC | Unknown (USDT profit) | Hidden function accessible only via a special function selector (0xec22f4c7) that directly moves tokens from the LP pool | `2025__2025-05-21_YDTToken_SpecialSelector.json` |
| 2026-05-21 | Polymarket | Polygon PoS | ? | Compromised private key of a long-lived internal operational hot wallet used for automated payout top-ups, with no per-interval withdrawal rate limit and no KMS | `2026__2026-05-21_Polymarket_TopUpWalletKeyCompromise_Polygon.json` |
| 2026-05-23 | StablR | Ethereum | ? | Compromised private key in a weak 1-of-3 multisig (effectively single-signer) allowed attacker to seize sole owner control and invoke unrestricted `mint()` on b | `2026__2026-05-23_StablR_MultisigKeyCompromiseMint_ETH.json` |
| 2026-05-30 | Gravity Bridge | Ethereum | ? | Off-chain validator/orchestrator signing keys compromised; attacker produced genuinely-signed valset updates and withdrawal batches that the on-chain contract c | `2026__2026-05-30_GravityBridge_ValidatorSigningKeyCompromise_ETH.json` |
