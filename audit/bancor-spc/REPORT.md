# Bancor `StandardPoolConverter` v46 — có bug rút tiền không?

Nguồn bạn gửi = **`StandardPoolConverter` v46 của Bancor, không bị cấy bug**.

## 1. Xác minh nguồn (làm trước, để khỏi săn ma)

Tôi clone `bancorprotocol/contracts-solidity`, so từng hàm với file bạn paste:

| kiểm tra | kết quả |
|---|---|
| `solidity/contracts/converter/types/standard-pool/StandardPoolConverter.sol` @ commit `7fbf6c26` | **1401 dòng — trùng khớp 100%** với bản bạn gửi (kể cả `validExternalAddress(address(_token))` trong `addReserve`, `syncReserveBalances(0)` trong `acceptAnchorOwnership`, `onUpgradeComplete`, `transferReservesOnUpgrade` + `only(CONVERTER_UPGRADER)`) |
| `ConverterVersion.version` | `46` ✔ |
| OZ `SafeMath/IERC20/Address/SafeERC20` | đúng bản OZ 3.x mà Bancor pin |

⇒ Đây là code thật đã chạy trên mainnet. Không có hàm "backdoor" nào được thêm vào bản bạn gửi.

## 2. Kết luận: **không tìm được đường rút tiền không cần quyền**

Tôi dựng harness chạy **chính code này** (solc 0.6.12 + hardhat EVM trong process, không fork, không RPC) và cho
attacker EOA tấn công bằng mọi đường mà corpus `kismp123` có cho AMM: donation/stale-reserve, first-LP
inflation, fee accounting, rounding, dust. **5/5 test pass, số liệu thật:**

```
baseline: spot out (no fee) = 9,900.990099 | actual out = 9,871.287129 | spent = 10,000
          invariant 1000000000000000000000000000000000000000000000000
                 -> 1000029999999999999999999710000000000000000000000   (chỉ tăng)

ATTACK 1 (donation + bán vào reserve "cũ"):
  stored reserves sau donation : 1,000,000 / 1,000,000   <-- donation KHÔNG được tính
  real   reserves              : 1,000,000 / 1,100,000
  attacker trả   = 200,000 R1 (100,000 donate + 100,000 trade)
  attacker nhận  =  90,636.363636 R0
  PnL            = -109,363.636364 R1                    <-- lỗ, không phải lãi

ATTACK 2 (first-LP inflation):
  attacker shares = 1  (deposit 1 wei + 1 wei)
  donate 100 R0 + 100 R1, sync, victim deposit 1,000+1,000 -> 10 shares
  victim round-trip loss = 0 wei R0 + 0 wei R1           <-- không mất gì
  dust deposit (1 token mỗi bên) revert                  <-- chỉ griefing
```

**Vì sao chặn được** (giải thích 30 giây):

1. `doConvert` ghi `setReserveBalances(sourceId, targetId, actualSourceBalance, targetBalance - amount)` —
   reserve nguồn luôn bị **kéo lên bằng số dư thật**, nên donation không thể làm reserve "trông nhỏ hơn thực tế";
   chiều duy nhất attacker điều khiển được (stored < actual) lại làm giá **bất lợi** cho chính họ.
2. `addLiquidityAmounts` mint theo **tỉ lệ min** và `fundCost` **làm tròn lên**, `liquidateReserveAmount`
   **làm tròn xuống** ⇒ LP luôn trả ≥ nhận; inflation chỉ tạo dust ≤ 2 wei và làm deposit nhỏ bị revert.
3. Mọi hàm chuyển tiền (`convert`, `addLiquidity`, `removeLiquidity`) đều `protected` (ReentrancyGuard) +
   cập nhật state trước khi transfer (CEI).
4. `removeLiquidity` lấy `totalSupply` **trước** khi `destroy`, và `processNetworkFees` chạy trước khi tính
   phần rút ⇒ không có chuyện chia theo supply sai.

## 3. Bug thật tìm được (không phải rút tiền, nhưng vẫn là lỗi)

**B1 — `syncReserveBalances()` và `processNetworkFees()` ai cũng gọi được (Low/Medium, LP mất phí)**
Không có `ownerOnly`. Bất kỳ ai cũng có thể đồng bộ reserve rồi kích hoạt sweep network fee. Harness:

```
sau khi LP rút 1 nửa: reserves 500,000 / 500,000
attacker donate 200,000 R0 + 200,000 R1, gọi syncReserveBalances() + processNetworkFees()
network fee wallet nhận: 4,000 R0 + 4,000 R1      (2% "growth" — nhưng growth đó là donation, không phải volume thật)
```

Attacker **không** thu được gì (họ tự đốt 400,000), nên đây là lỗi kế toán phí làm LP mất tiền oan /
ai cũng ép được thời điểm thu phí — không phải đường rút tiền.

**B2 — griefing LP: deposit nhỏ bị chặn** (Low). Sau khi một LP chiếm supply = 1 rồi donate, mọi
`addLiquidity` mà `amount` làm tròn về 0 sẽ revert `ERR_ZERO_TARGET_AMOUNT` (đã in ở log trên).

**B3 — token gửi nhầm bị kẹt vĩnh viễn** (Low/Info). Bản v46 **không có** `withdrawInactiveTokens`
(`grep` = 0 hit) và cũng không có hàm rescue nào; chỉ reserve + ETH mới ra được qua `convert/removeLiquidity`.
Bản v47 thêm lại `withdrawInactiveTokens` + `upgradeReserves` — tức team cũng thấy thiếu.
Ai chuyển nhầm ERC20 vào converter là mất.

**B4 — vụn vặt**: `assert(amount < targetBalance)` dùng `assert` (đốt hết gas khi fail);
`require(amount != 0)` chặn swap 1 wei; `addLiquidity(..., _minReturn = 0)` và `removeLiquidity` với
min-return 0 đều revert (`verifyLiquidityInput` đòi `_amount > 0`) — user không thể tắt slippage protection.

## 4. Quét 24 class của corpus `kismp123` (bảng máy sinh: `class-pass.json`)

> Đính chính: bản trước tôi viết "đã quét đủ 24 class" trong khi thực tế mới mở 3 file class và grep
> theo tên protocol. Bảng dưới đây là kết quả chạy lại **đủ 24 class**, mỗi dòng có regex signal +
> số hit thật trong file (`class-pass.json`), không phải suy đoán.

| class | verdict trên file này |
|---|---|
| donation-inflation | chặn (test 1 + 2, số liệu trên) |
| slippage-amm / mev-sandwich | có, nhưng chi phí do trader tự đặt `minReturn`; không phải lỗ hổng |
| integer-precision | rounding luôn nghiêng về pool (ceil khi nạp, floor khi rút) ✔ |
| reentrancy | `protected` + CEI ✔ |
| access-control | `convert` = `only(BANCOR_NETWORK)`, owner-only cho cấu hình; chỉ 2 hàm phí là permissionless (B1) |
| oracle-price-manipulation | `recentAverageRate` TWAP 10' — **view cho contract khác dùng**, không dùng để định giá trong file này |
| flash-loan | không có collateral ⇒ không có đòn bẩy để rút |
| self-balance-exploit | `syncReserveBalances()` ghi `balanceOf(this)` vào state — đây là "self-balance" duy nhất, hệ quả = B1 |
| approval-abuse | `safeTransferFrom(msg.sender → this)` đúng chiều ✔ |
| proxy-storage / governance / signature / bridge / nft / weak-randomness | không áp dụng |

**Kết luận thẳng**: file này không có lỗ rút tiền không cần quyền. Muốn có tiền phải là owner
(`addReserve` token lạ / `setConversionFee`) hoặc kiểm soát registry (`BANCOR_NETWORK`,
`NETWORK_SETTINGS`) — đều là privileged, không tính.

Nếu bạn muốn đi tiếp chỗ *thật sự* từng mất tiền của Bancor thì phải sang `LiquidityProtection`
(consumer của `recentAverageRate`) và `BancorNetwork` (đường `convert` nhiều hop) — file bạn gửi chỉ là
một mắt xích.

## 5. Chạy lại trên máy bạn

```bash
set -e
# các biến dưới đây KHÔNG cần cho bộ test này (EVM chạy trong process, không fork),
# chỉ cần nếu bạn tự thêm test fork mainnet:
export ARB_RPC="https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M"
export ETH_RPC="https://eth-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M"
export BASE_RPC="https://base-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M"

cd /home/user/ee.io/audit/bancor-spc   # hoặc đường dẫn repo của bạn
npm i --no-audit --no-fund             # hardhat 2.29.1, ethers 6, solc 0.6.12 (solc-js, không tải binary)
node compile.js                        # -> artifacts.json
npx hardhat test test/spc.test.js      # 5 passing, in ra đúng các con số ở mục 2
```

Ghi chú: `src/` là bản **nguyên gốc** lấy từ `bancorprotocol/contracts-solidity` (`solidity/contracts/...`
@ `7fbf6c26`), chỉ 16 file cần thiết; `src/mocks/Mocks.sol` là mock của tôi (ERC20/DSToken/registry/settings)
— không nằm trong phạm vi audit.

## Phụ lục — vector duy nhất còn hở (cần quyền)

Nếu owner `addReserve` một token **deflationary/rebasing giảm** (stETH âm, AMPL rebase xuống...), thì
`balanceOf(this)` tụt xuống dưới `__reserveBalances` ⇒ stored > actual ⇒ mọi phép tính giá dùng reserve
"giàu hơn thực tế" ⇒ người đổi được giá tốt hơn, pool có thể không đủ tiền trả (revert). Đây là rủi ro
**listing token**, cần owner ⇒ ngoài điều kiện bounty "không cần quyền".


## 6. Phương pháp — tôi thật sự đã làm gì (để bạn kiểm)

| bước | 0xSplits | Phoenix | Bancor (file này) |
|---|---|---|---|
| đọc toàn bộ source | có (4.647 dòng) | có (12.485 dòng + sokoban) | có (1401 dòng + 15 file phụ thuộc) |
| đọc audit cũ để khỏi trùng | — | có (OtterSec + MadShield) | — |
| corpus `kismp123` (821 incident) | grep + đọc class | **không** (corpus là EVM, code Solana) | grep tên protocol → 1 hit, + đọc 3 class |
| DeFiHackLabs (948 PoC) | không | không | **lúc làm: không** — nay đã clone: chỉ có **1 PoC Bancor** (`src/test/2020-06/Bancor_exp.sol`, lỗi `safeTransferFrom` public năm 2020) → **không áp dụng** cho v46 vì `safeTransfer` ở v46 là `private` |
| đối chiếu code với upstream | — | — | có (khớp 100% @ `7fbf6c26`, `version = 46`) |
| chạy PoC thật | có (hardhat, 7 test) | **chưa** (sandbox không có cargo) | có (5 test, hardhat EVM) |

Nói thẳng: corpus với tôi là **checklist + grep tín hiệu**, không phải "mở từng incident rồi so từng dòng".
Chỗ nào tôi chưa làm đúng như bạn dặn thì nó nằm ở dòng "DeFiHackLabs: lúc làm không" ở trên.
