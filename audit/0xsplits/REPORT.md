# 0xSplits — splits-contracts-monorepo: audit + fuzz

**Target:** `github.com/0xSplits/splits-contracts-monorepo` @ `0159376` (2026-10-21, HEAD)
**Scope read:** 100% of `src/` — 43/43 files, 4,647 lines (splits-v2 22, smart-vaults 18, smart-vault-modules 3);
repo total 97 `.sol` / 12,735 lines incl. tests + scripts
**Also read:** `audits/splits-v2.md`, `audits/smartVaults-{first,second}.pdf`, `SECURITY.md`, `CLAUDE.md`,
`packages/*/docs/*.md`, `deployments/*.json`, `remappings.txt`
**Filter:** (1) no privilege required, (2) money actually leaves someone's hands.

---

## 1. Kết luận

**Không tìm được lỗ drain nào cho người không có quyền** trong commit này. Các đường tiền đều đóng đúng.
Cái tìm được là **4 lỗi thật, mức Low/Info, đều đã tái hiện bằng log** (mục 3), cộng với 1 lỗ
**đã được team acknowledge** (H-01 của audit, vẫn còn sống — mục 4).

Lý do chính (chứng minh ở mục 2, có fuzz chạy được): mọi ERC6909 balance trong `SplitsWarehouse` đều bị
khoá theo `id = uint256(uint160(token))`.

- `_mint` chỉ xảy ra trong `deposit` / `batchDeposit`, và luôn kéo đúng `_amount` của **chính token đó**
  (`safeTransferFrom` hoặc `msg.value == _amount`).
- `_burn` chỉ xảy ra trong `_withdraw`, và luôn chuyển đúng `_amount` của **chính token đó** cho `_owner`
  (`amountToOwner` + `reward`, `reward = amount * incentive / 1e6` với `incentive ≤ 65535`).

⇒ Muốn tạo claim khống thì phải nạp token khống, mà claim khống chỉ tiêu được đúng loại token khống đó.
Không có đường trộn id ⇒ không hút được pool chung. Các đường còn lại (`batchTransfer`, `transferFrom`,
`temporaryApproveAndCall`, `approveBySig`) đều chỉ tác động lên ledger của `msg.sender` hoặc ledger mà
`msg.sender` được cấp quyền.

---

## 2. Bằng chứng chạy được (không cần fork, không cần RPC)

Harness: `audit/whitehat-framework/tools/local_chain/targets/splits-v2/`
— compile **đúng source thật** bằng solc-js rồi deploy bytecode thật lên EVM của hardhat.

```
cd audit/whitehat-framework/tools/local_chain
npm install
SPLITS_ROOT=/tmp/splits/packages/splits-v2 node targets/splits-v2/compile.js
npx hardhat test targets/splits-v2/test/splits.fuzz.test.js
npx hardhat test targets/splits-v2/test/edge.test.js
```

Log thật (240 vòng fuzz, attacker là EOA 0 token / 0 quyền):

```
warehouse.withdraw(victim, token)                       9 / 0     ok
warehouse.withdraw(victim, tokens, amounts, attacker)   4 / 6
pushSplit.distribute(split, token, attacker)           20 / 0     ok
pullSplit.distribute(split, token, attacker)           17 / 0     ok
pushSplit.withdrawFromWarehouse(token)                 17 / 0     ok
warehouse.transferFrom(victim, attacker, id, amt)       0 / 8     luôn revert (không allowance)
warehouse.batchTransfer([bob], token, 1e6)              0 / 11    luôn revert (không balance)
pushSplit.execCalls([...])                              0 / 17    luôn revert 0x82b42900 Unauthorized
pushSplit.updateSplit(...)                              0 / 14    luôn revert
pushSplit.setPaused(true) / transferOwnership(...)      0 /        luôn revert
attacker balance after 240 rounds: 0 tokens, 9999988177272050851979 wei
```

Invariant kiểm sau **mỗi** vòng: `attacker.token == 0`, `attacker.ledger == 0`, `attacker.eth` chỉ giảm,
`warehouse.balance ≥ Σ ledger`, tổng cung bảo toàn. Tất cả giữ nguyên.

Ngoài ra `smart-vaults`/`smart-vault-modules` đã đọc hết: `validateUserOp` chỉ gọi được từ EntryPoint v0.7,
`MultiSigner.isValidSignature` đòi đúng `threshold` chữ ký khác index (bitmask chống trùng), `initialize`
chỉ factory gọi được, `executeFromModule` chỉ module đã bật, `_authorize()` là `onlySelf`. Không thấy đường
ký giả / chiếm vault.

---

## 3. Bốn lỗi thật tìm được (Low/Info, có log)

### L-1. `validate()` nhận `totalAllocation == 0` ⇒ ví nhận tiền xong không bao giờ chia được

`SplitV2Lib.validate()` chỉ kiểm `allocations.length == recipients.length` và `Σallocations == totalAllocation`.
Không chặn `totalAllocation == 0`. Ví tạo ra vẫn `initialize` bình thường, vẫn nhận tiền, nhưng
`calculateAllocatedAmount` là `_amount * allocations[i] / totalAllocation` ⇒ **chia cho 0** ⇒ mọi
`distribute()` revert `panic 0x12`.

```
createSplitDeterministic(totalAllocation=0) accepted -> 0x951daC91E4Fc2e1a79aAC453EF586B12a6D34940
wallet funded with 1000000 tokens
distribute() -> panic code 0x12 (Division or modulo division by zero)
attacker execCalls() -> 0x82b42900 (Unauthorized)   <- không ai cứu được
```

Với split `owner == address(0)` (immutable) thì tiền kẹt vĩnh viễn. Severity thực tế: Low/Medium — cần
nạn nhân gửi tiền vào ví đó (ví đã công bố / QR / chia sẻ nhầm), không cần quyền gì để tạo.

### L-2. `SplitsWarehouse.withdraw(_owner,_token)` trừ 1 không kiểm tra ⇒ `panic 0x11` khi ledger = 0

```solidity
uint256 amount = balanceOf[_owner][_token.toUint256()] - 1;   // 0 -> underflow
```

Hệ quả: `PushSplit.distribute(split, token, amount, true, distributor)` — đúng flow được viết trong
`docs/integration-patterns.md` §2 — **luôn revert** với split chưa có balance trong warehouse (trạng thái
bình thường của push split), và bất kỳ ai cũng đẩy được ví vào trạng thái đó bằng 1 tx.

```
ledger=0 wallet=1000000
distribute(amount, performWarehouseTransfer=true)  -> panic code 0x11 (Arithmetic overflow)
distribute(amount, performWarehouseTransfer=false) -> ok
```

DoSs một entry point có tài liệu ⇒ Low (bounty loại DoS).

### L-3. Pause không đóng với `PushSplit.withdrawFromWarehouse()`

`distribute` có `pausable`, nhưng `withdrawFromWarehouse(address)` là `public` và **không** `pausable`,
trong khi bản Pull lại đặt `pausable` cho `depositToWarehouse`. Owner pause để đóng băng ⇒ người thứ ba
vẫn kéo được toàn bộ ledger của ví từ warehouse về ví.

```
split paused = true
attacker distribute() -> 0x9e87fac8 (Paused)          <- pause có tác dụng
attacker withdrawFromWarehouse() -> ok; ledger 1, wallet 1999999   <- vẫn di chuyển được
```

Không mất tiền (tiền vẫn nằm ở ví, chỉ owner rút ra được), nhưng sai ngữ nghĩa pause đã ghi trong
`docs/integration-patterns.md` §7 ("pausing only blocks third parties"). Info/Low.

### L-4. `tx.origin` dùng để bypass pause (2 chỗ)

`Pausable.pausable`: `msg.sender != owner && tx.origin != owner && msg.sender != this`.
`SplitsWarehouse.withdraw(owner,token)`: `msg.sender != _owner && tx.origin != _owner`.
Anti-pattern kinh điển (phishing: owner ký tx với dApp độc, dApp gọi hàm ⇒ bypass pause). Đã ghi trong docs
nên chỉ là Info.

---

## 4. Lỗ đã được acknowledge nhưng vẫn sống (không nộp lại được)

H-01 (audit `splits-v2.md`) — với **PullSplit**, nếu `withdrawConfig[wallet].incentive > 0`:

1. `warehouse.withdraw(wallet, [token], [ledger], attacker)` — permissionless, attacker ăn `incentive%`
2. `wallet.depositToWarehouse(token, số vừa nhận)` — permissionless, trả tiền về warehouse
3. lặp lại

```
acknowledged H-01 loop: attacker took 331011 of 1000000 tokens in 40 cycles   (incentive 1%)
```

Audit đã ghi rõ đây là "Acknowledged" (team sẽ cảnh báo trên docs/UI). Cần owner tự bật incentive ⇒ không
phải lỗ mới. Test: `test/edge.test.js::E4`, bản fork: `SplitsV2Fork.t.sol::test_fork_acknowledgedPullIncentiveDrain`.

---

## 5. Fork test (chạy trên máy anh, cần RPC)

File: `audit/0xsplits/fork/SplitsV2Fork.t.sol` → copy vào `packages/splits-v2/test/` rồi:

```
export ARB_RPC=https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M
export ETH_RPC=https://eth-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M
export BASE_RPC=https://base-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M
cd packages/splits-v2 && forge test --match-path test/SplitsV2Fork.t.sol -vv
```

3 test, chạy trên state mainnet thật, dùng địa chỉ thật trong `deployments/1.json`
(warehouse `0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8`, factory V2.2):

| test | nội dung |
| --- | --- |
| `test_fork_noFreeMoney` | attacker EOA 0 quyền thử mọi đường, phải không lấy được gì |
| `test_fork_zeroTotalAllocationLocksFunds` | L-1 trên factory thật: ví nhận 1 ETH và không bao giờ chia được |
| `test_fork_acknowledgedPullIncentiveDrain` | H-01 trên warehouse thật, in ra số tiền lấy được |

---

## 6. Những gì đã kiểm tra và loại trừ

| nghi vấn | kết quả |
| --- | --- |
| Mint khống ERC6909 rồi rút pool chung | không được — id gắn chặt với token, mint luôn kèm transfer cùng token |
| `batchDeposit` mint trước khi kéo tiền | không lợi dụng được — id riêng, reentrancy không đổi được token khác |
| `batchTransfer` ghi `balanceOf` trực tiếp | luôn trừ đúng `msg.sender` ở cuối loop, revert nếu thiếu |
| `temporaryApproveAndCall` / `approveBySig` | `_owner = msg.sender`, nonce bitmap XOR đúng, domain có chainId + address(this), restore allowance đúng |
| `transfer`/`transferFrom` operator path | `allowed - _amount` revert khi thiếu allowance |
| `execCalls` (owner == 0) | `caller != owner` ⇒ ai cũng revert; mảng rỗng thì no-op |
| `initialize` bị front-run | clone chỉ factory gọi được, salt chứa `_owner` |
| `createSplit` nonce + `createSplitDeterministic` | salt khác cấu trúc (hash vs abi.encode) ⇒ không đụng nhau |
| SmartVault: ký giả / threshold | `MultiSigner` bitmask + đủ `threshold` chữ ký, light hash bị chặn gas bằng `_verifyGasLimits` |
| SmartVault: chiếm vault qua `initialize`/`onlySelf` | factory-only, `_authorize()` là `onlySelf`, không có đường tự gọi |
| AutoEarn/AutoEarnEnroller | `deposit` chỉ chuyển tài sản của chính account vào vault đã fix, share về account; `enroll` chỉ bật module đã được treasury opt-in |
| `Clone`/CREATE2 prediction | chuẩn solady, không trùng salt |
| Reentrancy (native 2300 gas, `sendValue` all-gas) | state đã update trước khi call (CEI), không double-spend |

Fee-on-transfer / rebasing / USDT mainnet (V2.0–V2.1) đã nằm trong docs + audit ⇒ không tính.
