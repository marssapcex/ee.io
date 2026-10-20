# QUICKSTART — Mac Apple Silicon (M4)

Copy-paste. Không cần Rosetta, không cần Docker.

> **Quan trọng:** các ghi chú cũ (Rosetta + Zulu x86 + `--platform linux/amd64`)
> chỉ đúng khi chạy **Docker image x86**. Ở đây ta **build từ source bằng JDK 17
> arm64**, nên M4 chạy native, nhanh hơn nhiều. Đừng cài Rosetta.

---

## 0. Clone

```bash
git clone https://github.com/marssapcex/ee.io.git
cd ee.io
git checkout arena/ca007fdb-ee-io
cd audit/powpeg-budget-flood/repro
```

## 1. Cài công cụ (một lệnh, ~5 phút)

```bash
chmod +x *.sh
./00_install_tools.sh
```

Script tự cài, chỉ khi thiếu:

| thứ | cách | ghi chú |
|---|---|---|
| Homebrew | bạn cài sẵn | https://brew.sh |
| git, curl, jq | `brew install` | thường có sẵn |
| **OpenJDK 17** | `brew install openjdk@17` | **bắt buộc 17** — `powpeg-node/build.gradle:179`, rskj cùng pin |
| Python **3.10–3.13** | script tự tìm, thiếu thì `brew install python@3.12` | ⚠️ **3.14 chưa dùng được**: `coincurve` chưa có wheel cp314 |
| Bitcoin Core | `brew install bitcoin` | chỉ cần cho PROOF 2 |

Cuối script nó ghi ra `repro/env.sh`:

```
wrote /Users/<you>/ee.io/audit/powpeg-budget-flood/repro/env.sh
```

Các script sau **tự source** file này — bạn không phải export gì. Nếu muốn tự
làm trong terminal hiện tại:

```bash
source env.sh
java -version      # phải ra openjdk 17.x
```

## 2. PROOF 1 — chạy code thật (10–20 phút, lần đầu tải Gradle + deps)

```bash
./10_proof_unit.sh
```

Nó làm: clone `rskj@1e95a3b` + `powpeg-node@VETIVER-9.0.4.0` vào `~/powpeg-proof/`,
áp 2 patch trong `../patches/`, chạy 2 test class bằng Gradle, copy log + JUnit
XML vào `repro/results/unit/`.

**6 test phải xanh (2 file rskj + 1 file powpeg-node):**

```
rskj         evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount
rskj         evaluatePegin_sameTxOnceRetiringFederationIsCleared_isRegistered
rskj         registerBtcTransaction_whenPeginIsValidForActiveFedButBelowMinimumForRetiringFed_shouldRejectAndStayUnprocessed
powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_activeClient_shouldBeInformed
powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_retiringClient_shouldNotBeInformed
powpeg-node  updateBridgeBtcTransactions_peginWithSubMinimumOutputToRetiringFed_isSentAgainOnNextTurn
```

Đây là **code production chạy thật**: `BtcToRskClient.updateBridgeBtcTransactions()`
và `PegUtils.evaluatePegin()`. Không phải mô phỏng.

Kiểm tra kết quả:

```bash
grep -h "evaluatePegin_\|peginWithSubMinimum" results/unit/*.log | tail -20
ls results/unit/*junit-xml
```

## 3. PROOF 2 — regtest thật (tuỳ chọn, cần dựng stack)

Chỉ chạy được khi có **retiring federation** (đang trong federation change).
Xem `README.md` mục 3.1–3.2 để dựng bitcoind + rskj + powpeg-node và tạo
federation change.

```bash
# kiểm tra trước: đã có retiring federation chưa?
curl -s -X POST -H 'Content-Type: application/json' --data \
 '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000001000006","data":"0x47227286"},"latest"]}' \
 http://127.0.0.1:4444/
# trả 0x + 64 số 0  => chưa có => script sẽ exit 2 và bảo bạn tạo trước
# trả 0x + địa chỉ   => có, chạy được

./20_proof_regtest.sh
```

Không có stack thì bỏ qua bước này — PROOF 1 đã đủ để trả lời triage.

## 4. Đẩy kết quả lên

```bash
./30_collect_and_push.sh            # xem trước summary
PUSH=1 ./30_collect_and_push.sh     # commit + push lên branch hiện tại
```

## 5. Đưa lên `main`

Tôi **không được phép** push vào `main` (session này chỉ làm trên
`arena/ca007fdb-ee-io`). Bạn chạy:

```bash
cd ~/ee.io
gh pr create --base main --head arena/ca007fdb-ee-io \
  --title "audit(powpeg-node): registerBtcTransaction budget starvation + real-node proof" \
  --body "Source-verified findings, JUnit patches, and the repro scripts with real run results."
gh pr merge --merge          # hoặc --squash
```

Hoặc mở PR bằng web: https://github.com/marssapcex/ee.io/compare/main...arena/ca007fdb-ee-io

Nếu bạn muốn tôi mở/merge PR hộ, nói một câu — tôi có `gh` trong session.

---

## Troubleshooting trên M4

| triệu chứng | nguyên nhân | cách sửa |
|---|---|---|
| `java -version` ra 21/24 | jenv / SDKMAN / brew mặc định | `source env.sh` rồi `java -version` phải là 17; hoặc `export JAVA_HOME=$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home` |
| `error: invalid source release: 17` | đang dùng JDK 8/11 | như trên |
| `Could not find or load main class org.gradle.wrapper.GradleWrapperMain` | **cả rskj và powpeg-node** đều không kèm `gradle/wrapper/gradle-wrapper.jar` | script đã tự chạy `./configure.sh` cho **cả hai** repo (bản cũ chỉ làm cho powpeg-node). Chạy tay: `cd ~/powpeg-proof/rskj && ./configure.sh` |
| `Verification of Gradle distribution failed!` | file `gradle-8.6-bin.zip` tải về bị hỏng (CDN/proxy) | `./fix_gradle.sh` — tự xoá cache sai hash, tải lại, verify `9631d53c…`, giải nén. `10_proof_unit.sh` cũng tự làm bước này |
| `pip install coincurve` lỗi khi build | Python 3.14 | `brew install python@3.12` rồi `PY=$(brew --prefix python@3.12)/bin/python3.12 ./20_proof_regtest.sh` |
| Gradle tải rất lâu lần đầu | tải deps từ Maven Central | bình thường, 5–15 phút. `./gradlew --no-daemon` đã set sẵn |
| `Failed to apply patch` | bạn đã áp rồi | `cd ~/powpeg-proof/powpeg-node && git checkout -- .` rồi chạy lại |
| `bitcoind not reachable` | chưa bật bitcoind | `bitcoind -regtest -datadir=... -daemon` (README 3.1) |
| `getRetiringFederationAddress` revert | chưa có federation change | đúng như thiết kế — script exit 2, xem README 3.2 |
| Apple Silicon + Docker x86 | chỉ khi dùng image x86 | không cần cho flow này |

## Nếu chỉ muốn xem bằng chứng đã có sẵn (không cài gì)

```bash
cd audit/powpeg-budget-flood/poc && ./run_poc.sh
```

Cần python3 + mạng tới PyPI (~6 giây). Cái này chạy được ngay cả trong sandbox:
40 tx ký thật, grind vào bin 0, và **JVM thật** với
`ConcurrentHashMap` thật → 40 attacker / 0 honest suốt 1 764 turn; đối chứng
không grind 28/12.

---

## Kết quả thật đã chạy (M4, 20/10/2026)

```
rskj  PegUtilsEvaluatePeginTest      17 tests, failures=0   (sau khi fix NPE)
rskj  BridgeSupportRejectedPeginTest ... shouldRejectAndStayUnprocessed   PASSED
powpeg BtcToRskClientTest            320 tests, failures=0
      ..._activeClient_shouldBeInformed          PASSED
      ..._retiringClient_shouldNotBeInformed     PASSED
      ..._isSentAgainOnNextTurn                  PASSED
```

Nếu `./30_collect_and_push.sh` báo `failures=1` kèm `tests=17 failures=1` **và**
`tests=17 failures=0` cùng lúc: đó là XML cũ còn sót. Bản mới đã xoá XML cũ
trước khi copy (`find results -name 'TEST-*.xml' -delete`). Muốn chắc:
`rm -rf results/unit && ./10_proof_unit.sh`.

## Chỉ chạy lại đúng 1 test (nhanh nhất)

```bash
cd ~/powpeg-proof/rskj
git checkout -- .
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/rskj-PegUtilsEvaluatePeginTest.patch
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/rskj-BridgeSupportRejectedPeginTest.patch
./gradlew --no-daemon :rskj-core:test \
  --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest' \
  --tests 'co.rsk.peg.BridgeSupportRejectedPeginTest'
```

```bash
cd ~/powpeg-proof/powpeg-node
git checkout -- .
git apply ~/ee.io/ee.io/audit/powpeg-budget-flood/patches/powpeg-node-BtcToRskClientTest.patch
./gradlew --no-daemon test --tests 'co.rsk.federate.BtcToRskClientTest'
```
