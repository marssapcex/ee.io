# weak-randomness

6 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2025-01-14 | RoulettePotV2 | BSC | $28,000 | External call access on `finishRound()` and `swapProfitFees()` allowed manipulation of round end timing and theft of accumulated fees | `2025__2025-01-14_RoulettePotV2_RoundFinishManipulation.json` |
| 2025-01-13 | JPulsepot | BSC | $21,500 | `swapProfitFees()` is publicly callable, allowing price manipulation at swap time to misappropriate protocol revenue | `2025__2025-01-13_JPulsepot_ProfitFeeSwapManipulation.json` |
| 2024-05-01 | Red Keys Game | BSC | $12,000 | The `playGame(uint16 choice, uint16 ratio, uint256 amount)` function uses predictable on-chain values — `block.timestamp`, block data, and the game `counter` —  | `2024__2024-05-XX_RedKeysCoin_PredictableRNG.json` |
| 2022-08-24 | LuckyTiger NFT | Ethereum Mainnet | NFT fraudulently obtained | `publicMint()` condition check uses `block.difficulty` and `block.timestamp` as randomness — both are predictable/manipulable | `2022__2022-08-24_LuckyTiger_WeakRandomness.json` |
| 2025-05-08 | Nalakuvara / LotteryTicket50 | Base | 105,470 USDC | Missing exchange rate validation in LotteryTicketSwap50's transferToken/DestructionOfLotteryTickets functions, allowing an attacker to force an unfavorable exch | `2025__2025-05-08_Nalakuvara_LotteryTicketDrain.json` |
| 2026-02-26 | FOOM Lottery | Ethereum Mainnet + Base | ? | Groth16 zkSNARK proof forgery — Phase 2 trusted setup was skipped, leaving `gamma2 == delta2` (the default G2 generator); this algebraic degeneracy lets an atta | `2026__2026-02-26_FoomLottery_GrothForgedProof_ETH_Base.json` |
