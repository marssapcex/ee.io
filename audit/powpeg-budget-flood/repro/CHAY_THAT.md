# CHẠY THẬT — hướng dẫn từng bước (Mac M4)

Mục tiêu: chứng minh bug bằng **code production chạy thật**, không mô phỏng.
Bạn đã cài đủ tools, nên chỉ cần chạy. Toàn bộ mất ~2 phút (Gradle đã cache).

---

## 0. File nằm ở đâu

Sau khi clone, mọi thứ ở:

```
~/ee.io/ee.io/audit/powpeg-budget-flood/
├── repro/                          <-- script chạy
│   ├── 10_proof_unit.sh            <-- PROOF chạy test thật
│   ├── 30_collect_and_push.sh
│   ├── QUICKSTART.md
│   └── results/                    <-- kết quả sinh ra ở đây
├── patches/                        <-- 3 patch JUnit
│   ├── rskj-PegUtilsEvaluatePeginTest.patch
│   ├── rskj-BridgeSupportRejectedPeginTest.patch
│   └── powpeg-node-BtcToRskClientTest.patch
├── FINDINGS.md
├── REPORT.md
└── poc/                            <-- PoC JVM độc lập (không cần Java build)
```

Repo clone ra: `~/powpeg-proof/rskj` và `~/powpeg-proof/powpeg-node`.

---

## 1. Cách nhanh nhất: chạy tất cả (1 lệnh)

```bash
cd ~/ee.io/ee.io && git pull
cd audit/powpeg-budget-flood/repro
rm -rf results/unit          # xoá XML cũ, tránh báo lẫn kết quả lần trước
./10_proof_unit.sh
```

Đợi ~2 phút. Cuối cùng in ra:

```
================ RESULT ================
rskj         exit=0   log: .../results/unit/rskj-test.log
powpeg-node  exit=0   log: .../results/unit/powpeg-test.log
```

`exit=0` cả hai = tất cả xanh.

---

## 2. Cách chắc chắn nhất: chạy tay, thấy từng test (khuyên dùng)

Copy nguyên khối này:

```bash
# ---------- rskj ----------
cd ~/powpeg-proof/rskj
git checkout -- .
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/rskj-PegUtilsEvaluatePeginTest.patch
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/rskj-BridgeSupportRejectedPeginTest.patch
./gradlew --no-daemon :rskj-core:test \
  --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest' \
  --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest'

# ---------- powpeg-node ----------
cd ~/powpeg-proof/powpeg-node
git checkout -- .
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/powpeg-node-BtcToRskClientTest.patch
./gradlew --no-daemon test --tests 'co.rsk.federate.BtcToRskClientTest'
```

Muốn **thấy tên từng test PASSED** (Gradle mặc định không in), thêm:

```bash
./gradlew --no-daemon :rskj-core:test \
  --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest' -i \
  | grep -E "PASSED|FAILED|rejected reason"
```

Hoặc xem báo cáo HTML:

```bash
open ~/powpeg-proof/rskj/rskj-core/build/reports/tests/test/index.html
open ~/powpeg-proof/powpeg-node/build/reports/tests/test/index.html
```

---

## 3. Chứng minh cái gì, ở đâu

| # | Điều cần chứng minh | Test | File |
|---|---|---|---|
| 1 | Node **gửi** peg-in mà Bridge sẽ từ chối | `..._activeClient_shouldBeInformed` | `powpeg-node/.../BtcToRskClientTest.java` |
| 2 | Client retiring **xoá** nó (báo cáo cũ sai) | `..._retiringClient_shouldNotBeInformed` | nt |
| 3 | Nó **được gửi lại ở turn sau** | `..._isSentAgainOnNextTurn` | nt |
| 4 | Bridge từ chối `INVALID_AMOUNT` khi có 2 live fed | `..._isRejectedWithInvalidAmount` | `rskj/.../PegUtilsEvaluatePeginTest.java` |
| 5 | **Từ chối ⇒ KHÔNG mark processed** ← mắt xích quyết định | `..._shouldRejectAndStayUnprocessed` | `rskj/.../BridgeSupportRejectedPeginTest.java` |
| 6 | Cùng tx **được credit** khi retiring fed hết hạn | `..._isRegistered` | `rskj/.../PegUtilsEvaluatePeginTest.java` |

(5) là test mới thêm: nó chạy `bridgeSupport.registerBtcTransaction(...)` thật,
với storage thật, event logger thật, **active + retiring federation thật**, rồi
assert `provider.setHeightBtcTxhashAlreadyProcessed` **không bao giờ được gọi**
(dưới RSKIP551) và không UTXO nào được thêm. Đó chính là lý do node gửi lại mãi.

Xem code của test:

```bash
grep -n "shouldRejectAndStayUnprocessed" -A 75 \
  ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/rskj-BridgeSupportRejectedPeginTest.patch
```

---

## 4. Bằng chứng "hết budget 40 slot" (không cần node)

Phần này chạy trong **JVM thật** với `java.util.concurrent.ConcurrentHashMap` thật:

```bash
cd ~/ee.io/ee.io/audit/powpeg-budget-flood/poc
./run_poc.sh
```

Kỳ vọng:

```
--- C. attack: the same 40 txs, wtxids ground to bin 0 ---
  bin index of the first 44 entries in iteration order:
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,11,22,24]
  turn 1: 40 calls, attacker 40, honest 0
  all 1764 turns: attacker 70560, honest 0
--- B. control (không grind) ---
  turn 1: 40 calls, attacker 28, honest 12
```

Đối chứng B là thứ chứng minh kết quả đến từ kỹ thuật grind, không phải do script.

---

## 5. Chạy end-to-end trên regtest (tuỳ chọn, nặng)

Cần: bitcoind regtest + rskj regtest + powpeg-node + **một retiring federation**
(đang trong federation change). Trên regtest retiring fed sống 150 block.

```bash
# 1. bitcoind
mkdir -p ~/powpeg-proof/btc
bitcoind -regtest -datadir=$HOME/powpeg-proof/btc -rpcuser=rsk -rpcpassword=rsk \
         -rpcport=18332 -txindex -fallbackfee=0.0002 -daemon
bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 createwallet poc
bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 \
   generatetoaddress 101 $(bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk \
   -rpcport=18332 getnewaddress)

# 2. rskj regtest (terminal riêng)
cd ~/powpeg-proof/rskj && ./gradlew --no-daemon :rskj-core:run --args="--regtest"

# 3. powpeg-node (terminal riêng) — theo README của powpeg-node,
#    mục "Run bitcoind" -> "Run PowPeg node": tạo node.conf + chạy
#    java -cp build/libs/<jar> -Drsk.conf.file=<node.conf> \
#         co.rsk.federate.FederateRunner --regtest --reset

# 4. kiểm tra có retiring federation chưa
curl -s -X POST -H 'Content-Type: application/json' --data \
 '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000001000006","data":"0x47227286"},"latest"]}' \
 http://127.0.0.1:4444/
# 0x + 64 số 0 => chưa có => phải tạo federation change trước (xem repro/README.md mục 3.2)

# 5. đánh
cd ~/ee.io/ee.io/audit/powpeg-budget-flood/repro
./20_proof_regtest.sh
```

Bước 4 mà trả về toàn số 0 thì **không đánh được** — script sẽ exit 2 và nói rõ.
Đó là giới hạn thật, không phải script kém: cần federation change để có 2 live fed.

Bước tạo federation change bằng RPC (`createFederation` → `addFederatorPublicKeyMultikey`
→ `commitFederation`) tôi **chưa** script hoá vì nó phụ thuộc trạng thái stack
của bạn. Nếu bạn chạy tới bước 4 và gửi tôi output + `curl eth_blockNumber`,
tôi viết script vote chính xác cho đúng trạng thái đó.

---

## 6. Gửi kết quả lại

```bash
cd ~/ee.io/ee.io/audit/powpeg-budget-flood/repro
PUSH=1 ./30_collect_and_push.sh
```

Script đã sửa để **xoá XML cũ trước khi copy** (lần trước bạn thấy
`tests=17 failures=1` và `failures=0` cùng lúc là do XML cũ còn sót).

---

## 7. Nếu có lỗi

| Lỗi | Nghĩa | Sửa |
|---|---|---|
| `patch does not apply cleanly` rồi vẫn fail | cây làm việc bẩn | `cd ~/powpeg-proof/rskj && git checkout -- .` rồi chạy lại |
| `unexpected rejected reason: XXX` | tôi đoán sai reason | gửi tôi dòng đó, sửa 1 dòng trong patch |
| `Verification of Gradle distribution failed` | zip tải hỏng | `./fix_gradle.sh` |
| `Tests completed, 1 failed` nhưng không rõ test nào | xem XML | `grep -l failure results/unit/*/*.xml` |
