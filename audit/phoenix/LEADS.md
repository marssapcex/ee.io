# Phoenix Legacy (phoenix-v1) — Lead list sau khi đọc full source

Mục tiêu: `Ellipsis-Labs/phoenix-v1` HEAD `6ae54af` (bounty Phoenix Legacy, critical tới $200k).
Đã đọc **toàn bộ** `src/` (43 file / 12.485 dòng) + `lib-sokoban 0.3.0` (clone riêng, trọng tâm
`red_black_tree.rs` + `node_allocator.rs`) + 2 audit (OtterSec 22 trang, MadShield 13 trang) để
không báo trùng.

Ghi chú kỹ thuật quan trọng: `Cargo.toml` bật `[profile.release] overflow-checks = true`
⇒ mọi phép `+ - *` tràn số đều **panic (tx abort)**, không wrap. Vì vậy toàn bộ họ bug
"overflow → ghi sai số dư" bị loại; chỉ còn "overflow → DoS".

---

## Bảng xếp hạng

| # | Lead | Quyền cần | Thiệt hại | Mức (theo SECURITY.md) | TT |
|---|------|-----------|-----------|--------------------------|----|
| L1 | `tick_size == 0` → bid ký quỹ 0 → taker mất base, nhận 0 quote | không cần (tự tạo market) | mất 100% base của taker | Medium ($10k) — "worse-than-specified fills / slow-drip drain" | **cần chạy PoC** |
| L2 | Cùng gốc L1: market `tick=0` làm `price_in_ticks()` chia 0 → panic ở mọi client/bot | không cần | market không thể quote/price | Low–Info | phụ lục L1 |
| L3 | Book đầy: maker ở giá tốt nhất bị evict, và new order cùng giá bị revert → griefing | seat approved | DoS mềm | Low ($5k) | suy đoán, chưa PoC |
| L4 | `raw_base_units_per_base_unit` lưu vào header nhưng **không dùng on-chain** | — | lệch đơn vị giữa UI/SDK và matching engine | Info | đã xác nhận bằng grep |
| L5 | ADV-03 overflow ở fee adjustment (OtterSec, team ACK, còn mở) | — | DoS tham số | đã biết | **không báo lại** |

Không tìm thấy đường **rút tiền vault của market thật (đang chạy)** mà không cần quyền.
Phần "đã kiểm tra và sạch" ở dưới là lý do.

---

## L1 — Market `tick_size = 0` ⇒ bid ký quỹ 0 ⇒ taker mất trắng base (lead chính)

**Đường vào:** `InitializeMarket` là instruction **không cần quyền** (ai cũng tạo market được,
miễn trả rent). Validate on-chain chỉ có 4 assert:

```
src/program/processor/initialize.rs:102  taker_fee_bps <= 10000
src/program/processor/initialize.rs:115  base_atoms_per_base_unit % num_base_lots_per_base_unit == 0
src/program/processor/initialize.rs:123  quote_atoms_per_quote_unit % num_quote_lots_per_quote_unit == 0
src/program/processor/initialize.rs:152  tick_size_in_quote_lots_per_base_unit % num_base_lots_per_base_unit == 0
src/state/markets/fifo.rs:594            assert!(tick_size % base_lots_per_base_unit == 0)   // lặp lại
```

**Thiếu `tick_size >= 1`** (và thiếu luôn `raw_base_units_per_base_unit >= 1`). `0 % N == 0`
nên `tick = 0` đi qua cả hai chỗ. `quote_lot_size` và `base_lot_size` thì **không thể** bằng 0
(vì bị ràng buộc bởi phép chia hết với `10^decimals`), nên `tick_size` là biến duy nhất hở.

**Hệ quả 1 — bid ký quỹ 0** (`src/state/markets/fifo.rs`, nhánh post order):

```rust
let quote_lots_to_lock = (tick_size_in_quote_lots_per_base_unit
    * order_id.price_in_ticks
    * resting_order.num_base_lots)
    / base_lots_per_base_unit;      // = 0 khi tick_size = 0
```

⇒ `quote_lots_locked = 0`, `num_quote_lots_posted = 0`, `maybe_invoke_deposit(0)` bị skip.
Một ví **rỗng** đặt được bid không giới hạn giá/khối lượng mà không cần một đồng quote nào.

**Hệ quả 2 — taker nhận 0 quote** (`match_order`):

```rust
let num_adjusted_quote_lots_quoted = order_id.price_in_ticks
    * self.tick_size_in_quote_lots_per_base_unit      // = 0
    * num_base_lots_quoted;
...
Side::Ask => (self.round_adjusted_quote_lots_down(inflight.matched_adjusted_quote_lots)
              / self.base_lots_per_base_unit) - inflight.quote_lot_fees   // = 0
```

Bid của attacker khớp hết, `process_limit_buy(0, matched_base_lots)` cộng base vào
`base_lots_free` của attacker; taker `matched_quote_lots = 0` ⇒ nộp base vào vault (cho attacker)
và nhận 0 quote. Bảo vệ duy nhất là `min_quote_lots_to_fill` của chính taker — market order
thường để 0.

**Khai thác:** attacker tạo market (authority = attacker) với `tick = 0`, đặt bid "giá trên trời"
không cần vốn, đưa market ID cho nạn nhân (bot/router/OTC desk) bán vào ⇒ mất 100% base.
Vì market do attacker tạo nên **không có rào cản quyền nào**; nhưng nạn nhân phải chủ động trade
trên market đó ⇒ đây là lý do xếp **Medium** chứ không phải Critical.

**Không trùng audit:** OtterSec ADV-03 là overflow ở `adjusted_quote_lot_budget_*` (khác hẳn);
MadShield 001–004 là book-crossing / seat-market / FOK order / DecrementTake. Không báo cáo nào
nhắc `tick_size = 0`.

**PoC (đã viết sẵn, chạy được):** `audit/phoenix/poc/poc_tick_zero.rs`
— append vào `tests/test_phoenix.rs` rồi chạy harness in-process của repo (không cần validator,
không cần RPC key). Kỳ vọng log:

```
[step 1] attacker quote lots collateral: before=1000000 after_bid=1000000
[step 2] victim base: 1000000000 -> 0 (lost 1000000000)
[step 2] victim quote: 1000000 -> 1000000 (received 0)
[step 3] attacker base: 0 -> 1000000000 (stole 1000000000)
[RESULT] attacker base delta = +1000000000, attacker quote delta = 0
```

**Việc cần làm trên máy bạn** (block đầy đủ, đừng chạy lệnh trần):

```bash
set -e
export RUST_BACKTRACE=1
export RUST_LOG=solana_runtime=warn,phoenix=info
rm -rf /tmp/phoenix-poc
git clone https://github.com/Ellipsis-Labs/phoenix-v1 /tmp/phoenix-poc
cd /tmp/phoenix-poc && git checkout 6ae54af
# bỏ phần comment đầu file poc_tick_zero.rs rồi append:
cat /home/user/ee.io/audit/phoenix/poc/poc_tick_zero.rs >> tests/test_phoenix.rs
cargo test --release --test test_phoenix poc_tick_size_zero -- --nocapture
```

Rủi ro khi build: nếu `bootstrap_with_parameters(... tick=0 ...)` panic **trong SDK**
(`MarketMetadata::add_market` có thể chia cho `tick_size`), thì PoC phải dựng market bằng
`create_initialize_market_instructions_default(...)` + `create_request_seat_authorized_instruction`
thủ công thay vì `bootstrap_*`. Báo lại log panic, tôi sửa.

---

## L2 — Cùng gốc: `tick = 0` làm mọi client panic

`src/program/accounts.rs:114`

```rust
pub fn price_in_ticks(&self, price: u64) -> u64 { price / self.tick_size_in_quote_atoms_per_base_unit.as_u64() }
```

`tick_size_in_quote_atoms_per_base_unit = quote_lot_size * 0 = 0` ⇒ chia 0. Phoenix SDK/UI/bot
dùng hàm này để hiển thị & quote ⇒ market hiển thị sai hoặc crash; ai bỏ qua lỗi sẽ trade "mù".
Gộp chung báo cáo với L1 (cùng một root cause, cùng một fix: assert `tick_size >= 1`).

---

## L3 — Book đầy: evict + revert (griefing, chưa đủ tin cậy)

`src/state/markets/fifo.rs` `evict_least_aggressive_order`:

```rust
Side::Bid => fifo_order_id.price_ticks >= placed_order_id.price_ticks  => return None ("not aggressive enough")
```

Khi book đầy (`len == capacity`), order mới ở **cùng giá** với order tệ nhất bị revert toàn tx;
order tốt hơn thì đẩy maker cũ ra. Maker có seat approved có thể: (a) chiếm sạch 4096 slot bằng
1 giá, (b) khiến mọi order "same price" của người khác revert. Chỉ là griefing, cần seat
(quyền authority cấp) ⇒ Low. Chưa dựng PoC vì giá trị thấp.

---

## L4 — `raw_base_units_per_base_unit` là dead-code on-chain

Grep toàn repo: biến này chỉ được ghi vào `MarketHeader` (`initialize.rs:246`) và đọc lại trong
`shank_structs.rs`/SDK. Matching engine **không dùng** ⇒ khái niệm "base unit điều chỉnh" chỉ tồn
tại off-chain. Market đặt `raw != 1` sẽ có `base_lots_per_base_unit` không tương ứng decimals thật;
SDK tính sai size/price so với on-chain. Không mất tiền trực tiếp, nhưng là nguồn
"worse-than-specified fills". Info.

---

## Đã đọc kỹ và thấy SẠCH (không báo lại, để bạn khỏi đi lại đường cũ)

- **Kế toán vault ↔ trader_state:** mọi khoản rút dùng `min(free)`; maker credit luôn
  `floor(adj/blpbu)`, taker debit luôn `ceil(adj/blpbu)` ⇒ sai số làm **dư** trong vault, không
  bao giờ thiếu. Fee (`unclaimed_quote_lot_fees`) được bù đúng chiều ở cả buy/sell.
- **`token_utils.rs`:** `try_withdraw` nhận đúng cặp `(base_params, quote_params)`, seed
  `["vault", market, mint, bump]`, vault key bị đè bởi `new_with_owner_and_key(.., vault_key,
  vault_key)`; mint + owner của trader ATA được check trong `load_from_iter` ⇒ không có chuyện
  rút nhầm vault/mint.
- **`deposit.rs` / `withdraw.rs`:** credit trước, `try_deposit` sau (atomic); `claim_funds` clamp
  theo free lots, locked lots không rút được; `evict_seat` bắt buộc trader index đã bị xoá.
- **`new_order.rs`:** `no_deposit_or_withdrawal` được verify bằng
  `verify_no_deposit()` + `verify_no_withdrawal()`; đơn giá trị 0 không kích hoạt CPI.
- **Quyền:** `Swap`, `RequestSeat`, `CollectFees`, `InitializeMarket` là permissionless; mọi
  instruction đổi trạng thái khác đều qua `assert_valid_authority` / seat approved. Không tìm
  thấy chỗ nào so sánh authority sai.
- **`Side::from_order_sequence_number`:** ask dùng `seq` (bit cao luôn 0 vì cap
  `u64::MAX>>1`), bid dùng `!seq` ⇒ không thể nhầm side, kể cả khi user tự đặt
  `order_sequence_number` trong `CancelMultipleOrdersById` (engine còn check `trader_index`).
- **sokoban RB tree:** `_insert/_remove_tree_node/_fix_remove/_transplant` đúng cấu trúc CLRS;
  `SENTINEL = 0` và mọi truy cập đều guard `if i != SENTINEL`. Không thấy đường corrupt cây từ
  input của user (cần chứng minh bằng fuzz — xem "việc tiếp theo").

---

## Việc tiếp theo (theo thứ tự hiệu quả)

1. **Chạy PoC L1** trên máy bạn (block ở trên) → nếu pass, gửi bounty với 4 dòng log.
2. **Fuzz sai lệch RB tree** (rẻ, chạy local, không cần validator — nếu cây bị corrupt thì
   `get_min()` trả sai maker ⇒ mất tiền):

```bash
set -e
export RUST_BACKTRACE=1
rm -rf /tmp/sokoban-fuzz
git clone https://github.com/Ellipsis-Labs/sokoban /tmp/sokoban-fuzz
cd /tmp/sokoban-fuzz
cargo new --lib fuzzrb && cd fuzzrb
cargo add --path .. lib-sokoban 2>/dev/null || true
cat >> Cargo.toml <<'EOF'
[dev-dependencies]
rand = "0.8"
EOF
cat > tests/diff.rs <<'EOF'
// mirror vs BTreeMap, ops random, assert is_valid_red_black_tree() + thứ tự iter()
EOF
cargo test --release -- --nocapture
```

3. **Invariant test trên program thật** (máy bạn, `ProgramTest`, không cần validator):
   sau mỗi chuỗi random instruction, assert
   `vault_balance >= Σ(trader.locked + trader.free) * lot_size + uncollected_fees`.
   Đây là test bắt được đúng lớp bug "vault thiếu tiền" mà đọc tay khó thấy.
4. Nếu muốn đi tiếp hướng khác: `phoenix-sdk`/`ellipsis-client` được bounty xét "case-by-case"
   — nhưng ngoài on-chain, ưu tiên thấp.

## Giới hạn của phiên này

Sandbox **không có** `cargo`/`rustc`/`solana-test-validator`/crates.io ⇒ mọi PoC Rust phải chạy
trên máy bạn. Ở đây tôi chỉ đọc mã + suy luận đường đi của tiền; không có log giả nào được tạo.
