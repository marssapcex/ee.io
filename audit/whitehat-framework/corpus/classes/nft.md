# nft

8 incidents.

## Worst first

| date | protocol | chain | loss | root cause | file |
|---|---|---|---|---|---|
| 2022-04-22 | Akutar NFT | Ethereum Mainnet | $34,000,000 | 1) When the bidder is a contract, a fallback revert during ETH refund can DoS the entire refund process; 2) A logic error in `claimProjectFunds()` require condi | `2022__2022-04-22_AkutarNFT_RefundDoSFundsLocked.json` |
| 2024-09-26 | OnyxDAO | Ethereum | $3,800,000 | Compound v2 precision loss (oETH exchange rate inflation via tiny mint/redeem cycles) combined with fake Market injection via unvalidated user input into NFTLiq | `2024__2024-09-26_OnyxDAO_UnverifiedInput_ETH.json` |
| 2023-12-17 | Floor Protocol | Ethereum | $1,600,000 | The `extMulticall` function of ERC1967Proxy allows execution of arbitrary calldata against arbitrary contracts without any caller validation | `2023__2023-12-17_FloorProtocol_BusinessLogic_ETH.json` |
| 2024-05-01 | TSURU | Base | $140,000 | The `onERC1155Received()` callback does not validate the caller, allowing the attacker to invoke the callback directly without an actual ERC1155 transfer to min | `2024__2024-05-XX_TSURU_OnERC1155ReceivedUnauthorized.json` |
| 2025-01-22 | Paribus | Arbitrum | $86,000 | Collateral valuation logic overestimates the actual value of concentrated liquidity NFTs with extreme tick ranges (-870000~870000), allowing over-borrowing | `2025__2025-01-22_Paribus_NFTCollateralOvervaluation.json` |
| 2022-03-03 | TreasureDAO Marketplace | Arbitrum | Multiple NFTs stolen for free (including SmolBrain NFTs) | `buyItem()` function does not validate the payment amount when called with quantity=0, allowing NFTs listed at normal prices to be purchased for 0 MAGIC | `2022__2022-03-03_TreasureDAO_MarketplaceBuyItemFree.json` |
| 2023-12-17 | PineProtocol | None | ? |  | `2023__2023-12-17_PineProtocol_NFTLoanExploit.json` |
| 2024-02-01 | EGGX | Ethereum | ~2 ETH | `EGGXClaim.check()` does not properly validate NFT ownership or prior claim status, enabling repeated claims against 36 NFT IDs using a temporary balance | `2024__2024-02-XX_EGGX_NFTClaimMisvalidation.json` |
