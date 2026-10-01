# ee.io — Audit v3 (deep audit, lần 2)

**Ngày:** 2026-09-22
**Branch:** `arena/01a0c99e-ee-io`
**Phạm vi:** toàn bộ repo — `contracts/*`, `server/*`, `shared/*`, `src/*`, `tests/*`, config, build.
**Bối cảnh:** audit v2 (commit `22c94ec`) đã fix CREATE2 salt binding, factory init, fee hijack, frontrun, slippage delta, markFunded verification. Đợt này đọc lại từng dòng, **biên dịch lại contract bằng solc 0.8.26/0.8.30 thật và chạy E2E trên ganache** — không chỉ đọc bằng mắt.

---

## 1. Kết quả kiểm chứng tự động

| Kiểm chứng | Kết quả |
|---|---|
| `solc 0.8.26 + 0.8.30` biên dịch cả 2 contract | ✅ 0 errors, 0 warnings (sau fix — **trước fix: DeclarationError**) |
| E2E ganache: CREATE2 off-chain (TS) ≡ on-chain (Solidity) | ✅ (trước fix: **MISMATCH — bug mất tiền**) |
| E2E: router fail → refund atomically về destination | ✅ |
| E2E: swap thành công → forward output về destination | ✅ |
| E2E: `refund()` self-rescue bằng native ETH | ✅ |
| E2E: griefer gửi 1 wei chiếm slot `depositor` → vô hiệu | ✅ refund luôn về destination |
| CashAddr (BCH): 8 vector hợp lệ / 6 vector typo (cross-check `bchaddrjs`) | ✅ |
| `npm run test` | ✅ 147/147 |
| `npm run typecheck` + `npm run build` | ✅ |

Script E2E lưu tại `scripts/verify-deposit-proxy.mjs` (chạy: `npm i --no-save solc@0.8.30 ganache && npx tsx scripts/verify-deposit-proxy.mjs`).

---

## 2. Findings theo mức độ nghiêm trọng

### 🔴 CRITICAL

**C-01 · Địa chỉ deposit CREATE2 tính off-chain ≠ địa chỉ factory deploy — tiền gửi vào mất vĩnh viễn**
- **File:** `server/depositProxy.ts` — `minimalProxyCreationCode()`.
- **Bug:** `MINIMAL_PROXY_SUFFIX` **không** có prefix `0x` (`'5af43d...'`), nhưng code gọi `.slice(2)` “để bỏ 0x” → cắt mất opcode `5a` đầu. Init code hash lệch → deposit address hiển thị cho user là một địa chỉ factory **không bao giờ** deploy được.
- **Bằng chứng:** deploy factory thật trên ganache → `factory.computeAddressForOrder(...)` khác hẳn `computeDepositAddressBound(...)`. Sau fix: khớp tuyệt đối.
- **Fix:** nối suffix nguyên vẹn; thêm 2 regression test (canonical 55-byte init code + parity abi.encode) trong `tests/depositProxy.test.ts`.

**C-02 · Factory không compile với đúng pragma đã khai báo (`^0.8.24`)**
- **File:** `contracts/DepositProxyFactory.sol`.
- **Bug:** `createProxyForOrder()` và `createAndExecute()` gọi `createProxy(...)` — hàm **`external`** — trực tiếp bằng tên. Solidity cấm internal-call hàm `external` (chỉ qua `this.f()`); solc ≥ 0.8.24 báo `DeclarationError`. Tức là contract ở HEAD **không thể compile** bằng compiler nó tự khai báo.
- **Fix:** tách `_createProxy()` internal; cả 3 entry points dùng chung. Verify: compile OK 0.8.26 & 0.8.30.

**C-03 · Refund khi swap fail là dead code + không có lối thoát cho user**
- **File:** `contracts/DepositProxy.sol`.
- **Bug kép:** (1) nhánh `if (!ok)` của v2 refund rồi **`revert`** — revert cuộn ngược refund ⇒ tiền kẹt mãi trong proxy; (2) không hàm nào rút tiền nếu minOut vĩnh viễn không đạt (giá sập, aggregator chết) ⇒ **khóa tiền vô hạn**.
- **Fix (v3):** swap fail → refund nguyên tử về `destination`, `Refunded` event, **không revert** (tx succeed); thêm `refund()` self-service — chỉ depositor / destination / factory / relayer gọi được, và tiền chỉ đi được về `destination` bất biến. E2E pass cả 2 kịch bản.

**C-04 · Địa chỉ deposit “thật” sinh ra từ FAKE factory khi chưa cấu hình — burn address**
- **File:** `server/depositProxy.ts` (`factoryFor` fallback `0xdeadbeef…`).
- **Bug:** không set `EE_PROXY_FACTORY*` → địa chỉ gửi cho user sinh từ một factory không tồn tại trên chain ⇒ bất kỳ ai gửi tiền thật vào đều **không lấy lại được**, trong khi UI trình bày như deposit address bình thường.
- **Fix (giữ nguyên demo):** record gắn `simulated: true` + warning “Do NOT send real funds”; `DepositFlow` hiện **banner đỏ Demo mode**; nút “Simulate funded” chỉ hiển thị khi `simulated`. Test: `flags deposits as simulated when no factory is configured`.

### 🟠 HIGH

**H-01 · Server giả mạo trạng thái `executed` khi có RPC thật**
- **File:** `server/depositProxy.ts`.
- **Bug:** (a) `advanceDeposit()` tự đẩy `funding → funded → executing → executed` theo đồng hồ với txHash giả, **race với watcher/relayer thật**; (b) RPC có mà thiếu `EE_RELAYER_PK` → watcher thấy tiền thật rồi báo `executed` giả; (c) mọi exception khi execute bị gắn nhãn `refunded` trong khi tiền vẫn nằm ở proxy.
- **Fix:** fabrication chỉ chạy khi hoàn toàn không có RPC (pure demo); thiếu relayer → giữ `funded` + warning; exception → `funded` + warning + retry throttle 30s (watcher tiếp tục poll); detect event `Refunded` từ receipt để phân biệt fill/refund (vì v3 refund không revert).

**H-02 · Calldata “preview” do server tự chế được broadcast trên chain**
- **File:** `server/executionPlanner.ts`, `src/components/ExecutionInspector.tsx`, `shared/types.ts`.
- **Bug:** với quote `source: 'live'` + ví đã connect, nút *Sign & broadcast* **được bật** dù calldata là `swapGeneric` do server tự encode (selector Kyber, nhưng router đích có thể là 0x/1inch/ParaSwap — gần như chắc chắn revert). Relayer (`executeDeposit`) cũng gửi y chang.
- **Fix:** thêm `executable?: boolean` trên `EvmTransactionPlan` — chỉ `true` khi calldata do aggregator API trả về (hiện: Kyber `/route/build`). Inspector + relayer đều khóa khi `executable !== true`. Test: `tests/executionPlanner.test.ts`.

**H-03 · Validator Bitcoin Cash không kiểm checksum — typo vẫn "hợp lệ"**
- **File:** `shared/address.ts`.
- **Bug:** header file tuyên bố “verify real checksums thay vì regex”, nhưng BCH chỉ test `/^[qp][0-9a-z]{40,}$/` — gõ sai 1 ký tự vẫn pass ⇒ order trỏ tới địa chỉ chết.
- **Fix:** implement decoder CashAddr đầy đủ (polymod 40-bit, prefix mặc định `bitcoincash` khi prefixless — checksum phủ cả prefix — version byte, single-case, bảng size); cross-check với `bchaddrjs` trước khi chốt. 10 regression test mới trong `tests/address.test.ts`.

### 🟡 MEDIUM

**M-01 · Gas USD hardcode theo giá ETH ($3,420) trên mọi chain**
- **Files:** `server/aggregators/oneinch.ts`, `server/aggregators/openocean.ts`.
- **Bug:** BSC/AVAX/Polygon… bị nhân gas với giá ETH → ước lượng sai 5–100× → **ranking sai venue** (rank = netOutUsd − gasUsd). 1inch còn có dead ternary hai nhánh giống hệt nhau.
- **Fix:** helper `nativeUsdPrice(ctx)` trong `aggregators/types.ts` — tra asset native của chain (BNB/POL/AVAX…) qua price oracle thật.

**M-02 · Order/deposit ID 6 chữ số va nhau → ghi đè đơn của user khác**
- **Files:** `server/orders.ts`, `server/depositProxy.ts`.
- **Bug:** `EE-${6 chữ số}` / `DP-${6 chữ số}` qua `Math.random()`; theo birthday bound va chạm từ ~1k đơn; `map.set` overwrite âm thầm.
- **Fix:** vòng lặp sinh tới khi unique. Test tạo 8 đơn id khác nhau.

**M-03 · `api.1inch.dev` đã ngừng hoạt động — mọi quote 1inch chết lặng lẽ**
- **File:** `server/aggregators/oneinch.ts`.
- **Bug:** 1inch bắt buộc migrate sang `api.1inch.com` (Rebranding FAQ, deadline đã qua). Adapter gọi host cũ ⇒ live quote lỗi ⇒ fallback simulated → user tưởng đang so giá thật.
- **Fix:** đổi BASE_URL. (`.env.example` đã ghi đúng — code mới là chỗ sai.)

**M-04 · Giá live mới fetch bị ghi đè bằng bảng reference tĩnh khi CoinGecko chập chờn**
- **File:** `server/prices.ts`.
- **Bug:** refresh thất bại trong khi đã có cache live ⇒ trả về `referencePrices()` (tĩnh, có thể cũ hàng tháng) và cache luôn với timestamp mới.
- **Fix:** giữ snapshot live cũ (stale nhưng thật), chỉ boot lần đầu mới fallback reference.

**M-05 · THORChain: tolerance gửi lên khác với limit tính ra**
- **File:** `server/aggregators/thorchain.ts`.
- **Bug:** gửi `liquidity_tolerance_bps = max(slippage, 100)` nhưng `limit1e8` tính theo `slippageBps` thô ⇒ memo bảo vệ chặt hơn mức network biết → refund không cần thiết. Note streaming in “from X to X bps” lặp cùng một số.
- **Fix:** dùng chung `toleranceBps` đã clamp cho cả hai; note streaming hiện uplift output thật.

### 🟢 LOW

**L-01 · Factory `transferOwnership` không thu hồi quyền relayer của owner cũ** — owner cũ vẫn `execute()` được sau khi bàn giao. **Fix:** revoke trước khi chuyển. (`DepositProxyFactory.sol`)

**L-02 · `DepositFlow` link explorer hardcode Etherscan** — deposit trên BSC/Base… dẫn sai explorer. **Fix:** `CHAINS[deposit.chain].explorerAddress`.

**L-03 · `useQuote` key thiếu `slippageBps`** — đổi slippage không refetch quote. **Fix:** thêm vào key. (`src/hooks/useQuote.ts`)

**L-04 · POST JSON lỗi cú pháp trả HTML thay vì JSON** — client phải parse “Malformed response”. **Fix:** error middleware trả `{ error: 'Malformed JSON body' }`. (`server/index.ts`)

**L-05 · Dead code:** ternary trùng nhánh `? to.chain : to.chain` trong `simulation.ts` — dọn + comment rõ ý đồ.

---

## 3. Đã kiểm tra kỹ nhưng KHÔNG phải bug (tránh false positive)

| Mục | Kết luận |
|---|---|
| `feeBpsFor` / `defaultSlippageBps` / `expiresAt` bỏ qua `rateType='fixed'` | **By design** — `tests/quoteEngine.test.ts:97` pin hành vi “V1 is float-only”. Config `fixedBps`/`FIXED_RATE_WINDOW` là dự trữ V2; không sửa để khỏi phá product contract. |
| Kyber `amountOut` khi `chargeFeeBy=currency_out` | Đã net fee (verify qua docs + evidence PR thực chiến) — adapter đúng. |
| Keccak/SHA256/bech32/base58 tự cài | Test vectors BIP-173/350 + EIP-55 pass; keccak khớp `ethers.id()` (dùng cho REFUNDED_TOPIC). |
| `toScientificNotation` (memo THORChain) | Đúng theo rule `NeM = N×10^M` (`1000 → 1e3`), kèm cảnh báo lỗi ví dụ trong docs chính thức. |
| Địa chỉ token trong `shared/assets.ts` | Rà soát USDT(BSC, 18dp), USDC theo từng chain, wBTC/wETH — khớp mainnet thật. |
| `POST /simulate-deposit`, `/funded` không auth | Demo endpoint by design; với RPC cấu hình, `markDepositFunded` verify on-chain. Lưu ý vận hành: nên gate/disable khi production (xem §4). |

## 4. Khuyến nghị vận hành (không đụng code)

1. **Trước khi nhận volume thật:** set `EE_PROXY_FACTORY_*` + `EE_PROXY_LOGIC_*` + `EE_RELAYER_PK` + `EE_RPC_*`; bật giám sát `simulated=false` trên mọi deposit.
2. Deploy lại Factory sau khi compile v3 (C-02 + C-03 + L-01 thay đổi bytecode); `computeAddress` không đổi so với v2 cho cùng salt — nhưng vì C-01, bất kỳ deposit CŨ nào đã phát hành với địa chỉ lỗi slice(2) cần kiểm tra thủ công.
3. Cân nhắc rate-limit cho `/api/quote` `/api/deposit` và gate các endpoint `simulate-*` khi production (hiện mở CORS + không auth — chấp nhận được cho demo, rủi ro abuse quota khi public).
4. In-memory store mất khi restart — deposit đang bay sẽ “biến mất” khỏi UI dù tiền vẫn on-chain; cần persistence (đã ghi trong AUDIT v2, vẫn còn hiệu lực).
5. 1inch `dstAmount` đã net referrer fee hay chưa: không xác minh được dứt điểm từ docs — trước khi bật 1inch live nên compare 1 giao dịch thật (nếu sai, sai lệch tối đa 0.5% ở hiển thị, giao dịch on-chain vẫn theo calldata của 1inch).

## 5. File đã thay đổi

`contracts/DepositProxy.sol` (v3: refund atomically + `refund()` + destination-only refunds) · `contracts/DepositProxyFactory.sol` (`_createProxy` internal + revoke relayer) · `server/depositProxy.ts` (C-01, C-04, H-01, M-02) · `server/executionPlanner.ts` + `shared/types.ts` + `src/components/ExecutionInspector.tsx` (H-02) · `shared/address.ts` (H-03) · `server/aggregators/{types,oneinch,openocean,thorchain}.ts` (M-01, M-03, M-05) · `server/{prices,orders,simulation,index}.ts` · `src/components/DepositFlow.tsx` (C-04 UI, L-02) · `src/hooks/useQuote.ts` (L-03) · tests: `address.test.ts`, `depositProxy.test.ts`, + mới `executionPlanner.test.ts` · mới: `scripts/verify-deposit-proxy.mjs`, `AUDIT_V3.md`.
