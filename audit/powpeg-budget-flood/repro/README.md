# Chạy PoC thật trên máy bạn / Running the PoC for real

> **Nói thẳng trước (VI).** Bug **không phải bịa**: nó nằm ở đúng những dòng source
> được chỉ ra trong `../FINDINGS.md`. Nhưng trong sandbox audit tôi **không chạy
> được full stack Java** (chỉ ra được github/codeload/api.github/npm/pypi; JAR
> release redirect sang `objects.githubusercontent.com` bị chặn, Maven Central bị
> chặn). Vì vậy bằng chứng tôi đưa ra trước đây là: chữ ký ECDSA thật + JVM thật
> + đọc source từng dòng — **không phải** "node thật đã chạy". Ba script dưới đây
> để bạn lấy phần còn thiếu đó trên máy mình, rồi đẩy kết quả lại.

---

## 1. Cài tools (~5 phút)

```bash
cd audit/powpeg-budget-flood/repro
./00_install_tools.sh
# script in ra 2 dòng export; chạy chúng:
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```

Cài: git, curl, jq, **JDK 17** (bắt buộc — `powpeg-node/build.gradle:179`,
`rskj` cùng pin 17), python 3.10+, **Bitcoin Core**. Docker không cần thiết.

## 2. PROOF 1 — chạy code thật của powpeg-node và rskj (5–10 phút)

```bash
./10_proof_unit.sh
```

Script clone `rskj@1e95a3b` và `powpeg-node@VETIVER-9.0.4.0`, áp 2 patch trong
`../patches/`, rồi chạy **đúng 2 test class** đó bằng Gradle. Đây là code
production chạy thật, không phải mô phỏng:

| test | khẳng định |
|---|---|
| `rskj evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount` | cùng 1 tx, ví = **tất cả** live federation ⇒ `NO_REFUND / INVALID_AMOUNT` |
| `rskj evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered` | cùng tx đó, ví chỉ active ⇒ **`REGISTER`** ⇒ bond quay về |
| `powpeg-node ..._activeClient_shouldBeInformed` | `BtcToRskClient.updateBridgeBtcTransactions()` **gửi** tx mà Bridge sẽ từ chối |
| `powpeg-node ..._retiringClient_shouldNotBeInformed` | client retiring **xoá** entry ⇒ chỉ client active bị nhiễm |
| `powpeg-node ..._isSentAgainOnNextTurn` | 2 turn ⇒ `sendRegisterBtcTransaction` gọi **2 lần** cùng wtxid |

Kết quả vào `results/unit/` (log + JUnit XML). Đây là thứ trả lời trực tiếp câu
"PoC never runs the actual powpeg-node or Bridge".

## 3. PROOF 2 — chạy trên regtest thật (nâng cao)

### 3.1 Dựng stack

```bash
# bitcoind
mkdir -p ~/powpeg-proof/btc
bitcoind -regtest -datadir=$HOME/powpeg-proof/btc -rpcuser=rsk -rpcpassword=rsk \
         -rpcport=18332 -txindex -fallbackfee=0.0002 -daemon
bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 createwallet poc
bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 generatetoaddress 101 \
         $(bitcoin-cli -regtest -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 getnewaddress)

# rskj regtest (sau khi 10_proof_unit.sh đã build)
cd ~/powpeg-proof/rskj && ./gradlew --no-daemon :rskj-core:run --args="--regtest"
# hoặc: java -cp rskj-core/build/libs/<jar> co.rsk.Start --regtest

# powpeg-node (federator) theo README của chính repo powpeg-node, mục
# "Run bitcoind" -> "Run PowPeg node" (node.conf + --regtest --reset)
```

### 3.2 Điều kiện bắt buộc: phải có **retiring federation**

Đây là phần khó và là lý do tôi không thể automation mù được. Kịch bản chỉ kích
hoạt được khi có **2 federation cùng live**: node validate với federation nó
watch, Bridge validate với `getLiveFederations()` = active + retiring
(`rskj FederationContext.java:32-36`).

Kiểm tra:

```bash
curl -s -X POST -H 'Content-Type: application/json' --data \
 '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000001000006","data":"0x47227286"},"latest"]}' \
 http://127.0.0.1:4444/
# 0x... rỗng => chưa có retiring federation => phải tạo federation change trước
```

Tạo federation change trên regtest (Bridge methods có trong `rskj/Bridge.java:930-995`):
`createFederation()` → `addFederatorPublicKeyMultikey(btc,rsk,mst)` × N →
`commitFederation(hash)` → chờ tới `federationActivationAge`, rồi
`updateCollections`/`receiveHeaders` để chuyển active. Trên regtest retiring
federation sống **150 block** (`FederationRegTestConstants.java:42`).

Cách nhanh nhất và đáng tin nhất: dùng harness `rit` (Rootstock Integration
Tests) của chính project, nó có sẵn flow federation change. Nếu bạn muốn, gửi
log/output của bước này, tôi sẽ viết script vote chính xác theo dữ liệu thật.

### 3.3 Chạy đòn tấn công

```bash
./20_proof_regtest.sh        # tự chạy self-test trước, rồi mới đánh
```

`regtest_attack.py` làm những việc sau, tất cả bằng RPC thật:

1. `getblockchaininfo` — chắc chắn là regtest;
2. `eth_call getFederationAddress()` / `getRetiringFederationAddress()` — tự tìm 2 federation;
3. fund key của attacker bằng `sendtoaddress`, fan-out thành `count+1` nhánh;
4. build `count` tx `500000 sat → active | 2000 sat → retiring`, **grind wtxid vào bin 0**;
5. thêm 1 peg-in "honest" 500 000 sat chỉ trả active federation;
6. broadcast + mine đủ `btc2RskMinimumAcceptableConfirmations` (regtest = 3);
7. gọi `fed_updateBridge` **2 lần** (JSON-RPC có thật trong
   `Web3FederateImpl.java:101`, ép một turn ngay lập tức);
8. đọc trên chain bằng `eth_call isBtcTxHashAlreadyProcessed(bytes32)` cho từng tx
   và cho tx honest; đếm dòng `[sendTx]` trong log node.

Bằng chứng mong đợi (và là điều cần chứng minh):

* `attack txs marked processed: 0/40 (turn 1) 0/40 (turn 2)` — Bridge từ chối, RSKIP551 không mark processed;
* `honest peg-in processed: False False` — **bị bỏ đói**, đây là "frozen user peg-in";
* log node: 40 dòng `[sendTx]`, và **không** có tx honest ⇒ budget bị chiếm hết.

Script **không** báo thành công giả: nếu thiếu retiring federation nó exit code 2
với hướng dẫn; nếu bitcoind/rskj không chạy nó nói rõ.

## 4. Đẩy kết quả lại

```bash
./30_collect_and_push.sh            # xem trước
PUSH=1 ./30_collect_and_push.sh     # commit + push lên branch hiện tại
```

`results/` chỉ chứa log + XML + JSON (nhỏ), `.gitignore` đã loại `results/` khỏi
commit mặc định — `30_...` sẽ `git add -f` phần cần thiết. Nếu bạn muốn tôi đọc
kết quả, cứ push; tôi sẽ đối chiếu với `FINDINGS.md` và cập nhật `REPORT.md`.

---

## English summary

| script | proves | needs |
|---|---|---|
| `00_install_tools.sh` | installs JDK 17, python, bitcoind | macOS/Linux + brew/apt |
| `10_proof_unit.sh` | **real** `BtcToRskClient` + **real** `PegUtils.evaluatePegin` behaviour (send vs reject, retried every turn, credited after the window) | Maven Central |
| `20_proof_regtest.sh` + `regtest_attack.py` | a live regtest chain: Bridge rejects, tx never marked processed, honest peg-in starved, 40 `[sendTx]` per turn | bitcoind + rskj + powpeg-node + a **retiring federation** |
| `30_collect_and_push.sh` | bundles logs/JUnit XML and pushes them back | — |

What the earlier PoC already proved, and the scripts do not replace: the 40
transactions are real signed Bitcoin transactions whose wtxids all land in bin 0
of a real `java.util.concurrent.ConcurrentHashMap`, and the production loop then
sends 40 attacker entries and 0 honest ones for all 1 764 turns
(`../poc/run_poc.sh`).
