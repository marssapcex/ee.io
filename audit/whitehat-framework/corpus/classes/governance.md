# governance

9 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2022-07-23 | Audius | Ethereum Mainnet | $6,050,000 | The proxy contract's `initialize()` function could be re-called, allowing re-initialization with malicious governance parameters | `2022__2022-07-23_Audius_GovernanceManipulation.json` |
| 2022-05-08 | Fortress Loans | BSC | $3,000,000 | A governance proposal replaced the Chain oracle's price submitter with the attacker's contract, then drained all 13 lending markets using a manipulated fFTS col | `2022__2022-05-08_FortressLoans_OraclePriceGovernanceAttack.json` |
| 2024-01-05 | Loot DAO | Ethereum | $1,200,000 | Governance Attack — Missing Vote Token Locking (Flash Loan Vote Manipulation) | `2024__2024-01-05_Loot_GovernanceAttack_ETH.json` |
| 2022-02-17 | Build Finance | Ethereum Mainnet | $470,000 | Governance quorum not met, or a single large token holder unilaterally passed a malicious proposal to seize treasury and minting privileges | `2022__2022-02-17_BuildFinance_GovernanceAttack.json` |
| 2022-10-01 | Xave Finance | Ethereum Mainnet | 100,000,000,000,000 RNBW tokens (ownership takeover) | SafeSnap DAO module did not validate proposal transactions, allowing arbitrary transaction execution | `2022__2022-10_XaveFinance_GovernanceDAOModuleAttack.json` |
| 2023-12-17 | GoodCompound | None | ? |  | `2023__2023-12-17_GoodCompound_GovernanceExploit.json` |
| 2024-03-23 | CurioEcosystem | None | ? |  | `2024__2024-03-23_CurioEcosystem_GovernanceAttack_ETH.json` |
| 2024-03-01 | CurioDAO | Ethereum | ~998 billion CGT | In the DSChief governance system of a MakerDAO fork, the attacker locked CGT tokens → voted → lifted a malicious address to the highest authority (hat), then ex | `2024__2024-03-XX_CGT_GovernanceTakeover.json` |
| 2026-06-09 | TOP / "Token of Power" governance | Ethereum | ? | Low-cost quorum capture + no timelock: attacker cheaply bought >50% voting power, then atomically created, voted, and executed a malicious proposal minting 10B  | `2026__2026-06-09_TOPToken_GovernanceMintTakeover_ETH.json` |
