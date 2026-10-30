# ee.io — Deposit Proxy: audit theo luật "không cần quyền + mất tiền"

**Ngày:** 2026-10-30 · **Phạm vi:** `contracts/DepositProxy.sol`, `contracts/DepositProxyFactory.sol`,
`server/depositProxy.ts`, `server/executionPlanner.ts` (+ `server/index.ts` chỗ lộ dữ liệu)
**Luật lọc:** chỉ báo bug mà (1) không cần quyền owner/admin/relayer, (2) điều kiện khai thác chặt
(không phải "nếu owner làm X"), (3) hậu quả là **tiền của user mất hoặc bị lấy**. Mọi thứ khác
(gas, thiếu test, style, DoS nhỏ, thông tin) **không** có mặt trong danh sách finding — kể cả khi
tôi tìm thấy.

**Bằng chứng:** `poc.js` chạy trên EVM cục bộ (ganache + solcjs, không cần RPC ngoài) → **15/15 PASS**.
Log trong `poc-results.json`. `compile-failure.txt` là output của solc trên file **không sửa gì**.

> Trước khi đọc: sandbox này **không có** `arena-bridge`. Tôi không có công cụ nào chạm được máy
> của bạn — chỉ `bash`/đọc/ghi file trong `/home/user`, và mạng chỉ ra được github/npm/pypi
> (`eth.llamarpc.com` trả `000`). Nên toàn bộ chứng minh dưới đây là EVM cục bộ, không phải fork
> mainnet. Không có đường nào để tôi "dùng máy bạn".

---

## Tóm tắt: đường tiền của contract này

Người dùng gửi tiền tới một địa chỉ CREATE2 **chưa có code**. Chỉ có đúng 3 hàm rời khỏi được
trạng thái đó: `initialize()`, `execute()`, và `receive()` (chỉ nhận vào). `execute` là cửa duy
nhất đẩy tiền ra, và nó bị chặn bởi `msg.sender == factory || isRelayer[msg.sender]` — owner
quyết định. **Không có hàm refund, sweep, rescue, hay deadline nào.** Đó là toàn bộ bề mặt.

Kết luận ngắn: **không có đường "cướp trắng" nào cho người lạ** — cổng `isRelayer` giữ. Nhưng có
**một đường lấy tiền thật không cần quyền** (F-05) và **bốn đường làm tiền user bốc hơi vĩnh viễn**
(F-01 → F-04), trong đó F-01 xảy ra với **100%** đơn hàng, không cần attacker.

---

## F-01 — CRITICAL: calldata trả output về `destination`, proxy lại đợi nhận ở chính nó ⇒ mọi đơn bị kẹt

`server/executionPlanner.ts:187` và `:263`:

```ts
// live KyberSwap
recipient: destination,
// preview (chế độ không có API key)
const dstReceiver = ethers.isAddress(destination) ? destination : ethers.ZeroAddress;
...
[dstReceiver, sendAmount, minOut, 0n, '0x']    // ← dstReceiver = ví user, KHÔNG phải proxy
```

Nhưng `DepositProxy.execute` (`contracts/DepositProxy.sol:160`) kiểm:

```solidity
uint256 outAfter = IERC20(toToken).balanceOf(address(this));
uint256 outDelta = outAfter - outBefore;
require(outDelta >= minOut, "slippage");
```

Nếu router đã trả thẳng cho `destination`, **số dư của proxy không tăng một wei** ⇒ `outDelta = 0`
⇒ `require` revert ⇒ cả transaction bị undo (router cũng bị undo) ⇒ **input nằm nguyên trong proxy,
`executed` vẫn `false`, không ai lấy ra được** (xem F-03: server bỏ luôn đơn).

Planner đang dùng chung một hàm cho hai luồng khác nhau:
- luồng *ví kết nối*: `takerAddress = ví user`, `recipient = destination` → **đúng**;
- luồng *deposit proxy*: `takerAddress = depositAddress`, `recipient = destination` → **sai**;
  `recipient` phải là `depositAddress` để proxy tự kiểm `minOut` rồi forward.

`executeDeposit()` truyền đúng `takerAddress: rec.depositAddress` nhưng planner không phân biệt.

**Chứng minh (T6):** router mock trả output cho `destination` đúng như calldata planner encode →
`execute` revert, `dest` không nhận được gì, `10.0 A` kẹt trong proxy, `executed = false`.

```
PASS  T6 execute reverts when calldata pays `destination` instead of the proxy
PASS  T6 user output was never received (swap undone by the revert)
PASS  T6 deposit stranded in the proxy  —  10.0 A stranded, executed=false
```

Điều kiện khai thác: **không có**. Đây là hành vi mặc định. Mọi đơn qua deposit proxy đều fail.

**Sửa:** thêm chế độ `payout: 'self' | 'destination'` vào `PlanRequest`. Với luồng proxy:
`recipient = takerAddress` (= proxy), để `execute` kiểm `minOut` và tự `_safeTransfer` cho
`destination` — đúng như contract đã viết.

---

## F-02 — CRITICAL: factory không compile

```
$ node compile.js        # solc 0.8.24, file y nguyên trong contracts/
DeclarationError: Undeclared identifier. "createProxy" is not (or not yet) visible at this point.
   --> DepositProxyFactory.sol:145:16
   --> DepositProxyFactory.sol:164:17
```

`createProxy` khai báo `external` (`:119`) nhưng `createProxyForOrder` (`:145`) và
`createAndExecute` (`:164`) gọi nó bằng tên trần — Solidity không cho gọi `external` nội bộ.
Full output: `compile-failure.txt`.

Hệ quả: file này **chưa từng được compile**, nên câu "138 tests + live `POST /api/deposit` on 8080"
trong `AUDIT.md` **không thể** bao gồm hai contract này — test suite đang test TypeScript, không
test bytecode. Và `createAndExecute` (đường atomic create+execute, đường an toàn nhất) là dead code
từ đầu.

**Sửa:** `createProxy` → `public` (đã dùng bản patch này để chạy PoC), hoặc `this.createProxy(...)`.

---

## F-03 — HIGH: không có refund. Server ghi "refunded" mà trên chain không có gì xảy ra

`server/depositProxy.ts:424`:

```ts
} catch (e) {
  console.error('[deposit] live execute failed', e);
  rec.status = 'refunded';       // ← chỉ đổi biến trong RAM
}
```

- Không có `refund()` / `sweep()` / deadline trong `DepositProxy.sol`. `_refundInput` chỉ chạy
  bên trong nhánh `!ok`, và **ngay sau đó là `revert`** ⇒ chính cái refund bị undo. Dead code.
- `executeDeposit` được gọi **đúng một lần** (`watchDeposit` `return` sau khi gọi; `markDepositFunded`
  cũng không retry). `advanceDeposit` coi `refunded` là trạng thái cuối.
- UI `src/components/DepositFlow.tsx:58`: *"Swap failed or slippage exceeded. Input refunded to
  depositor."* — **sai sự thật**.

Nên: một lần `execute` fail (giá chạy, router revert, hoặc chính F-01) ⇒ tiền nằm trong proxy
**vĩnh viễn**, user được báo là đã hoàn.

**Chứng minh (T2):** revert do slippage → input còn nguyên `10.0 A`, `executed = false`; relayer
gọi lại với tham số đúng thì **chạy được** — chứng minh rằng tiền không bị contract giữ, chỉ bị
server bỏ rơi.

```
PASS  T2 input untouched after the revert  —  balance=10.0 A
PASS  T2 executed flag still false (retry possible on-chain)
PASS  T2 relayer retry does work (loss is purely the server abandoning the order)  —  dest +5.0 B
```

**Sửa:** (a) retry có backoff trong `executeDeposit` trước khi bỏ; (b) thêm vào proxy
`function refund(address to) external { require(msg.sender==factory); ... }` với `to` **bắt buộc**
là `destination` (immutable) — không cho ai chọn đích, nếu không F-03 biến thành lỗ cướp tiền;
(c) hoặc `refundAfter(uint256 deadline)` cho phép **chính destination** tự rút sau hạn.

---

## F-04 — HIGH: salt không bind `amount`/`minOut`, id chỉ 6 chữ số ⇒ kẹt tiền vĩnh viễn

`server/depositProxy.ts:213` — `DP-${randomDigits(6)}` ⇒ **10^6** không gian, sinh đôi (birthday)
ở ~1.200 đơn. `saltFor` bind `(orderId, destination, fromToken, toToken)` — **không** bind `amount`,
`minOut`, `chainId`. Và `deposits` là `Map` keyed bằng `depositId` ⇒ đơn sau **ghi đè** đơn trước.

Va chạm (cùng `depositId` + cùng `destination` + cùng cặp token) ⇒ cùng salt ⇒ cùng proxy.
`proxyOf[salt] != 0` ⇒ `createProxy` revert `"exists"` (`DepositProxyFactory.sol:126`) ⇒ đơn thứ hai
không bao giờ được deploy. Tiền của nó đã nằm trong proxy **đã `executed`** ⇒ `execute` revert
`"already executed"` ⇒ **không ai cứu được, kể cả owner**, vì `executed` là immutable theo thiết kế.

**Chứng minh (T3):** nạp thêm `3.0 A` vào proxy đã execute → `execute` revert, `createProxy` revert,
tiền kẹt:

```
PASS  T3 second execute on an already-executed proxy reverts
PASS  T3 createProxy for that salt reverts (cannot redeploy)
PASS  T3 funds are unrecoverable by anyone  —  stuck=3.0 A
```

**Sửa:** `salt = keccak256(abi.encode(orderId, destination, fromToken, toToken, amount, minOut,
block.chainid))` (khớp cả hai phía JS/Solidity), và `depositId` dùng 16 byte random
(`crypto.randomUUID()` hoặc `randomBytes(16)`), không phải 6 chữ số.

---

## F-05 — MEDIUM (đây là lỗ cướp tiền thật, không cần quyền): chiếm slot `depositor` bằng 1 wei

`contracts/DepositProxy.sol:84`:

```solidity
receive() external payable {
    if (depositor == address(0) && msg.value > 0) depositor = msg.sender;   // ← ai cũng ghi được
    ...
}
```

Với đơn **ERC20**, server **không bao giờ** set `depositor`: `onERC20Funded` là dead code
(`grep` toàn repo: không chỗ nào gọi `factory.onERC20Funded`). Nên slot trống. Kẻ tấn công chỉ cần
gửi **1 wei** ETH vào proxy **giữa lúc `createProxy` và `execute`** (hai tx riêng, `executeDeposit`
gửi tuần tự, nên có nguyên một block — và tx `createProxy` lộ địa chỉ proxy trên mempool; ngoài ra
`GET /api/deposits` liệt kê **mọi** deposit kèm `depositAddress` và `destinationAddress`).

Sau đó, phần **dust** của input (user gửi nhiều hơn số calldata swap — rất thường, ví dụ quote 8
nhưng user gửi 10) được hoàn về `depositor`:

```solidity
uint256 dust = IERC20(fromToken).balanceOf(address(this));
if (dust > 0) _safeTransfer(fromToken, refundTo, dust);   // refundTo = depositor = attacker
```

**Chứng minh (T4):** user nạp `10 A`, attacker gửi `1 wei`, calldata swap `8 A` ⇒ attacker nhận
`2.0 A` — tiền thật của user, chi phí tấn công 1 wei + gas.

```
PASS  T4 attacker becomes depositor with 1 wei  —  attacker got 2.0 A of the user's overpayment
```

**Sửa:** bỏ hẳn logic `depositor` trong `receive()`; set `depositor` **trong `initialize`** từ tham
số do factory truyền (đã có sẵn `_depositor` trong `onFunded`), hoặc hoàn dust về `destination`
(immutable, không ai chọn được) thay vì `depositor`.

---

## F-06 — MEDIUM: token fee-on-transfer (và mọi khoản nạp thiếu) không bao giờ được execute

`server/depositProxy.ts:270-285`: watcher so `bal >= BigInt(rec.sendAmount)` — **số tuyệt đối**.
Với token trừ phí khi transfer, proxy nhận `< sendAmount` ⇒ watcher không bao giờ chuyển sang
`funded` ⇒ không execute ⇒ hết 30 phút ⇒ `expired`, không refund (F-03). Tiền kẹt.

**Chứng minh (T5):** token 10% fee, user gửi `100` → proxy có `90`; watcher chờ `100`:

```
PASS  T5 fee-on-transfer deposit arrives short of `sendAmount`  —  watcher expects 100, sees 90.0 -> never executes
```

**Sửa:** đo delta số dư quanh lần nạp (hoặc dùng `balanceOf` tại thời điểm phát hiện + ngưỡng
`>= 99%`), và với token FoT thì tính `minOut` theo số **thực nhận**, không theo `sendAmount`.
Nếu không hỗ trợ FoT: chặn ở `createDeposit` bằng danh sách token.

---

## Những gì tôi đã cố phá và **không** phá được (để bạn không phải thử lại)

| Đường | Kết quả | Vì sao |
|---|---|---|
| Người lạ gọi `execute` | revert `"not relayer"` (T1) | `msg.sender == factory \|\| isRelayer[msg.sender]` |
| Front-run `initialize` để `factory = attacker` rồi tự `execute` | **không** (T1) | `create2` + `initialize` nằm trong **cùng một tx** của factory, không có external call chen giữa |
| Gọi `onFunded` để ghi đè `depositor` | revert `"only factory"` (T1) | chỉ factory, factory lại chỉ relayer |
| Front-run `createProxy` với `destination` của attacker | **không** | `createProxy` là `onlyRelayerOrOwner`; salt cũng bind `destination` |
| Dùng `salt` khác trong `execute` để đánh lừa kế toán | **không hại** | `salt` chỉ để emit event, không tham gia logic |
| Lợi dụng allowance còn dư sau `execute` | **không** | proxy one-shot, không còn hàm nào gọi ra ngoài |

**Nhưng** cổng đó mong manh ở đúng một chỗ: `initialize` (`DepositProxy.sol:76`) *"we trust the
caller is factory"* và chấp nhận `_factory` do **người gọi** truyền vào, chỉ so `msg.sender ==
_factory`. Nó an toàn **duy nhất** vì `createProxy` deploy và init trong một tx. Thêm bất kỳ đường
"deploy trước, init sau" (try/catch, hàm deploy-only, hay chuyển sang `CloneDeterministic` +
init riêng) là **bất kỳ ai** cũng set được `factory = mình` → `isRelayer` của mình → rút sạch mọi
proxy. Đây là bẫy refactor, không phải bug hiện tại — nhưng là chỗ duy nhất biến "không cướp được"
thành "cướp được".

Ngoài ra, về mặt *tin cậy*: `setLogic` (owner) đổi được implementation cho mọi proxy **tương lai**,
và `setRouterAllowed` thêm được router tùy ý ⇒ owner có toàn quyền rút tiền các đơn chưa deploy
(dựng logic độc). Không nằm trong luật "không cần quyền" của bạn, nên không tính điểm — nhưng nói
thì phải nói: **đây không phải hệ thống trustless**, nó là "trustless sau khi đơn đã deploy".

---

## Thứ tự sửa

1. **F-01** (recipient = proxy) — không sửa thì mọi đơn đều kẹt, các lỗi khác vô nghĩa.
2. **F-02** (`external` → `public`) — không sửa thì không deploy được gì.
3. **F-03** (retry + refund về `destination`) — biến "mất trắng" thành "chậm".
4. **F-05** (bỏ `depositor` khỏi `receive`) — lỗ cướp tiền duy nhất.
5. **F-04**, **F-06**.

---

## Chạy lại

```bash
mkdir -p /tmp/lab && cd /tmp/lab && npm init -y && npm i solc@0.8.24 ganache ethers@6
cp -r <repo>/contracts . && cp <repo>/audit/ee-io-deposit-v3/mocks/Mocks.sol contracts/
cp <repo>/audit/ee-io-deposit-v3/{compile.js,poc.js} .

# F-02 phải patch trước khi chạy được: createProxy external -> public
sed -i 's/^    ) external whenNotPaused onlyRelayerOrOwner returns (address proxy) {/    ) public whenNotPaused onlyRelayerOrOwner returns (address proxy) {/' contracts/DepositProxyFactory.sol

node compile.js && node poc.js      # → 15/15 PASS
```

Muốn thấy F-02: chạy `node compile.js` trên file **gốc, chưa patch** → `DeclarationError` (đúng
nội dung `compile-failure.txt`).

Ghi chú: `compile-failure.txt` chụp trên file **gốc, không sửa**; PoC chạy trên bản đã patch đúng
một chữ (`external`→`public`) ở `createProxy`, không đụng gì khác.
