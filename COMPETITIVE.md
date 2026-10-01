# ee.io — Nâng cấp cạnh tranh (v0.3.0)

**Ngày:** 2026-09-22 · **Nền:** audit v3 đã dọn 4 Critical + 4 High. Tài liệu này tổng hợp (1) phân tích đối thủ trực tiếp, (2) khoảng trống của ee.io, (3) đúng những gì đã được implement trong đợt này.

---

## 1. Đối thủ và mô hình của họ

| Đối thủ | Điểm bán hàng cốt lõi | Điểm họ YẾU → cơ hội cho ee.io |
|---|---|---|
| **FixedFloat** | Toggle fixed/float ngay trong widget; fee bó trong rate (float 0.5%, fixed 1%); tracking real-time + link explorer | FEE che trong rate — không breakdown. ee.io: bảng so giá 7 venue net-of-everything. |
| **ChangeNOW** | 1000+ coin, UX đơn giản, không KYC | Fee không minh bạch, bị Swapzone kiểu review bóc rate kém; không có route comparison. |
| **SideShift** | Partner REST API (affiliate key, trả hoa hồng bằng XAI), Telegram bot, extension | Phí ẩn, lock vào token XAI. ee.io: vén cả fee lẫn partner share bằng số cụ thể. |
| **StealthEX** | Fixed & float, floating có thể lệch ±5% | "Floating slippage" là lỗi kêu số 1 của category. ee.io: drift check + minOut on-chain. |
| **GhostSwap** | Nhanh, 1600 pair | Chỉ float, không lock được giá. |
| **Uniswap/1inch dApp** | UX ví-connect chuẩn DeFi | Chỉ same-chain; không "no-wallet deposit"; UX bridge cồng kềnh. |

**Ba đòn đối thủ lớn nhất đã cài trong đợt này:** lựa chọn fixed/float hiển thị trước khi gửi, API partner ăn hoa hồng, tracking real-time. Đòn khác biệt (4) nằm dưới.

## 2. Đã ship trong đợt này

### A. Lock-or-Refund — bản "fixed rate" web kí sinh làm THẬT được (và tốt hơn custodian)
Phản tuyến đúng của chủ dự án: **không giữ inventory thì không honor được lock kiểu ChangeNOW** — họ là hot wallet, ăn rủi ro thị trường bằng ví nóng, và lợi nhuận lớn của họ đến từ việc *giữ tiền user khi rate xấu đi*. Parasite không thể và không nên giả họ.

Bản đúng của "locked rate" cho mô hình non-custodial là **lock-or-refund**:
- Số minOut được PIN vào `DepositRecord` lúc tạo đơn (10-phút window, fee 100bps cho việc cover).
- Relayer chỉ ký thực thi nếu route tươi còn giao ≥ số lock. Nếu thị trường đứt lock: **không chữ ký nào được đưa ra** — tiền nằm nguyên trong proxy, execution resume khi route hồi, upside vẫn thuộc user.
- Nếu route vượt lock: minReturn trong calldata được biểu diễn là slippage động `pin = (fresh − locked)/fresh` — **toàn bộ upside về user**, downside chặn cứng bởi minOut on-chain (hỏng → contract refund nguyên input in-tx).
- Custodian giả "fixed" để ăn chênh lệch; ta công khai "hoặc khóa, hoặc hoàn tiền — on-chain, không ticket".
- Copy UI nói đúng: `lock honoured, or full input back on-chain`; DepositFlow banner "Lock-or-refund". Relayer véto+dynamic-slippage ở `server/depositProxy.ts` (`executeDeposit`).

### B. So route theo FAILURE BEHAVIOR — cái category chưa ai làm
Mọi instant exchange xếp route theo giá tốt nhất lúc thành công; điểm khác biệt có giá trị thật là *chuyện gì xảy ra khi thất bại*:
- `failureMode` trên ExecutionPlan + DepositRecord, ba tầng: `atomic-refund` (proxy contract refund nguyên input nếu không minOut — độc quyền của route deposit), `protocol-refund` (THORChain tự refund khi overload), `revert-only` (ví user tự ký, không điền thì revert).
- Hiển thị chip `FAILURE_MODE_LABEL` trong tracker; board giữ fee/gas/ETA/health. Custodian không copy được tier 1 vì nghề của họ là giữ tiền user.

### C. Evidence receipt — artifact đọc được bằng máy, kiểm lại được mãi mãi
- `GET /api/orders/:id/receipt`, `GET /api/deposit/:id/receipt` → JSON `ee.io/receipt-v1`: terms bất biến + state biến động tách riêng + `evidenceHash = keccak256(stable-json(terms))`.
- Nút **Download receipt** trong DepositFlow + OrderTracker — kế toán/dispute channel/partner cầm được bằng chứng không cần tin server còn sống.
- Custodian không thích làm cái này: evidence pack khóa họ vào điều khoản đã quảng cáo.

### D. Kênh phân phối (table stakes — không khoe là đột phá)
- **Smart Route Board**: sort Recommended/Fastest/Lowest fee + reliability chip (venue-health). Không có nó thì chỉ là SideShift kém hơn — retention, không phải đòn.
- **Partner API + widget**: cách SideShift/ChangeNOW thật sự kiếm doanh thu; là kênh bán, phòng thủ. Env `EE_PARTNER_KEYS=id:sk_live_…:shareBps`; iframe `widget.html` 1 dòng.
- **SSE + webhooks**: chuyện bình thường ở category này — mình chỉ bắt kịp so với ChangeNOW/SideShift, không vượt.

### E. Kỹ thuật hỗ trợ theo sau (gọn liệt kê — không kể lại)
- **Venue health + circuit breaker**: cửa sổ 30 trial/venue, mở circuit khi ≥3 lỗi liên tiếp hoặc failure ≥60%, probe half-open 30s, đóng khi ok; quote engine skip live-call venue đã mở mạch; `GET /api/venues`; quote gắn `reliabilityPct` + `health`.
- **Gas oracle**: `EE_RPC_<CHAIN>` → `eth_gasPrice` live cache 45s × native price đúng chain; RPC hỏng → fallback tĩnh vô hình. Simulator nhận `gasUsdOverride`.
- **Drift check trong ExecutionInspector**: auto re-quote đúng venue khi mở plan executable; ≤−0.8% cảnh báo đỏ "rebuild the plan".
- **Real-time layer**: SSE (`/api/orders/:id/stream`, `/api/deposit/:id/stream`) + webhookUrl một-shot mỗi transition (scan 3s, seed baseline không ban; validate strict, timeout 4s); client fallback polling.
- **Điều hướng**: Navbar Recent (localStorage, resume tracker), deep link `?from=…&to=…&deposit=DP-…` prefill + reopen flow đúng pair.
- **Fixed/float plumbing**: fee/slippage/window theo contract qua engine → plan → order → deposit → relayer; UI segmented + countdown + chặn submit khi lock hết hạn.

## 3. Trạng thái kiểm chứng đợt này

- Tests **194/194 pass** (15 files): venueHealth 6, partners 5, notify 5, gasOracle 5, receipt 4 (hash deterministic + tamper-detection + volatile-state-exclusion + lock pinned), **targetLock 12** (pure lock-gate math, creation validation, expiry clamp, receipt condition-pinning + tamper), **registry integrity 9** (EIP-55 checksums, THORChain notation self-consistency, venue-routability probes, price-map coverage), executionPlanner 2 rateType, UI "default float, Fixed toggle re-quotes fixed".
- **Target Lock (v0.4) — limit order không orderbook**: user pin targetMinReceive > floor hiện tại; escrow giữ input; relayer chỉ bắn khi route trả đủ target (lock-gate pure `lockGate`, slippage pin = spread−5bps, floor 15bps); không chạm thì hết hạn auto-refund. Target nằm trong evidence digest (điều kiện khớp có thể chứng minh), market observation nằm ở state (volatile, không hash). UI: nút Target thứ 3 (prefill +3%), chọn cửa sổ 1h–72h, DepositFlow thanh tiến độ route-vs-target.
- Asset registry: **81 assets / 17 chains** (35 → 81). Audit xoá 2 THORChain-tag sai (THOR không hỗ trợ Polygon/Arbitrum), sửa 3 contract address lệch checksum (RNDR, WBTC.Polygon, LINK.Polygon), demote XMR/TRX khỏi "popular" (unrouteable — giữ để validate address).
- `tsc --noEmit` sạch, `vite build` sạch.
- Smoke API thật: fixed deposit có `rateType:'fixed'` + `failureMode:'atomic-refund'` + fee 100bps ✓; `GET /api/deposit/:id/receipt` trả schema + evidenceHash + terms kèm rateType:'fixed' ✓; `/api/venues`, SSE handshake, partner 401 — đều ✓.

## 4. Điều CỐ TÌNH không làm (ghi rõ để không mất thứ tự sau này)

- **Limit order / TWAP**: làm mất bản chất "instant"; nên là sản phẩm anh em riêng.
- **Persistence**: in-memory by design — đơn là read-only view của on-chain trạng thái. Nếu cần, Postgres chỉ để warm-load, không thay đổi bản chất.
- **DEX-sale của partner-fee**: ledger là sổ cái để operator settle thủ công — on-chain settlement sẽ cần contract riêng, scope lớn.
- **1inch**: vẫn cần operator xác nhận `dstAmount` đã net referrer fee chưa (§5 khuyến nghị của AUDIT_V3) trước khi bật partner share cho venue đó.

## 5. Env mới thêm (operator checklist)

```
EE_RPC_<CHAIN>=…        # gas oracle live + watcher (ETH, BASE, BSC…)
EE_PARTNER_KEYS=id:key:shareBps,…   # bật /api/partner/v1
```
Cả hai đều optional — hạ tầng tối thiểu không đổi so với v0.2.0.
