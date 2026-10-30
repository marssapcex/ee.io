# Contract "Rapingswap" — giải phẫu bytecode + cách viết PoC kiểu này

Tài liệu này mổ contract decompile trong `Andean Medjedovic` / KyberSwap. Không kể lại vụ hack
(ai cũng biết). Mục tiêu: **(1)** chỉ ra từng hàm trong listing thực ra là gì, **(2)** chỉ ra chỗ
toán học bị lợi dụng, **(3)** rút ra phương pháp viết PoC — kể cả khi chỉ có fork mainnet qua RPC.

Mọi khẳng định đều có artifact chạy được trong thư mục này:
`tick_math.py` (đã verify), `boundary.py` (đã verify), `PoC.t.sol` (khung).

---

## 0. Thứ này không phải "hợp đồng tấn công" — nó là một file test Foundry

Ba dấu vết không thể nhầm:

| Trong listing | Nghĩa |
|---|---|
| `IS_TEST()` trả về `true`; `failed()` trả về `_failed` | interface `DSTest` của Foundry |
| `log_string`, `log_named_uint`, `log_address`, `log_named_int` | event của **ds-test** (`emit log_named_uint("amt", x)`) |
| `_failed` nằm ở `STORAGE[0x0] byte 1` | `StdAssertions` dùng đúng slot đó |

Nên: đây là `test/Exploit.t.sol` chạy `forge test` trên **fork mainnet**, không phải contract
triển khai. Cái làm nên "vụ hack" là 1 transaction; cái ta đang đọc là bản dựng lại của nó.

Cũng vì thế mà nó có `call(address,uint256,bytes)` — một hàm gọi tùy ý, chỉ chặn bằng
`msg.sender == _call || msg.sender == owner || msg.sender == this`. Trong test thì ai cũng là
`address(this)`, nên check đó gần như vô nghĩa. Đó là **code smell của PoC**, không phải lỗ hổng.

---

## 1. Bản đồ selector

| Selector | Hàm | Vai trò |
|---|---|---|
| `0x7b408b03` | `setup(pool, flashProvider, f0, f1, flashAmount, tickArg, divisor, mode)` | nạp cấu hình 1 pool rồi **chạy luôn** exploit |
| `0x38f39e5c` | `runAll(struct[9] pools)` | lặp, `this.call(0x7b408b03, ...)` cho từng pool |
| `0x161e` (private) | `run()` | **thân exploit** — 7 bước |
| `0x2e8e` | `startFlash()` | chọn nhà cung cấp flash loan theo `stor_9_0_0` (0/1/2/3) |
| `0x3379` | `sweep()` | chuyển sạch 2 token về EOA của attacker |
| `0x38c` | `logState()` | in giá / thanh khoản / balance |
| `0x1b11d0ff` | `executeOperation(...)` | callback **Aave** |
| `0x23e30c8b` | `onFlashLoan(...)` | callback **ERC-3156** (trả về magic `0x439148f0…`) |
| `0xf04f2707` | `receiveFlashLoan(...)` | callback **Balancer V2** |
| `0xe9cbafb0` | `uniswapV3FlashCallback(...)` | callback **Uniswap V3 flash** |
| `0xfa483e72` | `swapCallback(int256,int256,bytes)` | callback **swap** của pool (KyberSwap/UniV3) |
| `0x6dbf2fa0` | `call(to,value,data)` | gọi tùy ý (tiện ích của test) |

`stor_9_0_0` (mode) chọn 4 đường vay: Aave / Balancer / ERC-3156 / UniV3. Cùng một thân exploit,
4 kiểu mở màn — vì mỗi pool nằm trên chain khác nhau, nơi chỉ có một trong bốn cái là đủ thanh khoản.
(Đúng cái Bunni post-mortem gọi là "may mắn": pool không bị hack chỉ vì *không đủ* thanh khoản để vay.)

---

## 2. Ba thư viện Uniswap V3 được inline — và cách xác minh

Decompiler làm phẳng mọi `internal` function thành `0xNNNN`. Nhận dạng được chúng không phải
đoán mò, mà bằng hằng số:

### `0x4429` = `TickMath.getSqrtRatioAtTick`

- 20 multiplier `0xfffcb933bd6fad37aa2d162d1a594001 … 0x48a170391f7dc42444e8fa2`
- `require(v0 <= 0xd89e8)` → **887272** = `MAX_TICK`
- `uint256.max / v6` khi `tick > 0` (nghịch đảo)
- đuôi `(v6 >> 32) + (v6 % 2**32 != 0)` (làm tròn lên, dịch Q128→Q96)

**Xác minh** (`python3 tick_math.py`): dựng lại đúng 20 hằng số đó, feed `MIN_TICK` / `MAX_TICK`,
phải ra đúng **hai magic number xuất hiện ở chỗ khác trong cùng contract** —
`0x1000276a3` (dùng ở `0x5517(1, 0x1000276a3)`) và `0xfffd8963efd1fc6a506488495d951d5263988d26`
(dùng ở `0x57c9(0xfffd…, 1)`):

```
MIN_TICK  -> 4295128739                0x1000276a3                 matches: True
MAX_TICK  -> 1461446703485210103…0342  0xfffd8963efd1…8d26         matches: True
ratio(t+1)/ratio(t) = 1.000049998750   (sqrt(1.0001) = 1.000049998750)
```

Đây là kiểu xác minh đáng học: **không đọc tên hàm, hãy khiến nó tự khai**. Một hàm mà output
khớp một hằng số được dùng ở nơi khác trong cùng binary thì gần như chắc chắn là hàm đó.

### `0x47ac` = `FullMath.mulDiv` (512-bit)

Đặc trưng: tách tích 512-bit (`x*y` + phần `mulmod(x*y, uint256.max)`), rồi **nghịch đảo modulo
bằng Newton**: `v5 = (2 - v4*(2 - v4*(2 - v4*…)))` — chuỗi `x_{n+1} = x_n(2 - d·x_n)`. Kèm
`require(varg0 > v1, 'denom <= prod1')`.

### `0x475c` / `0x478f` = `getAmount0Delta` / `getAmount1Delta`

Cả hai dùng `uint96.max + 1` = **Q96 = 2^96** và `0x47ac`. Đây là cầu nối "khoảng giá ↔ số token",
tức là công cụ để trả lời: *muốn đẩy giá từ đây tới tick kia thì cần bao nhiêu token?*

### `0x54d0 / 0x5742 / 0x5696 / 0x555a / 0x5823`

`+ − × ÷ %` trên `int24`. Nhìn thì vô nghĩa, nhưng đọc kỹ thứ tự dùng sẽ thấy chúng tính
**`floor(tick / tickSpacing) * tickSpacing`**, có xử lý tick âm đúng (Solidity chia cắt về 0,
nên phải kiểm `% tickSpacing` để biết đã chia hết chưa):

```solidity
v21 = (tick >= 0);
if (tick < 0) v21 = !(tick % tickSpacing);   // chia hết?
```
Đây chính là `tickLower`/`tickUpper` — biên của dải mà attacker sẽ tự làm LP.

---

## 3. Bảy bước trong `0x161e` — đối chiếu cáo trạng

| # | Code | Việc làm | Cáo trạng |
|---|---|---|---|
| 0 | `approve(pool, max)` ×2 | cho pool rút token | — |
| 1 | `swap(this, flashAmount, dir, 2^tickArg, [])` + `require(2^tickArg == sqrtP, "First Swap Not Large Enough")` | **quét sạch thanh khoản** tới đúng giá `2^k`, nơi không LP nào gửi tiền | ¶42.b "flooding the pool… no liquidity provider had contributed liquidity at this artificial price" |
| 2 | đọc `tickDistance`, `swapFeeUnits`, `getPoolState`, `getLiquidityState` | lấy biên tick + L hiện tại | — |
| 3 | `0x4429` cho `tickLower/tickUpper` → `stor_d/stor_e` | giá tại 2 biên | ¶42.c |
| 4 | `0x475c`/`0x478f` → `v93`; `0x3cab(...)` vòng `while(1)` cộng `0x30d40` | **giải ngược ra L cần đúng bao nhiêu** cho vừa chạm biên | ¶42.c "wrote… that the liquidity should be exact" |
| 5 | `mint(...)` 120% rồi `0x419b` → `removeLiquidity(currentL - targetL)` | để lại **đúng một lượng nhỏ** ("glitch liquidity") | ¶42.c |
| 6 | tính `v131` = lượng vào **vừa đủ chạm biên**, gọi `swap(this, v131 - 1, …)` | **1 wei dưới ngưỡng** → nhánh "không cross tick" | ¶42.d.ii 1,056,056,735,638,220,7**99** vs …800 |
| 7 | đọc balance, `0x5859` (đảo dấu), `swap(..., -balance, …)` ngược lại | cross lại → `updateLiquidityAndCrossTick` **cộng** lượng chưa hề bị trừ ⇒ nhân đôi | ¶42.e "doubling move" |
| 8 | `0x3379()` sweep 2 token về EOA | rút tiền | ¶42.g |

Điểm cần nhớ: `swap` của KyberSwap nhận **`swapQty`**, và `v131` không phải số ngẫu nhiên — nó là
`calcReachAmount` viết lại bằng tay:

```
v131 = (200000·L·(sqrtTarget − sqrtP)·sqrtP) / (200000·sqrtTarget − feeUnits·sqrtP) / 2^96
```

rồi trừ 1. Toàn bộ "phép thuật" của bước 6 nằm ở ba ký tự `- 1`.

---

## 4. Chỗ toán học vỡ: biên an toàn bằng 0

Sau bước 6, AMM đã cam kết ở nhánh **"không cross tick"** (vì `amount < reach`). Nhưng giá nó
tính ra (`calcFinalPrice`) lại dùng `liquidity + deltaL`, trong đó `deltaL` là **ước lượng** phần
liquidity tái đầu tư sinh ra trong chính swap đó. BlockSec chỉ ra: comment trong code bảo phải
**làm tròn LÊN** `deltaL` để `nextSqrtP` **làm tròn XUỐNG**, nhưng code dùng `mulDivFloor`.

Với chiều giá tăng: `nextSqrtP = sqrtP + ⌈amount·2^96 / L⌉` — **nghịch biến theo L**.
`L` bị làm tròn xuống ⇒ `nextSqrtP` bị đẩy lên. Và vì đã chọn nhánh "không cross", hàm
`updateLiquidityAndCrossTick` **không chạy**.

Vậy cần bao nhiêu sai số để văng qua biên? `python3 boundary.py`, dùng đúng con số trong cáo trạng:

```
-- boundary one full tick away --
  price span to the boundary      : 3,961,309,095,461,524,743,049,232 Q96 units  (1.0000 ticks)
  implied liquidity               : 21,121,662,727,932,184,887,296
  headroom after swapping reach-1 : -447,033,328 Q96 units
  as a fraction of the span       : -1.128e-16
```

**~1e-16 tương đối — đúng một ULP của Q96.** Attacker không "tình cờ" rơi vào lỗi: anh ta đặt
đúng một wei dưới ngưỡng, nên *dấu* của phép làm tròn cuối cùng là thứ duy nhất quyết định.
Đó là lý do phải có bước 1 (hút cạn pool, để `baseL ≈ 0` và `reinvestL` chi phối) và bước 4
("liquidity should be exact"): không có hai bước đó thì sai số 1e-16 là vô hình.

Hệ quả trạng thái: giá nằm trong dải tick mới, nhưng `liquidity` vẫn là của dải cũ (~0). Lần swap
ngược cross biên → `updateLiquidityAndCrossTick` **cộng** lượng thanh khoản chưa từng bị trừ ⇒
thanh khoản ảo gấp đôi ⇒ rút được tiền của LP khác.

---

## 5. Bài học PoC (phần đáng copy nhất)

### 5.1 Cấu trúc

```
[1] fork ở block cố định         vm.createSelectFork(RPC, BLOCK)
[2] dựng vốn                     deal(token, attacker, X) hoặc flash loan
[3] tái lập trạng thái đích      swap đẩy giá / hút cạn L
[4] TÍNH TOÁN off-chain          python/solidity: ra đúng con số biên
[5] một câu lệnh quyết định      swap(reach - 1)
[6] assert                       balanceAfter - balanceBefore > 0
[7] log mọi bước                 emit log_named_uint(...)  ← thứ làm PoC đọc được
```

### 5.2 Ba nguyên tắc

**(a) PoC phải chứng minh *bất biến bị phá*, không phải "tôi kiếm được tiền".**
`assert(A.balance > trước)` chỉ nói kết quả. Câu mạnh hơn: *"sau swap, `nextSqrtP > sqrtP_upper`
nhưng `liquidity` không đổi"* — vì nó chỉ đúng khi bug tồn tại, và không thể đúng do may mắn.

**(b) Số phải *dẫn xuất*, không phải *chép*.**
Đừng hardcode `1056056735638220799`. Hãy tính nó trong test từ trạng thái pool; nếu công thức của
mày sai, test sẽ fail ngay ở dòng tính — đó là lúc mày học được. Cáo trạng cho một con số, đúng nó
là *kết quả* của phép tính, không phải input.

**(c) Một ULP cũng là một bug.**
Bước then chốt là chứng minh biên = 0. Nếu mày không đo được "còn bao nhiêu margin", mày chưa có PoC,
mày có một lần chạy may mắn.

### 5.3 Khung Foundry (xem `PoC.t.sol`)

```solidity
function test_tickCrossRounding() public {
    uint256 snap = vm.snapshot();
    // 1. đưa pool về trạng thái biên: giá chạm biên dải, L do attacker kiểm soát
    _drainToPrice(TARGET_SQRT_P);
    // 2. tính reach từ chính state, không hardcode
    uint256 reach = _calcReach(L, sqrtP, targetSqrtP, feeUnits);
    uint160 before = pool.sqrtP();
    uint128  liqBefore = pool.liquidity();
    // 3. một wei dưới ngưỡng
    pool.swap(address(this), int256(reach - 1), true, MAX_SQRT_RATIO - 1, "");
    uint160 after = pool.sqrtP();
    // 4. bất biến: giá đã qua biên thì liquidity PHẢI đổi
    assertGt(after, targetSqrtP, "did not cross");
    assertEq(pool.liquidity(), liqBefore, "BUG: crossed without updating liquidity");
}
```

### 5.4 Bản "không cần Solidity" (ethers + fork RPC)

Với bug thuần số học, 90% giá trị nằm ở việc **tính đúng con số**; on-chain chỉ để xác nhận.

```js
const fork = await provider.send("hardhat_reset", [{ forking: { jsonRpcUrl: RPC, blockNumber: B } }]);
const reach = calcReachAmount(L, sqrtP, target, feeUnits);      // BigInt, cẩn thận ceil
await pool.connect(attacker).swap(attacker, reach - 1n, true, MAX_SQRT_RATIO - 1n, "0x");
const after = await pool.getPoolState();
assert(after.sqrtP > target, "chưa cross");
assert(after.liquidity === liqBefore, "BUG");
```

Điều duy nhất không được làm: `console.log("exploited")` mà không có assert nào kiểm chứng
*bất biến* — đó là thứ khiến PoC bị từ chối.

---

## 6. Phụ lục: con người (không liên quan toán)

Nguồn: bản cáo trạng 24-CR-529, The Globe and Mail, CBC/Radio-Canada, Bloomberg Businessweek,
Wikipedia. Chỗ nào chỉ một nguồn nói thì ghi rõ.

**Xuất thân.** Sinh 11/2002, Hamilton, Ontario. Bố mẹ là **Ediz và Sanja Medjedovic**, người Bosnia
di cư sang Canada trong chiến tranh Bosnia — và theo hồ sơ toà án Ontario, **hai ông bà sửa máy tính
cho hàng xóm**. Em trai: **Denean**. Học Westmount Secondary School (trường theo kiểu tự định hướng),
**tốt nghiệp cấp 3 năm 14 tuổi** — trẻ nhất từng tốt nghiệp của Hamilton-Wentworth DSB, được báo địa
phương viết bài. Năm 2017, đội 4 người của Westmount thắng giải lập trình khu vực.

**Học.** Vào Waterloo ngay trước sinh nhật 15, ngành toán thuần. Cử nhân 3 năm, thạc sĩ 1 năm —
xong thạc sĩ ở tuổi 18–19 (các nguồn lệch nhau 18 vs 19). Trên CV nộp cho toà: **Putnam 39 điểm**
(nếu đúng thì Luật sư của Indexed gọi thẳng là "math genius"), có học bổng, suýt thắng giải Bernoulli.
Và đây là chi tiết đáng chú ý nhất với dân audit: **anh ta chơi Code4rena**, thắng thưởng ở 2 cuộc thi.

**Cái tôi.** Năm 2022 trả lời Bloomberg Businessweek, lập luận "Code is Law": anh ta chỉ tương tác
với contract công khai theo đúng luật nó lập trình ra, không "truy cập máy tính trái phép".
Tự gọi mình là "pirate", nói "may or may not be a criminal".

**Cách bị lộ.** Không phải do on-chain. Anh ta sửa **trang Wikipedia của một show truyền hình Canada**
mình từng xuất hiện, thêm mình vào mục "cựu sinh viên nổi tiếng" với mô tả *"notable mathematician"*.
Dấu vết đó nối tài khoản với người thật.

**Bố mẹ.** Toà ra lệnh khám nhà bố mẹ ở Hamilton; anh ta đã dọn đi, mang theo máy tính và điện thoại,
bố mẹ nói không biết ở đâu. Nhưng luật sư của Cicada dẫn hai tin nhắn thoại bố anh ta để lại:
một cái nói *"vừa liên lạc với con"*, cái kia **gợi ý con mình không ổn định**. Luật sư của bố mẹ
(Gowling WLG) từ chối bình luận. Luật sư Cicada viết: *"không thể tin nổi là bố mẹ không liên lạc
được với nó."*

**Thẩm phán.** Justice Myers, khi phát lệnh bắt vì khinh toà (anh ta không đến toà án Toronto
21/12/2021, chỉ xuất hiện một lần qua video với camera tắt):
> "I can assure Andean Medjedovic that litigation is not like a fine wine that improves with age."
> "It is no way for a 19 year old who already holds a master's degree in mathematics from a prestigious
> university program to commence his otherwise promising career."

**Trong cáo trạng** — phần "văn học" nhất:
- thư mục `arbitrage/KYBER_KILL/ARB_kyberArb`, hàm `templateexploitrape()`, file **"POOL HIT LIST"**.
- chọn giờ: *"attacking around 7:00AM-8:00AM my time means most americans are asleep and euros 100"*.
- kế hoạch hậu sự: *"KEEP the configs · Burn the evidence, including the hustle · Book flight · Pack Bags"*.
- file "Decisions and Mistakes": *"Going on the run / Yes / Chance of getting caught < Payoff for not
  getting caught / (NA) / Risk is typically underpriced in modern world"*.
- 10/2023, hai tháng trước KyberSwap: *"trying to make a breakthrough on the finite field version,
  so I can steal crypto lol."*
- Người đồng phạm (một người họ hàng) nhắn: *"ur money is all ready kind of dirty, which is epic for
  you because like you can't be hunted for twice yknow, but I'd like to still remain, you know
  emancipated to an extent. I'd like to be legit."*

**Sau đó.** Bị bắt tại Belgrade 09/08/2024, đặt phòng dưới tên **"Lorenzo"**. Giam 105 ngày. Toà
Belgrade từ chối dẫn độ Hà Lan (01/2025) với lý do bằng chứng chưa đủ và mức án nội địa quá nhẹ.
Tại toà anh ta nói: *"I would like to have children in Serbia and to achieve some more things here."*
→ mất hút, được cho là ở Bosnia. Trả lời The Globe qua Signal: *"My life is mostly fine, but a lot of
stuff with being sued/hunted is terrible"*, mô tả thời gian giam là *"hundreds of days locked in a cage"*
(kèm lời lẽ phân biệt chủng tộc về bạn tù — chi tiết này chính anh ta nói ra). Nguồn duy nhất
(Startup Fortune) nói có lobby xin **presidential pardon** — chưa kiểm chứng độc lập.

**Điều đáng để ý cho dân audit:** người viết ra PoC này từng là contestant Code4rena. Anh ta không
"hack" theo nghĩa phá hệ thống — anh ta *đọc code như một auditor*, tìm chỗ bất biến không được bảo vệ,
rồi viết test chứng minh. Khác biệt duy nhất giữa report và exploit là chỗ gửi đi.

---

## Chạy lại

```bash
python3 tick_math.py     # xác minh 0x4429 == getSqrtRatioAtTick
python3 boundary.py      # đo biên an toàn (~1 ULP)
forge test --match-test tickCross -vvv --fork-url $RPC
```
