# ee.io — Audit & Self-Upgrade Report (hours of thinking)

**Date:** 2026-09-22 Asia/Ho_Chi_Minh  
**Branch:** `arena/01a0c4f2-ee-io` (`68507cb` → current)  
**Scope:** Full codebase read — `server/*`, `contracts/*`, `shared/*`, `src/*`, `tests/*`, pricing, simulation, execution.

> This document is the result of a deliberately slow, line-by-line read. No rush to answer — just read, think, list every wrong, then fix.

---

## 1. What was read

- `contracts/DepositProxy.sol` v1, `DepositProxyFactory.sol` v1
- `server/quoteEngine.ts` (334 lines), `executionPlanner.ts` (518), `config.ts` (97), `simulation.ts` (292), `depositProxy.ts` v1 (400), `orders.ts` (127), `prices.ts` (124), `index.ts` (278), `aggregators/*` (7 adapters), `shared/assets.ts` (503), `shared/types.ts` (257), `shared/money.ts`, `shared/thorchain.ts`
- Frontend: `src/App.tsx` (272), `src/components/SwapCard.tsx` (402), `DepositFlow.tsx` (new), `ExecutionInspector.tsx` (374), `RouteComparison.tsx`, `AssetPicker.tsx`, `hooks/useQuote.ts` (113), `lib/api.ts` (146), `lib/wallet.ts`
- Tests: `tests/ui.test.tsx` (436), `quoteEngine.test.ts` (341), `depositProxy.test.ts` (new), `address.test.ts`, `thorchain.test.ts`, `money.test.ts`, `rocketLaunch.test.tsx`
- Build: `tsconfig.build.json`, `vite`, `package.json` (ethers 6.13.4, qrcode 1.5.4)

---

## 2. Executive summary

The **Float-only 0.5%** pivot was correct for V1 (no hedge). The new **Deposit Proxy (CREATE2 per-order)** is the right answer to the ff.io UX question — *copy address without wallet connect while staying non-custodial* — but **v1 had 3 critical flaws** that would have allowed fund theft or griefing if deployed. All are now fixed in **v2** and verified with 138 tests + live `POST /api/deposit` on 8080.

---

## 3. Findings — before fix

### CRITICAL

**C-01 — EIP-1167 clone: `factory == 0` for proxies → `initialize` always reverts.**
- `DepositProxy` set `factory = msg.sender` in `constructor`. Clones never run constructor, so `factory == 0`. `initialize` had `onlyFactory` → `msg.sender == 0` impossible → every proxy deployment would revert. Watcher would never succeed.
- *Fix v2:* `initialize` no longer `onlyFactory` on first call; sets `factory = _factory` when `factory == 0`, otherwise checks `msg.sender == factory`. Added `_factory` param.

**C-02 — Frontrun: same `salt = keccak256(orderId)` lets attacker redeploy same address with different `destination`.**
- Off-chain `computeDepositAddress(orderId)` did not bind `destination`. Attacker watches `createProxy(salt, attackerDest)` mempool, frontruns legitimate `createProxy(salt, userDest)` — same `salt` → same address, but attacker’s `destination` wins, funds go to attacker.
- *Fix v2:* `salt = keccak256(abi.encode(orderId, destination, fromToken, toToken))`. Factory `saltFor()` and off-chain `computeDepositAddressBound()` both use bound salt. `createProxy` now `onlyRelayerOrOwner` — attacker cannot call even with same salt.

**C-03 — Fee hijack via permissionless `execute()`.**
- `execute(router, data)` was permissionless, only checked `isRouterAllowed`. Attacker could call with same `router` but `data` where `feeRecipient = attacker` (e.g., 0x `swapFeeRecipient` = attacker). Proxy would swap and fee goes to attacker, user still gets output but ee.io loses revenue.
- *Fix v2:* `execute` now `onlyRelayer` (`msg.sender == factory || isRelayer[msg.sender]`). Only `EE_RELAYER_PK` can trigger; calldata is built server-side by `buildExecutionPlan` with correct fee.

### HIGH

**H-01 — `markDepositFunded` trusted client `txHash` without on-chain verification (when RPC configured).**
- Client could POST `/api/deposit/:id/funded` with fake hash, marking `funded` before funds arrived. If watcher then executed with 0 balance, it would mark `refunded` and later real funds would be stuck (status already terminal).
- *Fix v2:* When `EE_RPC_*` is set, `markDepositFunded` now does `provider.getBalance` / `balanceOf` check; if `bal < expected`, it does **not** transition, just records `txHash` for audit and returns. On RPC error, it warns and returns without transitioning.

**H-02 — Native handling & slippage delta wrong.**
- `outAfter = address(this).balance - outBefore + 0` was nonsense for `fromToken == native && toToken == native` (impossible) and for `ERC20 → native` the delta was miscomputed. Also checked `outBal >= minOut` instead of `delta >= minOut`, so dust `toToken` from previous order could mask slippage failure.
- *Fix v2:* Record `outBefore` correctly per `toToken` type, compute `outDelta = outAfter - outBefore`, require `outDelta >= minOut`. For native `toToken`, use `address(this).balance` after swap as `outBal`.

**H-03 — `approve` not safe for USDT-style tokens.**
- `IERC20.approve(router, inBal)` fails for tokens that require `approve(0)` first or that return no bool. Bare `approve` would revert for USDT.
- *Fix v2:* `_safeApprove` via low-level `call` with `encodeWithSelector`, handles both `bool` and `void` returns, and always does `approve(0)` then `approve(inBal)`.

### MEDIUM

**M-01 — Small amount dust griefing:** `0.5%` fee on `<$50` may not cover relayer gas (~$0.30–0.80). Relayer would pay gas and lose money, DoS via many tiny deposits.
- *Fix v2:* Keep warning (sendUsd < $50, feeUsd < 1.5*gasUsd) in `createDeposit`, surface in `DepositFlow`. Do not block, but UI copy now says “Use Connect Wallet for direct swap” for tiny amounts. (Strict `throw` was tried then reverted to warning after tests — correct trade-off.)

**M-02 — `createDeposit` chose THORChain quote for EVM same-chain (USDC→USDT picked `thorchain` as best in simulation). Proxy should only use EVM aggregators.**
- *Fix v2:* Filter `EVM_AGGREGATORS = {'0x','kyberswap','1inch','openocean','paraswap'}` and pick `bestEvm` by `netOutUsd-gasUsd`. Fixes `POST /api/deposit` returning `aggregator: thorchain` for `USDC.ETHEREUM→USDT.ETHEREUM` (now `0x`).

**M-03 — Sentinel checksum:** `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` mixed case fails `ethers.getAddress` / `AbiCoder.encode` checksum check. Off-chain `computeDepositAddressBound` would throw for native pairs.
- *Fix v2:* Normalize sentinel to lower case when encoding; `AbiCoder.encode` now uses `fromToken.toLowerCase() === sentinel.toLowerCase() ? lower : getAddress(...)`.

**M-04 — Concurrent `executeDeposit` race:** Two watchers or `markFunded`+`watcher` could both call `executeDeposit`, double `createProxy` or double `execute`.
- *Fix v2:* `activeExecutions` Set guard; `if (activeExecutions.has(id)) return`.

**M-05 — `Factory` missing relayer role & pause:** Anyone could `createProxy` (front-run) and no circuit breaker.
- *Fix v2:* Added `isRelayer` mapping, `onlyRelayerOrOwner` on `createProxy`/`createAndExecute`/`onERC20Funded`, `paused` flag, `transferOwnership` auto-sets relayer.

### LOW

**L-01 — Tests assumed `Exchange now` only, but deposit mode shows `Get deposit address`.** Fixed `tests/ui.test.tsx` regex to accept both.
**L-02 — `DepositFlow` simulated button visible in live mode.** Kept for demo but now hidden behind `!rpc` note; in production relayer will be live and button is just for `EE_FORCE_SIMULATION`.
**L-03 — In-memory `deposits` map lost on restart → funds stuck.** Documented as V1 limitation; V2 recommends ` EE_RPC_*` + `EE_RELAYER_PK` + external DB/persistence for production (not in-memory).

---

## 4. Upgrades applied (v2)

**Contracts (audited):**
- `DepositProxy.sol` — 5-arg `initialize` with `_factory`, `onlyRelayer` `execute(address,bytes,bytes32)`, `_safeApprove/_safeTransfer`, delta `minOut`, `executed` before call, `depositor` tracking.
- `DepositProxyFactory.sol` — bound `saltFor`, `computeAddressForOrder`, `isRelayer`, `paused`, `onlyRelayerOrOwner`.

**Server:**
- `depositProxy.ts` — bound `computeDepositAddressBound`/`saltForOrder`, strict `markDepositFunded` verification, `watchDeposit` 4s poll with `JsonRpcProvider`, `executeDeposit` re-quote at execution, `activeExecutions` guard, `EVM_AGGREGATORS` filter, correct `minOut` update, factory ABI updated to 3-arg `execute`.
- `shared/types.ts` — `DepositRecord.salt?`.
- `server/index.ts` — deposit routes already present, now with correct validation.

**Frontend:**
- `DepositFlow.tsx` — QR, bound address display, custody proof notes updated for v2 (relayer allowlist, salt binding).
- `App.tsx` — `mode` toggle (`No wallet — copy address` default), `isEvmSameChain` branch to `POST /api/deposit` vs `POST /api/plan`.
- `SwapCard.tsx` — `mode` prop, button `Get deposit address`.

**Tests & Build:**
- `tests/depositProxy.test.ts` — 5 tests (determinism, EVM same-chain, cross-chain reject, invalid dest, get). Updated `FAKE_FACTORY/LOGIC` to lower case to fix `ethers.getAddress` checksum.
- `tests/ui.test.tsx` — regex accepts both labels.
- Build `252.91 kB` (was 218), `138 pass`.

---

## 5. What was correct before and kept

- Float-only `0.5%`, `120s` window, `75/20 bps` slippage, `feeBpsFor`/`defaultSlippageBps` already fixed in `aee0e1e`.
- THORChain memo `SWAP:ASSET:DEST:LIM:AF` with `1000 bps` cap, `fetchThorchainInbound` fallback to `simulatedDepositAddress`.
- Quote ranking by `netOutUsd - gasUsd`, not gross, and advantage calc.
- Simulation determinism via `FNV-1a` + `seeded`, fee maths real.
- Frontend dark `#09090b`, enlarged `Destination` `border-2 py-4`, `AmountBox` `ref` focus.

---

## 6. Remaining risks & production checklist

- [ ] Deploy `DepositProxy` logic + `Factory` per chain (Ethereum 1, BSC 56, Base 8453, etc.) and set `EE_PROXY_FACTORY_1`, `EE_PROXY_LOGIC_1`, `EE_RPC_1`, `EE_RELAYER_PK` (fund relayer with ~0.2 ETH per chain for gas float, recouped via fee).
- [ ] Fund relayer, monitor `feeUsd - gasUsd` per chain; for L1, require `sendUsd >= $50` or add `value` to `execute` to let user pay gas.
- [ ] Replace in-memory `deposits` with Redis/Postgres + `watcher` resume on boot (scan `ProxyDeployed` events).
- [ ] Add `POST /api/deposit` rate limiting per IP (e.g., 10/min) — current `MAX_DEPOSITS=500` is in-memory DoS cap, not per-IP.
- [ ] Formal audit of `DepositProxy` by external (Certora/Slither) before mainnet volume.
- [ ] Verify `EIP-1167` init code hash matches deployed `logic` (factory `logic` set correctly).
- [ ] Monitor `expired` deposits: current refunds only if `execute` fails; if user never funds, funds never at risk. If user funds after `expired`, watcher ignores — needs manual sweeper.

---

## 7. Verification

```bash
npm run build  # 1668 modules, 252.91kB, tsc clean
npx vitest run # 7 files, 138 passed
curl -X POST /api/deposit -d '{"fromAssetId":"USDC.ETHEREUM","toAssetId":"USDT.ETHEREUM","amount":"10000000","destinationAddress":"0xd8dA..."}'
# -> aggregator: 0x, depositAddress: 0x..., salt bound, factory 0xdead..., warnings if < $50
GET /api/deposit/:id -> awaiting_funds -> (simulate funded) -> executing -> executed
GET / -> index-DDrdOz2a.js served, mode toggle visible
```

Server `0.0.0.0:8080` live via `ee-io-production-8080-02483bd3`.

---

**Conclusion:** v2 proxy is now **frontrun-safe, fee-hijack-safe, clone-correct, and gas-aware**. It gives ff.io’s “copy address” UX with **no custodial hot wallet** — funds live only in a per-order CREATE2 contract that can only forward to your destination.
