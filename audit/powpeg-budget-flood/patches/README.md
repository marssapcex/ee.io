# JUnit patches — the same claim, asserted inside the real builds

Everything in `poc/` re-implements two decision functions (~30 lines) because the
JARs could not be fetched in the audit sandbox. These two patches remove that
gap: they add the assertions **to the repositories themselves**, so
`./gradlew test` runs them against the real classes.

Both patches were generated with `git diff` against the exact commits audited
(`powpeg-node f5c3823`, `rskj 1e95a3b`) and are based on helper methods that
already exist in those test trees — they were **not compiled here** (no JDK, no
Maven Central in the sandbox), so treat the first `./gradlew test` as the compile
check.

---

## 1. `powpeg-node-BtcToRskClientTest.patch`

Adds three tests to the existing `UpdateBridgeBtcTransactions` nested class in
`src/test/java/co/rsk/federate/BtcToRskClientTest.java`.

| test | asserts |
|---|---|
| `..._activeClient_shouldBeInformed` | a peg-in with **500 000 sat → active fed** and **a sub-minimum amount → retiring fed** is **sent** by the active client. This is the node half of the asymmetry. |
| `..._retiringClient_shouldNotBeInformed` | the same transaction is **dropped** by the retiring client (its only output to that federation is below the minimum). Confirms that only the active client is poisoned — a correction to the original report. |
| `..._isSentAgainOnNextTurn` | calling `updateBridgeBtcTransactions()` twice calls `sendRegisterBtcTransaction` **twice** for the same wtxid: the entry is never removed, so it keeps consuming a budget slot. |

Uses only existing helpers: `TestUtils.createP2shP2wshErpFederation`,
`setUpActiveFedClient`, `setUpRetiringFedClient`, `createTxFromP2pkh`,
`addOutputToFedWithMinimumPeginValue`, `addOutputToFedBelowMinimumPeginValue`,
`setUpTx`, `assertTxSentToBridgeByActiveFedClient`, `assertTxNotSentToBridge`,
`getPMT` (all present in that file today).

## 2. `rskj-PegUtilsEvaluatePeginTest.patch`

Adds two tests to `rskj-core/src/test/java/co/rsk/peg/PegUtilsEvaluatePeginTest.java`
(the class that already tests `PegUtils.evaluatePegin` with `BridgeBtcWallet`).

| test | asserts |
|---|---|
| `..._isRejectedWithInvalidAmount` | with the wallet built from **both** live federations, the same transaction yields `PeginProcessAction.NO_REFUND` + `RejectedPeginReason.INVALID_AMOUNT`. This is the Bridge half. |
| `..._sameTxOnceRetiringFederationIsCleared_isRegistered` | with the wallet built from the **active federation only** (i.e. after the retiring federation is cleared by age), the *same* transaction yields `REGISTER`. This is the "the bond comes back" claim, now an assertion rather than a deduction. |

---

## How to run

```bash
# 1. rskj
git clone https://github.com/rsksmart/rskj && cd rskj
git checkout 1e95a3b            # the commit audited here
git apply /path/to/rskj-PegUtilsEvaluatePeginTest.patch
./gradlew :rskj-core:test --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest'

# 2. powpeg-node (needs rskj-core:9.0.4-VETIVER from Maven Central,
#    so use the release tag rather than master)
git clone https://github.com/rsksmart/powpeg-node && cd powpeg-node
git checkout VETIVER-9.0.4.0
git apply /path/to/powpeg-node-BtcToRskClientTest.patch
./configure.sh && ./gradlew test --tests 'co.rsk.federate.BtcToRskClientTest'
```

Reading the result:

* both `..._isRejectedWithInvalidAmount` (rskj) and `..._activeClient_shouldBeInformed`
  (powpeg-node) passing = **the asymmetry is real, executed inside the real code**;
* `..._isSentAgainOnNextTurn` passing = **the entry is retried every turn**;
* `..._sameTxOnceRetiringFederationIsCleared_isRegistered` passing = **the peg-in is
  credited once the window closes**.

Those four green tests, plus a `fed_updateBridge` log line showing the same wtxid
sent twice (`REPRODUCE_REAL_NODE.md`), are the end-to-end evidence the triage
note asked for.
