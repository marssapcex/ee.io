# IPOR Protocol — one leveraged swap inflates the ipToken price and drains other LPs

**Target:** `github.com/IPOR-Labs/ipor-protocol` @ `434327d` (2025-11-14)
**Severity:** Critical — permissionless theft of LP funds, no owner/role/keeper involved.
**Status:** proven end-to-end on the real contracts (compiled from the repo, deployed and wired like `test/utils/factory/IporProtocolFactory.sol`). Logs below are raw program output.

---

## 1. The bug in one paragraph

`IporProtocolRouter` enforces two different limits on what a swap can be worth:

* **Settlement** is bounded by the trader's collateral — `SwapLogicBaseV1.normalizePnlValue` clamps the PnL of a swap to `±collateral` (`contracts/base/amm/libraries/SwapLogicBaseV1.sol:228`). Whatever the position is worth in theory, the pool can never collect more than the collateral.
* **Accounting** is *not* bounded — `SoapIndicatorLogic.calculateSoapReceiveFixed` (`contracts/amm/libraries/SoapIndicatorLogic.sol:34`) marks the leg on the **notional**, and via `AmmLib.getExchangeRate` (`contracts/libraries/AmmLib.sol:33`) that mark is divided by the ipToken supply and becomes the price at which **any LP can redeem real USDC**.

Leverage lets one user set `notional = 1000 × collateral` (`SwapLogicBaseV1.calculateSwapAmount:29`), and the demand-spread curve is capped at 30% (`DemandSpreadLibs.calculateSpreadFunction:152`), so a single oversized receive-fixed swap is filled at `index − 30%` instead of `index`. The pool books the whole `notional × (index − fixed)` gap as profit, an amount that can far exceed the collateral that is the only thing backing it. The first LP to redeem is paid the inflated price out of the other LPs' cash.

---

## 2. The exact maths

Opening a receive-fixed leg updates the SOAP bucket (`AmmStorage._updateSoapIndicatorsWhenOpenSwapReceiveFixed:664`) with `totalNotional += notional`, `totalIbtQuantity += notional / ibtPrice`, `averageInterestRate = fixedRate`. From then on (`SoapIndicatorLogic.sol:34`):

```
soapReceiveFixed(t) = (totalNotional + hypotheticalInterest(t)) − totalIbtQuantity × ibtPrice(t)
                    = notional × ( e^(fixedRate·t) − e^(index·t) )        -- 18 dec, may be negative
```

and (`AmmLib.sol:33`):

```
balance      = liquidityPool − soapTotal          -- AmmLib.sol:39
exchangeRate = balance × 1e18 / ipToken.totalSupply
```

`soapReceiveFixed` is negative when the floating index is above the fixed rate — i.e. the AMM books a **profit for the pool** — and `liquidityPool − soap` then *adds* that profit to the pool's equity even though nothing was received.

Settlement uses the other rule (`SwapLogicBaseV1.calculatePnlReceiveFixed:123`):

```
pnl  = normalizePnlValue(collateral, interestFixed − interestFloating)   -- clamped to [−collateral, +collateral]
```

So with a 74 000 USDC collateral and a 74 000 000 USDC notional the pool can be marked **+744 583** and can collect **74 000**. The delta is unbacked, and it is exactly what the redeeming LP withdraws.

The AMM itself hands out the negative fixed rate: `calculateReceiveFixedOfferedRate` (`OfferedRateCalculationLibs.sol:44`) subtracts the demand spread, and `calculateSpreadFunction` saturates at 30% once the weighted notional exceeds `lpDepth × demandSpreadFactor`. A 74 M notional against ~1 M of liquidity is ~280× over the cap, so the swap is priced at `index − 30%`, floored at 0 — the attacker never needs to predict the market, he only needs the swap to be losing for himself, which the pricing guarantees.

---

## 3. PoC — real contracts, real log

`lab/` compiles the repo's own sources with solc 0.8.26 (`compile.js`), deploys the whole USDC stack on an in-process EVM exactly in the order of `test/utils/factory/IporProtocolFactory.sol` (`poc.js`: IpToken, IporOracle proxy, Spread28/60/90 + SpreadRouter, AmmStorage proxy, AmmTreasury proxy, AmmOpenSwapService, AmmCloseSwapServiceUsdc, AmmPoolsService, AmmGovernanceServiceBaseV1, IporProtocolRouterEthereum proxy + `upgradeTo`), then runs the attack through the router only.

```
cd lab
node compile.js contracts/tokens/IpToken.sol contracts/oracles/IporOracle.sol \
  contracts/amm/spread/Spread{28,60,90}Days.sol contracts/amm/spread/SpreadStorageLens.sol \
  contracts/amm/spread/SpreadStorageService.sol contracts/amm/spread/SpreadCloseSwapService.sol \
  contracts/amm/spread/SpreadRouter.sol contracts/amm/{AmmStorage,AmmTreasury,AmmPoolsService}.sol \
  contracts/amm/AmmOpenSwapService.sol contracts/amm/AmmCloseSwapServiceUsdc.sol \
  contracts/base/amm/services/AmmGovernanceServiceBaseV1.sol \
  contracts/chains/ethereum/router/IporProtocolRouterEthereum.sol \
  node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol mocks/Mocks.sol
node poc-final.js      # the attack
node sweep.js          # parameter sweep
```

Every call in the PoC is a public router entry point: `provideLiquidityUsdc`, `openSwapReceiveFixed90daysUsdc`, `redeemFromAmmPoolUsdc`.

### 3.1 Configuration used (all from the repo, not invented)

| parameter | value | source |
|---|---|---|
| pool | 1 000 000 USDC (500 k honest LP + 500 k attacker) | — |
| IPOR index | 5.00% APR | published by the oracle (`IporOracle.updateIndexes`, `onlyUpdater`) |
| tenor | 90 days | — |
| leverage | 1000× | `maxLeveragePerLeg = 1000e18` in the repo's own risk profile, `test/TestCommons.sol:93` |
| `demandSpreadFactor` | 280 | same |
| `openingFeeRate` | 0.05% | `IporProtocolFactory` CASE3 (`5e14`) |
| `maxSwapCollateralAmount` | 100 000e18 | `IporProtocolFactory` DEFAULT |
| `liquidationDepositAmount` / `iporPublicationFee` | 25 USDC / 10 USDC | `IporProtocolFactory` DEFAULT |
| `redeemFeeRate` / `redeemLpMaxCollateralRatio` | 0 / `1e18` | `IporProtocolFactory` `AmmPoolsServiceTestCase.CASE1` (the default branch charges 0.5%, which would shave ~4.4 k USDC off the attacker's payout and change nothing else) |

### 3.2 Output (verbatim, `lab/poc-final.log`)

```
=== 1. honest state: two LPs, 500k each, ipUSDC at 1.000000 ===
ipUSDC supply=999,999.00 liquidityPool=1,000,000.00 exchangeRate=1.000000
=== 2. the IPOR index is published (5% APR) by the oracle service ===
index=5.00% APR
=== 3. attacker opens ONE 90d receive-fixed swap at maximum leverage ===
gas used=485977  collateral=74,000,000,001,573,170.00 notional=74,000,000,001,573,160,000.00
fixed rate offered by the AMM = 0.949%  (index 5.000% -> the demand spread floors it)
the trader paid 83,158.29 USDC in total (collateral + opening fee + deposit + pub fee)
=== 4. 90 days pass; the index accrues and SOAP marks the pool a profit on the notional ===
liquidityPool (storage) = 1,009,122.29  <- unchanged, the profit exists only in SOAP
SOAP (receive-fixed leg) = -744,583.96  ->  it is booked as a 744,583.96 USDC profit for the pool
marked exchange rate = 1.753708  (1 ipUSDC = 1.75 USDC)
but the trader's loss is capped at his collateral: 74,000.00 USDC (SwapLogicBaseV1.normalizePnlValue)
=== 5. attacker redeems ALL of his ipTokens at the marked price ===
burned 499,998.00 ipUSDC (500,000 minus the two 1-ipUSDC rate probes) -> received 876,850.64 USDC
redemption price = 1.753708 (deposits were made at 1.000000)
=== 6. the honest LP is left behind ===
honest LP redeemed 5% of his ipTokens -> 43,842.71 USDC
a full redemption reverts with execution reverted: "IPOR_409"
=== 7. profit and loss ===
attacker : -500,000.00 (liquidity) -83,158.29 (swap) +876,850.64 (redemption)
attacker : NET +293,692.35 USDC
honest LP: -500,000.00 +43,842.71 -> NET -456,157.29 USDC (87,673.74 of the pool cash is still stuck behind the redeem guards)
pool cash left: 131,516.45 USDC (74,000.00 of it is the abandoned collateral the pool can still collect)
```

The collateral is real, not a rounding artefact — closing the same position at maturity (same harness, `lab/closecheck.js`) gives the pool **exactly the collateral** and returns the trader only his 25 USDC liquidation deposit:

```
opened: notional 74000000001573170753366000 coll 740000000001573170753366 fixed 9491916536489955 tenor 2
CLOSE OK gas 213953 buyer_received 25 liquidityPool before 1009123.2876714268 after 1083123.287673
```

i.e. `+74 000` realised versus `744 584` marked. **670 584 USDC of the pool's "equity" can never exist.**

### 3.3 Parameter sweep (`lab/sweep.log`)

`LP_LOSS` = the honest LP's principal minus the cash left in the treasury after the attacker exited (the attacker owns nothing any more, so the whole remaining treasury is the honest LP's).

```
days=28 C=74000 lev=1000x notional=74,000,000 fixed=0.936% atk_spend=576,873 atk_out=617,023 ATK_NET=+40,150  LP_LOSS=109,127 cash_left=390,873
days=60 C=74000 lev=1000x notional=74,000,000 fixed=0.943% atk_spend=580,117 atk_out=751,005 ATK_NET=+170,887 LP_LOSS=220,254 cash_left=279,746
days=90 C=74000 lev=1000x notional=74,000,000 fixed=0.949% atk_spend=583,158 atk_out=876,854 ATK_NET=+293,695 LP_LOSS=324,641 cash_left=175,359
days=90 C=20000 lev=1000x notional=20,000,000 fixed=1.818% atk_spend=522,501 atk_out=580,350 ATK_NET=+57,850  LP_LOSS=124,172 cash_left=375,828
days=90 C=99000 lev=1000x notional=99,000,000 fixed=0.252% atk_spend=611,240 atk_out=0       ATK_NET=-611,240 LP_LOSS=...      cash_left=961,240   <- payout > treasury cash, the attacker's own redeem reverts
days=90 C=74000 lev=100x  notional= 7,400,000 fixed=1.929% atk_spend=574,947 atk_out=528,717 ATK_NET=-46,230  LP_LOSS=35,704  cash_left=464,296
days=90 C=74000 lev=200x  notional=14,800,000 fixed=1.858% atk_spend=575,860 atk_out=558,738 ATK_NET=-17,121  LP_LOSS=60,447  cash_left=439,553
days=90 C=74000 lev=1000x notional=74,000,000 fixed=1.347% atk_spend=333,158 atk_out=386,196 ATK_NET=+53,037  LP_LOSS=195,082 cash_left=804,918  (honest LP 1M, attacker only 250k)
```

Reading of the table:

* profit grows with `notional × (index − fixed) × time`, i.e. with leverage and tenor; break-even leverage is ≈ 250× at these rates (`100×`, `200×` lose money);
* the attacker does **not** need to be the majority LP — with 250 k against a 1 M honest LP he still takes **+53 037**;
* the size of the theft is capped by the cash in `AmmTreasury`; oversizing makes the attacker's own redeem revert on `IPOR_409` (`AmmPoolsService.sol:298`), so he sizes it to the treasury balance (or redeems in chunks).

---

## 4. Why the existing guards do not stop it

| guard | why it passes |
|---|---|
| `_validateLiquidityPoolCollateralRatioAndSwapLeverage` | enforces `collateral / liquidityPool ≤ maxCollateralRatio` (and `leverage ≤ maxLeveragePerLeg`). Collateral is 74 k against a 1.009 M pool → **7.3%**, far below the 90% limit. The check is *collateral*-based while the damage is *notional*-based. |
| `redeemLpMaxCollateralRatio` (`AmmPoolsService.sol:313`) | it blocks a redeem only if the *remaining* pool is under-collateralised. After the attacker's redeem the pool holds 131 k cash against 74 k collateral, so the ratio passes. It is this same guard that makes the honest LP's full redeem revert (`IPOR_409` = `INSUFFICIENT_ERC20_BALANCE`) — the money is simply gone. |
| `minLeverage` / `maxLeveragePerLeg` | the attack sits exactly at the maximum the protocol allows (1000×). |
| demand spread | it prices the oversized notional (that is where the 4% gap comes from) but it does not bound the notional. |
| `normalizePnlValue` | caps the *settlement*, not the *mark*. This is the bug. |
| reentrancy / pause | irrelevant, everything is a straightforward sequence of public calls. |

**Privileges required: none.** `provideLiquidityUsdc`, `openSwapReceiveFixed90daysUsdc` and `redeemFromAmmPoolUsdc` are the protocol's ordinary user entry points. The only signature in the flow is the risk-indicator attestation, which is *not caller-bound* (digest = the six risk fields + `expiration` + asset + tenor + direction, `AmmTypes.RiskIndicatorsInputs.verify`) — it can be taken from any other user's pending/past open transaction for the same asset/tenor/direction until it expires, or obtained from IPOR's own quote API. The oracle index and the treasury's cash are pre-existing protocol state; no admin, no keeper, no config change.

---

## 5. Impact

An LP can mint ipUSDC, open one self-harming but pool-profitable leveraged swap, wait, and redeem at a price that is backed by nothing. The cash leaves `AmmTreasury` permanently:

* attacker: **+293 692 USDC** for a 583 158 USDC budget in 90 days (50% ROI);
* honest LP: **−324 641 USDC** of cash (500 000 in, 175 359 of pool cash left for him), of which only 43 842 could be redeemed on the spot;
* the protocol keeps a 74 000 USDC receivable and a 744 584 USDC paper gain that can never be realised.

The loss is not a temporary mark-to-market: `liquidityPool` is unchanged after the attack, the attacker's USDC is in his wallet, and the remaining ipUSDC supply is worth less than the cash behind it. Any LP can trigger it; the largest LP (or the first to redeem after a whale swap) is the natural victim.

---

## 6. Fix

The mark used for pricing redemptions must never exceed what the pool can actually collect. In order of preference:

1. **Clamp the SOAP at the leg level to the collectable amount.** When computing `soapReceiveFixed` / `soapPayFixed` in `SoapIndicatorLogic`, cap the aggregate to the sum over open swaps of `normalizePnlValue(swap.collateral, pnl_i)` — i.e. use the same `±collateral` clamp as settlement. Concretely, track `totalCollateralPayFixed/ReceiveFixed` (already in `AmmStorage.getBalancesForOpenSwap`) and bound `|soap| ≤ totalCollateral + collectedFees`.
2. **Or price redemptions on realised value only**: in `AmmLib.getExchangeRate`, subtract `min(soapProfit, totalCollateralPayFixed + totalCollateralReceiveFixed)` from the balance instead of the raw SOAP.
3. **Bound the notional, not just the collateral.** `calculateSwapAmount` allows `notional = leverage × collateral` with leverage up to `maxLeveragePerLeg`; the pool's own risk check only looks at collateral. Either cap `notional ≤ k × lpDepth` at open, or make `maxLeveragePerLeg` a function of `lpDepth / collateral`.
4. As a stop-gap, make redemptions pay the realised rate and queue the unrealised part until the underlying swaps close (the protocol already has a close/liquidation path that produces realised PnL).

Any one of (1)/(2) kills this attack; (3) removes the class of it.

---

## 7. Tried and failed (do not repeat)

| attempt | result |
|---|---|
| pay-fixed variant of the same trick (open a swap that marks the pool *down*, mint ipUSDC at the depressed price) | the mark only reverses if the index actually falls, which the attacker cannot force; without that second leg the "cheap" ipUSDC is worth nothing extra. Not proven, not claimed. |
| redeem first, then open the swap | the swap only marks after opening; redeeming before it does nothing. |
| drain via `closeSwaps` on a swap opened by someone else | closing pays the *buyer*, the attacker cannot redirect it. |
| `AmmTreasury.depositToAssetManagementInternal` as an entry point | `onlyRouter whenNotPaused`; the router does not expose it as a user call. |
| `AmmGovernanceServiceBaseV1` setters (no in-body ACL) | reachable only through `IporProtocolRouter`'s owner path → privileged, out of scope per the rules. |
| `SpreadStorageService.updateTimeWeightedNotional` (no modifier on the implementation) | `SpreadRouter.sol:120-122` routes that selector through `_onlyOwner()` — privileged, not usable. |
| oracle staleness / `accrueQuasiIbtPrice` | the accrual is bounded by `block.timestamp` and `updateTimestamp < block.timestamp`; no free index move found. |

---

## 8. Repo layout of this deliverable

```
audit/ipor/
├── REPORT.md              <- this file
├── repo/                  <- clone of IPOR-Labs/ipor-protocol @ 434327d
└── lab/
    ├── compile.js         <- solc 0.8.26 build of the repo's sources (import resolution, library linking)
    ├── mocks/Mocks.sol    <- MockERC20 / 1:1 MockVault (ERC4626) / placeholder contract
    ├── poc.js             <- full protocol deployment + wiring (same order as IporProtocolFactory)
    ├── poc-final.js       <- the attack, narrated
    ├── poc-final.log      <- raw output of the run above
    ├── closecheck.js      <- proves the settlement is capped at the collateral (74 000 vs 744 584)
    ├── sweep.js           <- parameter sweep (tenor / collateral / leverage / pool split)
    ├── sweep.log
    └── artifacts.json     <- generated by compile.js (not committed)
```
