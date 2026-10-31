# IPOR fork PoC — how to run it, what it needs, what changed in v3.2

File: `fork/IporFork.t.sol` (v3). Compile-clean against the real `forge-std` (solc 0.8.26, cancun, 0 errors / 0 warnings).
**Not executed anywhere yet** — the sandbox has no RPC and no `forge`. Your `-vv` output is the evidence.

---

## 0. What v2 got wrong (and v3 fixes)

| # | v2 behaviour | cause | v3 |
|---|---|---|---|
| 1 | `test_1_attack` died: `IPOR_012` on `provideLiquidityUsdc` | **wrong function name for Arbitrum.** `IPOR_012` = `ROUTER_INVALID_SIGNATURE` (`contracts/libraries/errors/IporErrors.sol:79`) is the router's *dispatch miss*, not a risk-signature failure. Arbitrum/Base USDC pools are the `AmmPoolsServiceUsdcBaseV1` flavour: the entry point is `provideLiquidityUsdcToAmmPoolUsdc(address,uint256)` (`contracts/chains/arbitrum/interfaces/IAmmPoolsServiceUsdc.sol:6`). Only the **Ethereum** stable pools use `provideLiquidityUsdc`. | per-pool selector table + direct-service fallback |
| 2 | `_depth()` returned 229,309.96 for a pool holding 995.79 USDC idle | it used `AmmStorage.liquidityPool`, which is *LP equity*, not cash | `AmmTreasury.getLiquidityPoolBalance()` — the exact number the swap engine uses (`AmmOpenSwapServiceBaseV1.sol:142`) |
| 3 | asset manager always 0 | `AmmTreasuryBaseV2` has **no** `getConfiguration()` (that is the legacy `AmmTreasury`); the call reverted and was swallowed | `ammAssetManagement()` + `IERC4626.maxWithdraw(treasury)` |
| 4 | knobs unusable | `vm.envUint` reverts when unset | every knob optional (`_envOr`) |
| 5 | `openSwapReceiveFixed90daysUsdc` also reverted `IPOR_012` (v3, run of 2026-10-31) | **same class of mistake, second place: the arity.** Arbitrum/Base USDC swaps take `(beneficiary, inputAsset, amount, acceptableRate, leverage, riskIndicators)` — 6 params (`contracts/chains/arbitrum/interfaces/IAmmOpenSwapServiceUsdc.sol:101`); Ethereum's legacy stable pools take 5, without `inputAsset` (`contracts/interfaces/IAmmOpenSwapService.sol:212`). Different `inputAsset` position → different selector → dispatch miss. | `_openCalldata()` builds both flavours, the attack tries both per size, `test_2_probe` prints which selectors this router actually dispatches |

### Why #1 matters for the report

The signature gate is on `_getRouterImplementation`, i.e. **any** unrecognised selector reverts `IPOR_012`. The risk-indicator
signature is a *different* gate inside the swap service (`RiskIndicatorsValidatorLib.verify` → `IPOR_311`). v2 conflated the
two and my earlier note that "the LP path is signature-gated" was wrong: `provideLiquidity*` is **unsigned**.

---

## 1. 1b corrected: the pools are bigger than the "995 USDC" figure in the v2 notes

`AmmTreasuryBaseV2.getLiquidityPoolBalance()`
(`contracts/base/amm/AmmTreasuryBaseV2.sol:85`) is:

```
LP = cash + vault.maxWithdraw(treasury) − collateralPayFixed − collateralReceiveFixed
       − iporPublicationFee − treasuryFee − liquidationDeposits
```

so idle cash alone understates the pool. Measured on the fork (v2 run, Arbitrum ~519 889 400):

| pool | treasury idle | asset manager | LP balance (= depth) | `AmmStorage.liquidityPool` | ipToken supply | rate |
|---|---|---|---|---|---|---|
| USDC `0xaf88…e5831` | 995.79 USDC | Fusion vault `0xD855…9228` | **229 310 (236 k USD)** | 229 309.96 | 200 664.11 | 1.1427552 |
| wstETH `0x5979…0529` | 8.93448 wstETH | none (V1, no AM leg) | **6.50203 wstETH (≈25 k USD)** | 6.50203 | 6.14865 | 1.0574739 |

Two consequences the earlier notes got wrong:

* **USDC is the real target, not the wstETH dust pool.** `AmmPoolsServiceBaseV1._redeem` calls
  `_rebalanceIfNeededBeforeRedeem` (`AmmPoolsServiceBaseV1.sol:220`), which pulls the shortfall out of the Fusion vault, so a
  redemption can reach the **whole 229.31k** LP balance (idle is only the working float).
* **wstETH redemption is capped by idle cash.** `AmmPoolsServiceWstEthBaseV1` is the V1 flavour with `assetManagement:
  address(0)` (`contracts/base/amm-wstEth/services/AmmPoolsServiceWstEthBaseV1.sol:112`) and pays out with a plain
  `safeTransferFrom(ammTreasury, …)` at line 100 — no AM withdrawal. Ceiling = 8.93 wstETH, of which only 6.50 is LP equity
  (the rest is other traders' collateral sitting in the treasury — also stealable).

---

## 2. The addresses in the original brief were wrong (3 of 6)

Checked against `IPOR-Labs/ipor-abi` → `mainnet/mainnet-arbitrum/addresses.json`:

| contract | in the brief | official (Arbitrum) | verdict |
|---|---|---|---|
| AmmPoolsServiceWstEth | `0x8cD6db83…719A7f` | `0x2e53879feb7F9BC8E97d1bcc848356F781402b6c` | **wrong** |
| AmmOpenSwapServiceWstEth | `0x221A9A6A…98d856` | `0x7138B130F255fa4B65dFE6DEA9ade89dBF1E6461` | **wrong** |
| AmmCloseSwapServiceWstEth | `0x32365802…3f5eC` | `0x4a76fBe02C6e816B33584CEc2a63b1A420016938` | **wrong** |
| AmmTreasuryWstEthProxy | `0xBd013Ea2…882A5D` | same | correct |
| AmmStorageWstEthProxy | `0x32680433…1c5C28` | same | correct |
| IporProtocolRouterProxy | `0x760Fa0aB…F118db` | same | correct |

`0x8cD6db83…719A7f` is a real `AmmPoolsServiceWstEth` from the *old* book (`mainnet-arbitrum-harvest`, `testnet/pilot-*`);
`0x221A9A6A…d856` is the 2023 v1 deployment (0.8.20/paris); `0x32365802…3f5eC` appears in no address book. The PoC uses the
official entries and reaches every pool function **through the router** first, falling back to the service address if the
router path fails:

```
ROUTER      0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db
USDC        0xaf88d065e77c8cC2239327C5EDb3A432268e5831   ipUSDC 0x485cAC13E6492CcF4d47764b0E4e07b5272B0167
            treasury 0x9324d39B29c85440cadd2202E4703E6f5d1e98F9
            pools service 0xc08610f885C606e622C910D902356257998D6217
            openSwap service 0x5D9094baDc927b82a78BA095A5BC394F166aA27b
WSTETH      0x5979D7b546E38E414F7E9822514be443A4800529   ipwstETH 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C
            treasury 0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D
            pools service 0x2e53879feb7F9BC8E97d1bcc848356F781402b6c
            openSwap service 0x7138B130F255fa4B65dFE6DEA9ade89dBF1E6461
```

(Base equivalents are wired too: pools `0x786AFBbb…02d0` / `0x0eb64F28…0887`, openSwap `0xdF884ccE…b54d` / `0xFbE094Bc…9472`.)

---

## 2b. What the first real run already proved (fork, blocks 26,310,468 / 519,891,316)

Read off `test_0_recon` / the `-vvvv` trace of the failed `test_1_attack`:

* `provideLiquidityUsdcToAmmPoolUsdc` **works** through the router: 22,930.99387 USDC in → 20,066.41076 ipUSDC minted, and the service immediately rebalanced 22,653.40 USDC into the Fusion vault (`depositToAssetManagementInternal`) — i.e. the pool really is ~99 % vault-backed, which is why idle cash alone looked like dust.
* `getLiquidityPoolBalance()` = 229,309.9387 while `cash + maxWithdraw` = 231,745.8132: the treasury deducts 2,435.87 of accrued fee/collateral buckets. `AmmStorage.getBalance()` returns `(0, 0, 384, 2051.87)` — its field order is **not** the one the v2 header assumed, so never use it for depth.
* `getSoapIndicators()` for both pools is empty (no open swaps at that block) and the exchange rate equals `LP/supply` to 18 digits: 1.1427551316 (USDC), 1.0574739078 (wstETH). The mark starts clean, so any inflation measured after the warp is the attack's.
* **The fuel is there.** `calculateAccruedIbtPrice(USDC, ·)` moved 1.1354928574 → 1.1354928906 in the 16 s between two runs ⇒ the published USDC index accrues at **≈ 6.53 % APY**. Over 90 days that is ≈ +1.6 % of notional, which is what the unclamped SOAP turns into a negative (LP-owes) mark, while the trader's own payout stays clamped at collateral.
* `setMessageSigner` still succeeds from the owner; `deal()` on USDC works (slot `0xb6d6d8b5…`, forge finds it by itself).

## 2c. v3.2 — the blocker is a PAUSE, not a selector

The v3.1 run proved the 6-arg arity is correct (`0x3696578d`, the selector derives from
`IAmmOpenSwapServiceUsdc.openSwapReceiveFixed90daysUsdc`), and that the router **dispatches it and then reverts
`IPOR_015`**. `IPOR_015` is not "bad call data", it is `METHOD_PAUSED`
(`contracts/libraries/errors/IporErrors.sol:88`), raised by `AccessControl._checkFunctionSigAndIsNotPause`
(`contracts/router/AccessControl.sol:122`) when `RouterFunctionPaused[selector] != 0`. The map is written by
`pause(bytes4[])` (pause guardian) and cleared only by the owner via `unpause(bytes4[])` (`AccessControl.sol:81/93`).

So v3.2 stops guessing:

* `test_3_pause` reads `IporProtocolRouter.paused(selector)` for **all 18 open entry points** (pay/receive × 28/60/90 ×
  USDC/wstETH/USDT/DAI, both arities), plus the liquidity/close ones, and then attempts the obvious bypass — calling
  `AmmOpenSwapServiceUsdc` directly. That cannot work: the router runs services with `functionDelegateCall`
  (`IporProtocolRouterAbstract.sol:20,60`), so the message-signer slot the service reads is the router's; in the service's
  own storage it is 0 and every signature is rejected. The test prints the actual revert instead of asserting it.
* `test_4_all_chains` does the same for Arbitrum + Ethereum + Base in one run (skips a chain whose RPC is unset), and prints
  each pool's depth in USD. That is the answer to "is this live anywhere".
* `test_1_attack` now treats direction as well as tenor as a search: `receiveFixed` first, then `payFixed`, tenors
  90 → 60 → 28, 6-arg then 5-arg arity, skipping anything the router reports as paused. Both sides are profitable for the
  attacker, because the AMM prices the oversized swap *against* the trader in either direction
  (`calculateReceiveFixedOfferedRate` subtracts the demand spread, `calculatePayFixedOfferedRate` adds it, both saturating
  at 30 %). If nothing opens, it says so instead of printing a fake number.
* accounting fixed: the attacker is funded with exactly `ATK_LP + TOTAL + 5 % + 1 % of depth`, so
  `net = balanceOf − float` is a real profit and not an artefact of an over-generous `deal()` (v3.1 dealt `2 × depth`,
  which would have shown a phantom loss of one whole pool).
* a second, honest LP (`HONEST`, default depth/4) deposits before the attack and exits after it, so the victim's loss is a
  measured number rather than an inference from the attacker's balance.

## 3. Run it

```bash
cd ~/arc_hedgefun
cp /path/to/ee.io/audit/ipor/fork/IporFork.t.sol test/

export ARB_RPC=https://arb1.arbitrum.io/rpc   # or your Alchemy/Infura URL
export ETH_RPC=...                            # optional, for the all-chain probe
export BASE_RPC=...                           # optional, for the all-chain probe

forge test --match-contract IporFork -vv
```

Four tests, in the order you want to read them:

| test | what it answers | gas / risk |
|---|---|---|
| `test_2_probe` | does this router dispatch each selector, and is it paused | read-only |
| `test_3_pause` | full pause map of the 18 open entry points + the direct-service bypass experiment | read-only (one `deal` for the bypass attempt) |
| `test_4_all_chains` | depth in USD and pause state for Arbitrum / Ethereum / Base in one run | read-only |
| `test_0_recon` | per-pool depth, idle cash, vault, ipToken supply, exchange rate | read-only |
| `test_1_attack` | the attack itself on the pool you choose | one owner-gated cheat, see §4 |

```
FORK_BLOCK=519889666 ARB_RPC=... forge test --match-contract IporFork -vv     # reproducible numbers
```

Attack defaults: attacker takes **half the book as LP**, **half the book as swap total**, 1000× leverage, 90 days held.
`TARGET=wstETH` switches pool (default: the biggest by USD). Everything else is optional:
`ATK_LP`, `HONEST`, `TOTAL`, `LEV`, `TENOR` (28/60/90), `DAYS`, `CHUNKS`, `FORK_BLOCK`, plus `CHAIN=arb|eth|base` /
`RPC_URL` to run the whole file on another chain.

If a cap bites, the test does not die: it halves the swap size and retries (6 tries), walks tenors and directions, prints the
decoded revert (`IPOR_3xx` / `LP_COLLATERAL_RATIO_*` / `LEVERAGE_TOO_HIGH` …), and the redeem loop halves the chunk whenever
the treasury cannot pay.

## 4. What is real, what is cheated

Real: fork state, treasury/vault accounting, `getLiquidityPoolBalance()`, the swap, `vm.warp` accrual of the IPOR index
(`IporLogic.accrueQuasiIbtPrice`, uncapped linear accrual), SOAP, the exchange rate, the redemption, every guard.

Cheated, exactly one thing: `openSwapReceiveFixed90days*` needs risk indicators signed by IPOR's off-chain key
(`RiskIndicatorsValidatorLib.verify`). A fork cannot forge it, so the test does `vm.prank(router.owner());
setMessageSigner(keyWeHold)` — the only owner-gated step in the whole PoC, and it is **test scaffolding, not part of the
attack**: in production any user fetches that signed payload from IPOR's public risk API (it only says "these are the current
limits"), so it is not a privilege. What the payload *says* (`maxLeveragePerLeg = 1000e18`) is the repo's own test default
(`test/TestCommons.sol:100`); the production value travels inside the signature and is not readable from chain state, so the
fork run measures the mechanism at 1000×, and §10.2 of the report states what happens at 100×/250×.

## 5. What to send back

Full `-vv` output of `test_3_pause` + `test_4_all_chains` + `test_1_attack`. The numbers that decide the finding:

1. the pause map (which of the 18 open selectors are `PAUSED`) on each chain — this decides whether the bug is live,
   dormant, or dead;
2. `LP balance`, `treasury idle`, `asset manager` per pool (recon) — the reachable ceiling;
3. `rate0` → `rate after swap` → `rate1` and `fair rate` — how much of the mark is phantom (`phantom inflation x1000`);
4. `NET PROFIT` / `NET LOSS` in wad and USD, next to `spent` — the attacker's real balance delta;
5. the honest LP block: claim vs actually received — the victim's loss;
6. `treasury idle after` / `redemption capacity` — how much cash actually left the pool.
