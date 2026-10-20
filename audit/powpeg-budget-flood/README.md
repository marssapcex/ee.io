# powpeg-node — `registerBtcTransaction` budget starvation

Audit + runnable PoC for RootstockLabs report **#93347** (closed 2026-10-20).

**Tóm tắt (VI).** Lỗi có thật và vẫn còn trong `master` hiện tại: một peg-in mà
Bridge sẽ từ chối (`INVALID_AMOUNT`) vẫn nằm trong pending map của powpeg-node
mãi mãi, được gửi lại mỗi turn, và 40 entry có wtxid được "grind" vào bin 0 của
`ConcurrentHashMap` chiếm trọn hạn mức 40 lệnh `registerBtcTransaction` mỗi turn.
Trong suốt cửa sổ đổi federation (~3.7 ngày mainnet), mọi peg-in thật bị hoãn →
**tạm thời đóng băng tiền của người dùng**, không phải "delay block production"
như báo cáo cũ (đây là lý do bị đóng). Báo cáo cũ còn sai hệ số 9 lần về số lệnh.
Repo này: audit đối chiếu từng dòng với source thật (có file:line), PoC chạy thật
(chữ ký ECDSA thật + JVM thật), và tài liệu để chạy full node thật trên máy bạn.

---

## 1. What is proven, and how

`poc/run_poc.sh` (≈6 s from scratch):

```
== [0/2] building transactions
attack  txs : 40  (bin0: 40/40)  avg attempts 860
control txs : 40  (bin0: 0/40)

== [1/2] verifying transactions + decisions
attack  40/40 valid, all in bin 0 of the pending map
control 40/40 valid, 0 in bin 0 (negative control)
sample  290 bytes, fee 1200 sat, 418 ECDSA attempts to grind

== [2/2] replaying the budget loop on a real JVM
--- A. baseline: honest pending map only ---
  turn 1: 25 calls, honest 25
--- B. control: 40 attack-shaped txs whose wtxids were not ground ---
  pending entries 65, ConcurrentHashMap table length 128
  turn 1: 40 calls, attacker 28, honest 12
--- C. attack: the same 40 txs, wtxids ground to bin 0 ---
  pending entries 65, ConcurrentHashMap table length 128
  bin index of the first 44 entries in iteration order:
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,11,22,24]
  turn 1: 40 calls, attacker 40, honest 0
  all 1764 turns: attacker 70560, honest 0
--- D. attack against a large honest backlog (245 entries) ---
  turn 1: 40 calls, attacker 40, honest 0
```

What is genuinely executed (not modelled):

| piece | how |
|---|---|
| the 40 transactions | real `secp256k1` ECDSA / `RFC-6979`, libsecp256k1 (`coincurve`), legacy `SIGHASH_ALL`, real serialisation, real txid = double-SHA256 |
| the wtxid grind | `Sha256Hash.hashCode()` = last 4 bytes (bitcoinj 0.15.6-rsk-6), `spread()`, `& 0x3ff` mask |
| the pending map | a live `java.util.concurrent.ConcurrentHashMap` in a real JVM (JPype), default constructor, keys whose `hashCode()` is bit-identical to the bitcoinj hash of the real wtxid |
| the 40-slot loop | mirrors `BtcToRskClient.java:576-671` (iterator, `numberOfTxsSent++`, hard `break`) |
| bin placement | read back out of the JVM's own `table` by reflection — the 40 attacker entries are physically in bin 0 |

The negative control (B) is what makes the experiment meaningful: identical
transactions whose hashes were *not* ground get a proportional share of the
budget (28/12); grinding them into bin 0 turns that into 40/0.

## 2. The bug in six lines

```
powpeg-node  shouldSendTx        validates against federationToListen   (ONE federation)
rskj Bridge  evaluatePegin       validates against getLiveFederations() (active + retiring)

tx: 500 000 sat -> active fed   (>= 500 000  => node: valid  => send)
      2 000 sat -> retiring fed (<  500 000  => Bridge: NO_REFUND / INVALID_AMOUNT)

RSKIP551 => the rejected peg-in is NOT marked processed
         => isBtcTxHashAlreadyProcessed() stays false
         => the entry stays in the map and is re-sent every turn, forever
```

Files and lines: `FINDINGS.md` §1.

## 3. Where the original report was wrong

| # | original claim | reality |
|---|---|---|
| turn arithmetic | 70 560 / federator, 635 040 network-wide | `TurnScheduler` interval is `participants × period`, so a federator acts every 27 min: **7 840 / federator, 70 560 network-wide** |
| who floods | "each of the 9 federators sends those 40 every turn" | correct per turn, but only the **active** client is poisoned; the retiring client *deletes* the entry |
| impact | High — "delaying block production" | no block production is delayed. The impact is **temporary freezing of peg-ins** for the window. This mismatch is why triage closed it |

These corrections make the report *weaker in numbers but stronger in validity* —
and they remove the one claim nobody can defend.

## 4. Boundary: what could not be run here

The sandbox allows only `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.

* rskj / powpeg-node release jars are GitHub **release assets** → redirect to
  `objects.githubusercontent.com` → blocked;
* Maven Central / Gradle distributions → blocked, so the sources cannot be
  compiled;
* `docker`, `bitcoind` → not installable.

So the two *decision* functions (≈30 lines in total) are transcribed from the
sources in `poc/verify_txs.py` §[2] and quoted with file:line, instead of being
executed — and then re-stated as **JUnit tests** in `patches/` so they run inside
the real builds on any machine with Maven Central. Everything else is executed. `REPRODUCE_REAL_NODE.md` gives the exact
commands to close that gap on a machine with JDK 17 + Maven Central, including
`fed_updateBridge` (a real JSON-RPC that forces a turn synchronously) and the two
JUnit assertions that pin the asymmetry inside the real build.

## 5. Files

```
README.md                  this file
FINDINGS.md                source-level audit, claim-by-claim, severity, fix
REPORT.md                  submission-ready bug report (rewritten)
REPRODUCE_REAL_NODE.md     how to reproduce on the real stack
patches/                   JUnit patches for both repos + how to run them
poc/gen_attack_txs.py      real signed txs + wtxid grinding
poc/verify_txs.py          independent verification + decision table
poc/chm_order.py           updateBridgeBtcTransactions() on a live JVM
poc/run_poc.sh             one command: build, verify, replay
poc/generated/                   generated certificates (txs, manifest, reports)
```

Two of the four claims no longer need a running node at all: `patches/` adds the
assertions to `powpeg-node`'s and `rskj`'s own test suites, so
`./gradlew test` runs them against the real classes (see `patches/README.md`).

## 6. Reproduce

```bash
cd audit/powpeg-budget-flood/poc && ./run_poc.sh
```

Requires only `python3` + network to PyPI (installs `coincurve`, `jpype1`,
`jdk4py`).
