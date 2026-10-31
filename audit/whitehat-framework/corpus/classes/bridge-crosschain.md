# bridge-crosschain

5 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2022-08-01 | Nomad Bridge | Ethereum Mainnet | $190,000,000 | Improper initialization of the Replica contract set `messages[0x0] = PROVEN`, causing arbitrary messages to be treated as valid | `2022__2022-08-01_NomadBridge_MessageVerification.json` |
| 2022-02-05 | Meter.io Bridge | Moonriver | $4,400,000 | When calling `swapExactTokensForTokens()`, native tokens (BNB/ETH) and wrapped tokens (WBNB/WETH) were not distinguished, allowing withdrawal of arbitrary amoun | `2022__2022-02-05_Meter_BridgeNativeTokenConfusion.json` |
| 2026-04-13 | Dango | T.E.A.M Blockchain | $410,010 | Donation logic flaw in Dango's perpetuals insurance fund contract — the donation function failed to validate the amount credited, allowing an attacker to extrac | `2026__2026-04-13_Dango_BridgeCrossChain_ETH.json` |
| 2026-05-17 | Verus Ethereum Bridge | Ethereum | ? | `checkCCEValues()` failed to verify that the sum of payout amounts in the import payload did not exceed the actual source-chain deposit totals (`CCE.totalAmount | `2026__2026-05-18_VerusBridge_SourceAmountValidationBypass_ETH.json` |
| 2026-05-29 | Alephium TokenBridge | Ethereum + BNB Chain | ? | Off-chain guardian backend signed VAAs for a **forged transfer event** emitted by an attacker-deployed Alephium contract; valid VAAs then authorized **unbacked* | `2026__2026-05-29_Alephium_ForgedGuardianVAA_ETH.json` |
