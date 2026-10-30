# Reproducer

Requires Node 20+ and the IPOR repo cloned at `../repo` (`git clone https://github.com/IPOR-Labs/ipor-protocol ../repo`)
plus its own deps for `@openzeppelin` (`cd ../repo && npm i`).

```
npm i                 # solc 0.8.26, ethers 6, ganache
npm run build         # compile the repo sources -> artifacts.json
npm run poc           # the attack (lab/poc-final.log)
npm run close         # settlement is capped at the collateral
npm run sweep         # parameter sweep (lab/sweep.log)
```

All three scripts deploy the full USDC stack (IpToken, IporOracle proxy, Spread28/60/90 + SpreadRouter,
AmmStorage/AmmTreasury proxies, AmmOpenSwapService, AmmCloseSwapServiceUsdc, AmmPoolsService,
AmmGovernanceServiceBaseV1, IporProtocolRouterEthereum proxy + upgradeTo) on an in-process EVM and call
the protocol only through the router, exactly the way `test/utils/factory/IporProtocolFactory.sol` wires it.
