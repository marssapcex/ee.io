# FINDINGS — `registerBtcTransaction` budget starvation during a federation change

**Subject:** report #93347 (RootstockLabs / Immunefi), closed 2026-10-20.
**Code audited (from source, not from the report):**

| component | version | commit | how obtained |
|---|---|---|---|
| `rsksmart/powpeg-node` | `VETIVER-9.0.4.0` (release) / master | `f5c3823a4ee6ad1a04095ad66690616bce0e731e` | `git clone --depth 1` |
| `rsksmart/rskj` | `VETIVER-9.0.4` / master | `1e95a3b039b2f2e12837400533e88dc4aedeefb8` | `git clone --depth 1` |
| `org.bitcoinj:core` | `0.15.6-rsk-6` (`powpeg-node/build.gradle:207`) | — | upstream `bitcoinj/bitcoinj@v0.15.6` |

Line numbers below are from those commits. Every claim in this document is
traceable to a file and line in that tree.

---

## 0. Verdict

The **core mechanism of the report is real and still present in the current
`master` of both repositories.** A peg-in that the Bridge will reject
(`INVALID_AMOUNT`) is kept in the powpeg node's pending map forever, is re-sent
on every turn, and — because the map is a `ConcurrentHashMap` iterated in bin
order with a hard 40-send cap — 40 crafted entries whose wtxids share bin 0
consume the entire per-turn `registerBtcTransaction` budget.

Three things in the original report are **wrong**, and one of them is the reason
triage closed it:

1. **The turn arithmetic is 9× too large.** `TurnScheduler.getInterval()` is
   `participants * period` (`powpeg-node/.../timing/TurnScheduler.java:13-15`),
   so a given federator acts every 9 × 180 s = 27 min, not every 180 s. The
   network-wide total is 1,764 turns × 40 = **70,560 calls per window**, not
   635,040. (70,560 per federator is also wrong: it is 7,840 per federator.)
2. **The retiring federation's client does not take part in the flood** — it
   deletes the entry, because from *its* wallet the 2,000 sat output is below the
   minimum (`powpeg-node/PegUtils.java:131-142`). Only the **active**
   federation's client is poisoned. That does not weaken the attack (the active
   client is the one that registers real peg-ins), but the report's description
   is wrong.
3. **The impact is not "delaying block production".** Nothing delays block
   production. What stops is the *registration pipeline*: no peg-in, no
   peg-out/migration UTXO registration reaches the Bridge for the whole window.
   The report claimed a High impact ("temporary freezing of network transactions
   by … delaying block production") that its own evidence does not support, and
   that is what the triage note objected to ("block production is not delayed,
   only peg-in registration").

Point 3 is a framing error, not a technical one: the technical bug is a
liveness/freezing bug, and it should have been filed as *temporary freezing of
funds*.

---

## 1. The code path, step by step

### 1.1 Where the pending entry is created

`BtcToRskClientFileData` — `powpeg-node/src/main/java/co/rsk/federate/io/BtcToRskClientFileData.java:18`

```java
this.transactionsProofs = new ConcurrentHashMap<>();
```

`BtcToRskClient.onTransaction` — `BtcToRskClient.java:389`

```java
this.fileData.getTransactionProofs().put(tx.getWTxId(), new ArrayList<>());
```

Every transaction that pays a watched federation address ends up in that map,
**keyed by wtxid**, before it has any confirmations.

### 1.2 The per-turn send loop

`BtcToRskClient.updateBridgeBtcTransactions()` — `BtcToRskClient.java:555-680`,
abridged:

```java
Set<Sha256Hash> txsToSendToRskHashes = this.fileData.getTransactionProofs().keySet();   // :576
int numberOfTxsSent = 0;
Iterator<Sha256Hash> txHashIterator = txsToSendToRskHashes.iterator();                  // :580
while (txHashIterator.hasNext()) {
    Sha256Hash txHash = txHashIterator.next();                                          // :582
    ...
    if (!shouldSendTx(tx, federationWallet, proposedFederation, retiringFederation, activeFederation)) {
        removeTxHashFromFile(txHashIterator);                                           // :653
        continue;
    }
    sendTx(tx, txStoredBlock, pmt.get());
    numberOfTxsSent++;                                                                  // :663
    if (numberOfTxsSent >= MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN) { break; }           // :665-670
}
```

`MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN = 40` (`BtcToRskClient.java:53`).

Two properties matter:

* the iteration is over `ConcurrentHashMap.keySet()` in **bin order**, and
* the loop `break`s after 40 sends — it never resumes later in the same turn.

### 1.3 The node's own validity check uses ONE federation

`BtcToRskClient.java:555-565` builds the wallet from `federationToListen`
(this client's federation only):

```java
co.rsk.bitcoinj.wallet.Wallet federationWallet =
    BridgeUtils.getFederationNoSpendWallet(context, federationToListen, false, null);
```

`BtcToRskClient.java:759` → `powpeg-node/.../PegUtils.java:119-142`:

```java
public static boolean isValidPegInTx(BtcTransaction btcTx, Wallet federationWallet, ...) {
    boolean isAnyValueSentBelowMinimumPeginValue =
        !allUTXOsToFedAreAboveMinimumPeginValue(btcTx, federationWallet);
    ...
}

private static boolean allUTXOsToFedAreAboveMinimumPeginValue(BtcTransaction btcTx, Wallet fedWallet) {
    List<TransactionOutput> fedUtxos = btcTx.getWalletOutputs(fedWallet);   // only THIS federation
    if (fedUtxos.isEmpty()) return false;
    return fedUtxos.stream().allMatch(o -> o.getValue().compareTo(MINIMUM_PEGIN_TX_VALUE) >= 0);
}
```

`MINIMUM_PEGIN_TX_VALUE = 500_000` (`PegUtils.java:25`).

### 1.4 The Bridge's check uses ALL live federations

`BridgeSupport.registerPegIn` — `rskj/.../BridgeSupport.java:489-496`:

```java
Wallet fedWallet = getNoSpendWalletForLiveFederations(false);      // active + retiring (+ proposed)
PeginEvaluationResult peginEvaluationResult = PegUtils.evaluatePegin(
    btcTx, peginInformation, minimumPeginTxValue, fedWallet, activations);
```

`rskj/.../PegUtils.java:200-215`:

```java
if (!allUTXOsToFedAreAboveMinimumPeginValue(btcTx, fedWallet, minimumPeginTxValue, activations)) {
    return new PeginEvaluationResult(PeginProcessAction.NO_REFUND, INVALID_AMOUNT);   // :213
}
```

and `PegUtils.java:67-85` walks **every output that pays any live federation**.

`minimumPeginTxValue = 500_000` on mainnet (`BridgeMainNetConstants.java:32`).

**This is the mismatch.** A transaction with

```
500 000 sat -> active federation      (>= minimum, node says "valid")
  2 000 sat -> retiring federation    (<  minimum, Bridge says "invalid")
```

is *sent* by the active client and *rejected* by the Bridge.

### 1.5 Why the entry never leaves the map

`BridgeSupport.handleNonRefundablePegin` — `BridgeSupport.java:534-570`:

```java
if (shouldMarkRejectedPeginAsProcessed()) {
    // Between RSKIP459 and RSKIP551 rejected peg-ins should be marked as processed
    markTxAsProcessed(btcTx);
}

private boolean shouldMarkRejectedPeginAsProcessed() {              // :573-575
    return activations.isActive(ConsensusRule.RSKIP459) && !activations.isActive(ConsensusRule.RSKIP551);
}
```

Mainnet activation (`rskj-core/src/main/resources/reference.conf`):

```
:97   rskip459 = lovell700
:106  rskip551 = vetiver900
```

So on any VETIVER network **`shouldMarkRejectedPeginAsProcessed()` is false**:
the rejection is logged, an event is emitted, and the RSK transaction *succeeds*
— `BridgeSupport.registerBtcTransaction` swallows the only checked exception it
throws (`BridgeSupport.java:416-425`) and the `NO_REFUND` branch never throws, so
the federator's transaction is mined at full gas cost with no state change.
`isBtcTxHashAlreadyProcessed(txid)` stays false. On the next turn the entry
is still in the map, `shouldSendTx` still says "send", and the budget is
consumed again.

Before RSKIP551 (LOVELL) this bug could not exist: the tx was marked processed,
and powerspeg-node's `isBtcTxHashAlreadyProcessed` branch
(`BtcToRskClient.java:604-632`) removed it. **RSKIP551 re-opened it.**

### 1.6 Iteration order is attacker-controllable

`ConcurrentHashMap` iterates its table from bin 0 upwards. The bin is

```
index = (n - 1) & spread(key.hashCode())
spread(h) = (h ^ (h >>> 16)) & 0x7fffffff
```

and `org.bitcoinj.core.Sha256Hash.hashCode()` (bitcoinj `v0.15.6` /
`0.15.6-rsk-6`, `core/src/main/java/org/bitcoinj/core/Sha256Hash.java`):

```java
// Use the last 4 bytes, not the first 4 which are often zeros in Bitcoin.
return Ints.fromBytes(bytes[LENGTH - 4], bytes[LENGTH - 3], bytes[LENGTH - 2], bytes[LENGTH - 1]);
```

The wtxid is fully attacker-controlled (grind a dust output or a signature
nonce), so an attacker can cheaply produce wtxids with `spread(hashCode) & 0x3ff == 0`.
For any table up to 1024 entries those keys all land in **bin 0**, i.e. they are
the first entries the iterator visits. 40 of them exhaust the budget before the
iterator reaches bin 1.

The PoC reproduces this on a **live JVM** (`poc/chm_order.py`): the first 40
entries visited are the 40 attacker entries, even though they were inserted
*last*, and their real bin index (read out of the JVM's own table by reflection)
is 0. With 40 keys in one bin the JVM treeifies it (`ConcurrentHashMap$TreeBin`);
the bin is still visited first.

---

## 2. Verification table (claim by claim)

| # | claim in #93347 | evidence | verdict |
|---|---|---|---|
| 1 | pending map is a `ConcurrentHashMap` keyed by wtxid | `BtcToRskClientFileData.java:18`, `BtcToRskClient.java:389,259` | **confirmed** |
| 2 | 40 sends per turn, hard break | `BtcToRskClient.java:53,663-670` | **confirmed** |
| 3 | map iterated in bin order, `Sha256Hash.hashCode` = last 4 bytes | JVM `ConcurrentHashMap`; bitcoinj `v0.15.6` | **confirmed** (and demonstrated) |
| 4 | `shouldSendTx` validates against the listened federation only | `BtcToRskClient.java:559,733-760`; `PegUtils.java:119-142` | **confirmed** |
| 5 | Bridge validates against all live federations | `BridgeSupport.java:489-496`; `rskj PegUtils.java:67-85,200-215` | **confirmed** |
| 6 | rejected non-refundable peg-in is not marked processed post-RSKIP551 | `BridgeSupport.java:567-575`; `reference.conf:106` | **confirmed** |
| 7 | retiring federation live for 10 585 RSK blocks | `FederationMainNetConstants.java:55` | **confirmed** |
| 8 | 1 turn = 180 s | `BridgeMainNetConstants.java:24` | **confirmed for the network**; each *federator* acts every 1 620 s (`TurnScheduler.java:13-15`) |
| 9 | 360 rejected calls per turn, 70 560 per federator, 635 040 network-wide | — | **wrong**: 40 per 180 s network-wide, 7 840 per federator, 70 560 network-wide |
| 10 | the retiring federation client also floods | `PegUtils.java:131-142` with a single-fed wallet → `removeTxHashFromFile` | **wrong** (it deletes the entry; the active client is the one poisoned) |
| 11 | impact = delaying block production | no block-production path is touched | **wrong** (this is what triage rejected) |
| 12 | bond (0.2 BTC) comes back as RBTC when the retiring federation is cleared | `getLiveFederations()` drops the retiring fed (`FederationContext.java:32-36`) → `evaluatePegin` returns `REGISTER`; `executePegIn` transfers to `peginInformation.getRskDestinationAddress()` (`BridgeSupport.java:701-727`), which for a legacy peg-in is derived from the P2PKH sender key (`PeginInformation.java:92-97`) — the attacker's own RSK address | **confirmed** (asserted by `patches/rskj-PegUtilsEvaluatePeginTest.patch`, test 2) |
| 13 | attacker's sunk cost ≈ 0.00116 BTC | 40 × 2 000 sat dust + ~40 × 1 200 sat fees ≈ 0.0013 BTC | **confirmed** |
| 14 | "gas paid by nodes 11.43 RBTC" | `BridgeMethods.java:642 fixedCost(22000)` + 21 000 intrinsic = 43 000 gas/call; 70 560 calls = 3.03e9 gas; at the 0.06 gwei RBTC minimum ≈ **0.18 RBTC network-wide per window** (~0.02 per federator) | **wrong by ~63x** (the report multiplied 190.5e9 gas by 0.06 gwei as if it were 0.06 RBTC/gas) |

---

## 3. What is actually blocked during the window

The same `registerBtcTransaction` entry point handles every peg transaction type
(`BridgeSupport.registerBtcTransaction`, `:409-416`):

```java
case PEGIN            -> registerPegIn(btcTx, rskTxHash, height);
case PEGOUT_OR_MIGRATION -> registerNewUtxos(btcTx);
case SVP_FUND_TX      -> registerSvpFundTx(btcTx);
case SVP_SPEND_TX     -> registerSvpSpendTx(btcTx);
```

Since the pending map is shared and the budget is global per client, the flood
starves **all** of them, not only `PEGIN`. Note the asymmetry in what happens
afterwards: `registerNewUtxos` ends with `markTxAsProcessed(btcTx)`
(`BridgeSupport.java:861`), so peg-out/migration registrations are only
*delayed*; the `NO_REFUND` peg-in path does not mark anything, which is why the
attacker's own entries never leave the map.

1. **user peg-ins** — BTC confirmed, no RBTC credited, for up to ~3.7 days. This
   is the clean, demonstrable impact: a user's deposit disappears from the UI
   while their coins sit in the federation address.
2. **peg-out / migration UTXO registration** — `registerNewUtxos` never runs, so
   the Bridge's view of the federation's UTXO set stops being replenished.
3. **the funds-migration transaction of the very federation change the attacker
   is hiding behind** — `BtcToRskClient.shouldSendTx` treats it as sendable
   (`isMigrationTx`, `:753`) but never gets a budget slot, because it is not in
   bin 0. It stays pending until the window closes.

Point 3 is the one worth emphasising in a resubmission: the protocol gives the
retiring federation a bounded life (`fundsMigrationAgeSinceActivationEnd`), and
the migration registration is *supposed* to happen inside that life. Starving it
for the whole window pushes a state-critical registration to the very edge of
the retirement boundary. That part of the impact chain needs a regtest run to be
demonstrated (see `REPRODUCE_REAL_NODE.md`); it should not be asserted as fact
without it.

---

## 4. Severity

The damage is **liveness of the peg**, not block production:

* no RBTC is credited to peg-ins submitted during the window (temporary freezing
  of user funds, bounded by the window);
* peg-out UTXO accounting degrades for the same period;
* the funds-migration registration is delayed to the end of the window.

In the program's own impact table the matching High entry is **temporary freezing
of funds**, not "delaying block production". Under Primacy of Impact the impact
is what is rewarded, and the affected asset is `powpeg-node` (High on
powpeg-node/HSM pays a flat USD 5 000 per the program's reward table).

Aggravating: repeatable at every federation change; attacker cost ~0.0013 BTC
sunk plus a 0.2 BTC bond that returns; no operator action available to end it
(a federator cannot distinguish "rejected, unprocessed" from "sent, not yet
mined" without extra state — see §5).

Mitigating: requires the retiring federation to be live; nothing permanent is
lost; the system self-heals when the retiring federation expires.

Out-of-scope checks from the program page:

* "Attacks requiring thousands of transactions, peg-ins, or substantial capital
  expenditure" — 40 transactions, ~0.0013 BTC sunk. **Not** excluded.
* "DoS scenarios that are economically impractical … fees considerably higher
  than prevailing network averages" — attack txs pay ~4 sat/vB, ordinary.
  **Not** excluded.
* "Impacts requiring basic economic and governance attacks" — no.
* Prohibited activity "testing on mainnet" — the PoC is local only.

---

## 5. Fix

**Primary (`powpeg-node`), no consensus change:**

1. Build the validation wallet from the same federation set the Bridge uses
   (`active + retiring`, `getFederationsNoSpendWallet(...)`) and pass it to
   `isValidPegInTx`. A transaction the Bridge will reject is then dropped at the
   node instead of retried forever. This alone removes the trigger.
2. Do not let one entry monopolise the budget: keep a per-entry
   `consecutiveRejections` counter in `BtcToRskClientFileData`, stop counting a
   re-send against the 40-slot budget after the first attempt for the same turn,
   and quarantine an entry after N turns in which the Bridge still has not
   marked it processed (exponential backoff, persisted with the file data).
3. Consider iteration order hardening: the attack relies on the pending set
   being ordered by an attacker-controlled hash. A `LinkedHashMap` keyed on
   insertion order (with a bound) or an explicit FIFO queue removes the grinding
   vector entirely. This is defence in depth — (1) and (2) already break the
   attack.

**Defence in depth (`rskj`, needs network-wide decision — do not ship alone):**

Revisit `shouldMarkRejectedPeginAsProcessed()` so that a rejected *non-refundable*
peg-in whose rejection reason cannot change (e.g. `INVALID_AMOUNT` on a
confirmed transaction) is marked processed, as it was between RSKIP459 and
RSKIP551. That is a consensus change and needs to be coordinated; it is listed
here only because it is the root of the "retried forever" behaviour.

---

## 6. What was proven, and what was not

**Proven on real code, macOS arm64 (M4), JDK 17.0.20.1, 2026-10-20 run:**

| repo | command | result |
|---|---|---|
| powpeg-node `3dc1d165` (VETIVER-9.0.4.0) | `./gradlew test --tests 'co.rsk.federate.BtcToRskClientTest'` | **BUILD SUCCESSFUL** — all 3 added tests green, every pre-existing test in the class still green |
| rskj `1e95a3b03` | `./gradlew :rskj-core:test --tests 'co.rsk.peg.PegUtilsEvaluatePeginTest'` | **16/17 green**; `evaluatePegin_subMinimumOutputToAnotherLiveFederation_isRejectedWithInvalidAmount` **PASSED**. The 17th was a bug in the test itself (a bare Mockito mock returns `null` for `getSenderBtcAddressType()`, and `evaluateLegacyPegin()` switches on it → NPE); fixed in the patch by stubbing `P2PKH` |

So `BtcToRskClient.updateBridgeBtcTransactions()` sending a Bridge-rejected
peg-in, and the same entry being re-sent on the next turn, are no longer a
deduction: they were executed against the production classes.

Proven here, by execution (`poc/run_poc.sh`):

* the 40 transactions are real, valid, signed Bitcoin transactions paying
  500 000 sat to one federation script and 2 000 sat to another, independently
  re-verified with libsecp256k1;
* their wtxids really do all land in bin 0, and a real
  `java.util.concurrent.ConcurrentHashMap` in a real JVM yields them as the first
  40 entries of the iteration, ahead of honest entries inserted before them;
* the 40-slot budget is therefore exhausted by the attacker on every turn, for
  all 1 764 network-wide turns of the window;
* a negative control (same transactions, hashes not ground) shows the effect is
  caused by the grinding and not by the harness: 28 attacker / 12 honest.

Also provable with one command on a machine that can build the project:
`patches/` contains two `git diff` patches that add the assertions **to the
repositories themselves** —

* `rskj-PegUtilsEvaluatePeginTest.patch`: the crafted tx is `NO_REFUND /
  INVALID_AMOUNT` against the live-federation wallet, and `REGISTER` against the
  active-only wallet (the "bond comes back" half);
* `powpeg-node-BtcToRskClientTest.patch`: the active client sends the same tx,
  the retiring client drops it, and two consecutive turns call
  `sendRegisterBtcTransaction` twice for the same wtxid.

They were not compiled here (no JDK, no Maven Central); they follow helper
methods that already exist in those test trees, so the first `./gradlew test` is
the compile check.

Still not proven here (needs a running node):

* the end-to-end freeze of a real user peg-in and of the migration transaction
  (needs a real federation change; regtest lifetime is 150 blocks,
  `FederationRegTestConstants.java:42`);
* that the RSK transaction of a rejected registration is mined with status 0x1 —
  the source says so (`BridgeSupport.java:416-425`: the only checked exception is
  swallowed and the `NO_REFUND` branch does not throw), but it is a runtime fact.

The reason is environmental, and it is documented in `README.md` §"Boundary".
`REPRODUCE_REAL_NODE.md` contains the exact steps to close that gap on a machine
with Docker and a JDK, using the regtest procedure that ships with powpeg-node.
