# IPOR fork PoC — how to run it, what it needs, what changed in v3.4

File: `fork/IporFork.t.sol` (v3.4). Compile-clean against the real `forge-std` (solc 0.8.26, cancun, 0 errors / 0 warnings).
**v3.3 was executed on your machine (Arb 26 310 668 / Eth 26 310 671 / Base 53 317 684) and v3.2 before it at 26 310 577 — the log is in `REPORT.md` §9.5 and in the section below.**
The sandbox still has no RPC and no `forge`, so every number below comes from a run you did.

---

## v3.4 — what your v3.3 run proved, and the three defects it exposed

Your run (all three forks: Arb block 26 310 668, Eth 26 310 671, Base 53 317 684) gave 4 PASS / 1 FAIL. Read together with
the repo, it answers the open question and it also shows that two of the "open" cells in the v3.3 table were artefacts.

### 1. `paused(selector) == 0` does not mean the selector exists

The pause map is `StorageLibBaseV1.getRouterFunctionPaused().value[selector]`
(`contracts/base/libraries/StorageLibBaseV1.sol:151`, written by `pause(bytes4[])` in `contracts/router/AccessControl.sol:81`).
A selector that the router never registered has **no entry**, and an absent entry reads `0`. v3.3 reported
"Arbitrum wstETH 5-arg OPEN 6/6" and "Ethereum 18/18 OPEN" from that read alone — both are ghosts:

* Arbitrum wstETH is `AmmOpenSwapServiceWstEthBaseV1`, whose signature **has** `inputAsset`
  (`contracts/interfaces/IAmmOpenSwapServiceWstEth.sol:101` → `0x1253b3ae / 0x70a7394c / 0x240e3328` receive-fixed,
  `0x804e488a / 0xb814f9c0 / 0x01eb1f71` pay-fixed). Those six are **paused**, and the five-arg hashes your log shows being
  called (`0x859c1a6a … 0xed157264`) are the *Ethereum-flavour* hashes — the router does not know them, which is exactly the
  `IPOR_012` (= `METHOD_NOT_IMPLEMENTED`, the dispatch miss) that killed every attempt.
* Ethereum is the mirror image: its stables are the legacy 5-arg service (`contracts/interfaces/IAmmOpenSwapService.sol:212`),
  and the v3.3 run probed the 6-arg set there, so its "18/18 open" measured eighteen selectors that do not exist.

The fix is not another table, it is a call: `_routed(selector)` executes the selector with no arguments and reads the revert
code — `IPOR_015` = routed but paused, `IPOR_012` = not routed, anything else = routed. `test_2_probe` now uses it.

Corollary for the report: **the only place that could still be live is Ethereum (USDC 92 259.6 + USDT 17 006.0 +
DAI 7 813.7 ≈ 117 k USD of LP balance), and that one is still unmeasured.** Arbitrum (your brief's chain) is closed on the
arity that exists, Base is closed.

### 2. `_logReason()` could never print an IPOR code

IPOR reverts with `revert("IPOR_012")`, i.e. `Error(string)`, so `bytes4(ret)` is `0x08c379a0`, not the code — the v3.3
comparison against `keccak256("IPOR_012")` was structurally impossible, and the "revert reasons" in your log were the raw
string bytes. v3.4 decodes `Error(string)` and prints the real code (`_code()`).

### 3. `_attackOn()` reported success as failure, and used the wrong close selector

* `return true` sat inside the `NET LOSS` branch. The profit branch therefore fell off the end of the function with the
  named return value still `false` -> `test_1_attack` printed *"pool skipped: no open swap path"* **after** a successful
  attack and moved on to the next pool.
* the close attempt always used `closeSwapsUsdc`. The asset name is part of the selector, so USDT/DAI (and wstETH) closes
  would have failed with a dispatch miss and been misreported as "the treasury cannot fund settlement". Now `_closeSel(p)`
  builds `closeSwaps<T>(address,uint256[],uint256[],(RiskIndicatorsInputs,RiskIndicatorsInputs))` per pool and the value is
  asserted in `test_2_probe` (`closeSwapsUsdc = 0xa5450264`, `closeSwapsWstEth = 0xb9d281f3`).
* the arity order is now derived from the pool (`_preferInputAsset`): 6-arg first for Arbitrum wstETH / Arbitrum+Base USDC,
  5-arg first for the Ethereum stables — a guaranteed-`IPOR_012` call no longer burns the first slot.

One more correction to §2 of the old notes: the run shows the **router** delegatecalling `0x8cD6db83…719A7f` for
`provideLiquidityWstEth`, so that *is* the live wstETH pools service; the address-book entry `0x2e53879f…` is the stale one.
Treasury `0xBd013Ea2…` and storage `0x32680433…` are confirmed correct by the same trace (8.93448 wstETH received).

### 4. The run command for v3.4 (Ethereum first — it is the only possibly-live surface)

```bash
cd /path/to/audit/ipor/repo          # or wherever you copied the foundry project
export ETH_RPC=https://eth-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M
export ARB_RPC=https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M
export BASE_RPC=https://base-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M

# 1) the decisive table: which selectors does each router actually route
CHAIN=eth forge test --match-contract IporFork --match-test test_2_probe -vv
CHAIN=arb forge test --match-contract IporFork --match-test test_2_probe -vv

# 2) the attack, on the only chain that can still be open
CHAIN=eth TARGET=USDC forge test --match-contract IporFork --match-test test_1_attack -vv

# 3) the same on the brief's chain, for the record
CHAIN=arb TARGET=wstETH forge test --match-contract IporFork --match-test test_1_attack -vv

# 4) all three deployments in one run
forge test --match-contract IporFork --match-test test_4_all_chains -vv
```

`FORK_BLOCK=` pins the block (use `26310668` on Arbitrum / `26310671` on Ethereum to reproduce the same state).


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

## 2c. v3.2 result (real run, block 26 310 577) and what v3.3 changes

The pause map came back **granular**, which is the single most important fact this file now records. Measured with
`test_3_pause` (one `paused(bytes4)` read per selector, both arities, 4 assets, 3 chains):

| deployment | asset | 6-arg opens | 5-arg opens | LP entry | LP exit |
|---|---|---|---|---|---|
| Arbitrum | USDC 229 309.89 USD | **paused** (6/6) | **paused** (6/6) | open, works | open, works |
| Arbitrum | wstETH 6.50203 (~25 033 USD) | **paused** (6/6) | **OPEN** (6/6) | open | open |
| Arbitrum | USDT | flag open | flag open | **dust: `totalSupply` = 1.299963 USDT** | — |
| Arbitrum | DAI | flag open | flag open | **no ipDAI token exists** | — |
| Ethereum | USDC 92 259.6 / USDT 17 006.0 / DAI 7 813.7 | **OPEN** (18/18) | — | open | open |
| Base | USDC 9 631.1 / wstETH 15.418 | **paused** (6/6) | — | open | open |

Open Arbitrum wstETH selectors: `0x859c1a6a` 28 d receive, `0x83e7d402` 60 d, `0xb95ba8f3` 90 d,
`0xdc660afa` / `0xb3f2a286` / `0xed157264` pay-fixed.

Three lessons the v3.2 attack code got wrong, all fixed in v3.3:

1. **`test_1_attack` gave up after the first pool.** `_target()` picks the deepest pool in USD, which on Arbitrum is USDC —
   the one pool where every open selector is paused. So the run printed `no open path` while the wstETH pool 3 lines away
   had six open selectors. v3.3 splits the body into `_attackOn(Pool memory)` and loops over **all** pools, deepest first
   (`TARGET=<tag>` still forces one), skipping a pool only when it genuinely cannot open a swap. This is also what makes a
   single Ethereum run enough: if USDC is closed for any reason it immediately tries USDT, then DAI.
2. **`_depth()` was `getLiquidityPoolBalance()`-only, and the Ethereum treasuries are the legacy `AmmTreasury`.** On those,
   the call reverts, `_depth` fell through to `rate × supply` — which is *the quantity under attack*, so it would have made
   the "fair rate" comparison circular and the profit numbers meaningless. v3.3 computes LP the way `AmmLib.getAccruedBalance`
   does for the legacy stack: `storage.liquidityPool + vaultActual − storage.vault`, with `vaultActual =
   IERC4626(am).maxWithdraw(treasury)`, and it prints which of the three sources it used (`depth source`). If the log says
   `rate*supply (soap-contaminated)`, the depth number in that line is **not** evidence — do not use it.
3. **A `paused == 0` flag is not proof that a function is callable.** The twelve "open" USDT/DAI selectors on Arbitrum sit on
   a 1.30 USDT pool (`ipUSDT 0x37241A7E141687F8bC29dF2999AA98E775503773`, 6 decimals, last mint 2023-05-18) and on a token
   that does not exist. Evidence that a path is real therefore has to be an executed call; `_attackOn` provides it, and
   `test_2_probe` prints the dispatch verdict per selector (`IPOR_012` = route miss, `IPOR_015` = paused).

What v3.2 already proved and v3.3 keeps: the 6-arg arity `0x3696578d` is the right one for Arbitrum USDC and it *is*
dispatched (revert `IPOR_015` = `METHOD_PAUSED`, `contracts/libraries/errors/IporErrors.sol:88`, raised at
`contracts/router/AccessControl.sol:122`); the pause map is per selector and publicly readable via `paused(bytes4)`; and the
direct-service bypass is dead because services run through `functionDelegateCall`
(`IporProtocolRouterAbstract.sol:20,60`) so the signer slot is the router's — a raw service call reverts `IPOR_020`
(the run printed exactly that).

## 3. Run it

Arbitrum and Ethereum both need a fork; **run Ethereum first** — it is the deployment where the money is and where nothing is
paused.

```bash
cd ~/arc_hedgefun
cp /path/to/ee.io/audit/ipor/fork/IporFork.t.sol test/

export ETH_RPC=https://eth.llamarpc.com       # or any mainnet archive RPC
export ARB_RPC=https://arb1.arbitrum.io/rpc   # or your Alchemy/Infura URL
export BASE_RPC=...                           # optional, only for test_4_all_chains

# 1. the run that decides the finding (Ethereum USDC, 92 k -> then USDT, then DAI automatically)
CHAIN=eth forge test --match-contract IporFork --match-test test_1_attack -vv

# 2. the same attack on Arbitrum; USDC will be skipped as closed and wstETH will be attacked
#    through the 5-arg selectors (,,-5arg-,,) that are open there
CHAIN=arb forge test --match-contract IporFork --match-test test_1_attack -vv

# 3. state of the world, cheap, read-only
CHAIN=eth forge test --match-contract IporFork --match-test "test_0_recon|test_3_pause" -vv
CHAIN=eth forge test --match-contract IporFork --match-test test_4_all_chains -vv
```

Five tests, in the order you want to read them:

| test | what it answers | gas / risk |
|---|---|---|
| `test_3_pause` | full pause map (18 open selectors × 4 assets × 3 chains) + the direct-service bypass experiment | read-only (one `deal` for the bypass attempt) |
| `test_4_all_chains` | depth in USD and pause state for Arbitrum / Ethereum / Base in one run | read-only |
| `test_0_recon` | per-pool depth, idle cash, vault, ipToken supply, exchange rate, and which depth source was used | read-only |
| `test_2_probe` | does this router dispatch each selector, and is it paused | read-only |
| `test_1_attack` | the attack itself; walks every pool on the chain, deepest first, until one opens | one owner-gated cheat, see §4 |

```
FORK_BLOCK=26310577 CHAIN=arb forge test --match-contract IporFork -vv     # reproducible numbers
CHAIN=eth TARGET=Usdc forge test --match-contract IporFork --match-test test_1_attack -vv
```

Attack defaults: attacker takes **half the book as LP**, **half the book as swap total**, 1000× leverage, 90 days held.
`TARGET=Usdc|Usdt|Dai|WstEth` forces one pool (default: deepest by USD, then fall back pool by pool). Everything else is
optional: `ATK_LP`, `HONEST`, `TOTAL`, `LEV`, `TENOR` (28/60/90), `DAYS`, `CHUNKS`, `FORK_BLOCK`, plus `CHAIN=arb|eth|base` /
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

Full `-vv` output of `test_1_attack` on Ethereum (and on Arbitrum), then `test_0_recon` + `test_3_pause`. The numbers that decide the finding:

1. for each pool the loop touches: `depth source`, `depth0`, `LP balance after swap`, and whether the swap opened at all
   (already known: Ethereum 18/18 open, Arbitrum USDC closed, Arbitrum wstETH 5-arg open, Base closed);
2. `LP balance`, `treasury idle`, `asset manager` per pool (recon) — the reachable ceiling;
3. `rate0` → `rate after swap` → `rate1` and `fair rate` — how much of the mark is phantom (`phantom inflation x1000`);
4. `NET PROFIT` / `NET LOSS` in wad and USD, next to `spent` — the attacker's real balance delta;
5. the honest LP block: claim vs actually received — the victim's loss;
6. `treasury idle after` / `redemption capacity` — how much cash actually left the pool.
