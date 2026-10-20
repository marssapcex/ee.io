# powpeg-node: a Bridge-rejected peg-in is retried forever and starves every other `registerBtcTransaction` for the whole federation-change window

**Program:** RootstockLabs (Immunefi) · **Asset:** `powpeg-node` (+ `rskj` for the
rejection path) · **Severity:** High — temporary freezing of funds
· **Tested against:** `powpeg-node` `VETIVER-9.0.4.0` / master `f5c3823`;
`rskj` `VETIVER-9.0.4` / master `1e95a3b`.

> **Note on scope of impact.** This report no longer claims "delaying block
> production". Block production is not delayed. What stops is the *registration*
> of peg transactions: for the duration of a federation change, no peg-in is
> credited and no peg-out/migration UTXO registration reaches the Bridge. That is
> temporary freezing of user funds, bounded by the federation-change window.

---

## 0. Reproduce

```bash
./proof.sh
```

One command. It clones rskj at `1e95a3b` and powpeg-node at `VETIVER-9.0.4.0`,
applies the three patches in `patches/`, runs the tests against the production
classes and prints a PASS/FAIL line per claim. `./proof.sh --budget` adds the
40-slot / 1 764-turn JVM proof (`poc/`).

### Verified results (macOS arm64, JDK 17.0.20.1, 2026-10-20)

```
powpeg-node 3dc1d165  BtcToRskClientTest                  BUILD SUCCESSFUL
                                                          320 tests, 0 failures
              ..._activeClient_shouldBeInformed            PASSED
              ..._retiringClient_shouldNotBeInformed       PASSED
              ..._isSentAgainOnNextTurn                    PASSED
rskj        1e95a3b03  PegUtilsEvaluatePeginTest           17 tests, 0 failures
              ..._isRejectedWithInvalidAmount              PASSED
              ..._isRegistered (after the window)          PASSED
```

Remaining: `BridgeSupportRejectedPeginTest..._shouldRejectAndStayUnprocessed`
(the "not marked processed" link) is included in `proof.sh` but has not been
executed on a real machine yet — it is the one result still to confirm.

---

## 1. Summary

A federator validates a peg-in against the **single** federation it listens to,
while the Bridge validates the same transaction against **all live federations**
(active + retiring). A transaction that satisfies one and not the other is
therefore *sent* by the federator and *rejected* by the Bridge on every turn,
forever: since RSKIP551 a rejected non-refundable peg-in is no longer marked as
processed, so it is never removed from the node's pending map.

The pending map is a `ConcurrentHashMap` iterated in bin order and drained with a
hard cap of **40 sends per turn**. An attacker who grinds 40 wtxids into bin 0
makes those 40 entries the first 40 the iterator visits, exhausting the entire
per-turn budget before any other entry — including real user peg-ins — can be
reached. The situation persists for the whole life of the retiring federation
(10 585 RSK blocks ≈ 3.7 days on mainnet) and recurs at every federation change.

## 2. Preconditions

* A retiring federation is live — i.e. the network is inside a federation change.
  This is a normal, periodic, self-scheduled protocol process; the attacker does
  not trigger it, only waits for it. Retiring-federation lifetime:
  `FederationMainNetConstants.java:55` → `10 585` blocks.
* The attacker owns one UTXO. It is fanned into 40 outputs; the 0.2 BTC parked in
  the 40 peg-ins is credited back as RBTC when the retiring federation expires,
  so the real cost of one attack is ~0.0013 BTC in dust and fees.

## 3. Root cause

**(a) The node's validity check uses one federation.**
`BtcToRskClient.updateBridgeBtcTransactions()` builds its wallet from
`federationToListen` (`BtcToRskClient.java:559-564`) and `shouldSendTx` ends in
`isValidPegInTx(btcTx, federationWallet, peginInformation)` (`:759`):

```java
// powpeg-node PegUtils.java:131-142
List<TransactionOutput> fedUtxos = btcTx.getWalletOutputs(fedWallet);  // one federation
return fedUtxos.stream().allMatch(o -> o.getValue().compareTo(MINIMUM_PEGIN_TX_VALUE) >= 0);
```

**(b) The Bridge's check uses all live federations.**
`BridgeSupport.registerPegIn` (`BridgeSupport.java:489-496`) passes
`getNoSpendWalletForLiveFederations(false)` into `PegUtils.evaluatePegin`, which
walks every output paying **any** live federation (`rskj PegUtils.java:67-85`)
and rejects with `NO_REFUND / INVALID_AMOUNT` (`:213`).

A transaction shaped as

```
500 000 sat -> active federation     (>= minimum: the node says "valid")
  2 000 sat -> retiring federation   (<  minimum: the Bridge says "invalid")
```

is therefore sent by the active client on every turn.

**(c) Nothing ever removes it.**
`BridgeSupport.handleNonRefundablePegin` only marks a rejected non-refundable
peg-in as processed between RSKIP459 and RSKIP551 (`BridgeSupport.java:567-575`;
mainnet: `rskip551 = vetiver900`, `reference.conf:106`). After RSKIP551 the
rejection emits an event, the RSK transaction **succeeds**, and
`isBtcTxHashAlreadyProcessed(txid)` stays false. The entry remains in the map and
`shouldSendTx` keeps returning true.

**(d) The budget is 40 and the iteration order is attacker-controlled.**
`MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN = 40` (`BtcToRskClient.java:53`), the
loop `break`s at 40 (`:663-670`) and `txsToSendToRskHashes` is a
`ConcurrentHashMap.keySet()` (`io/BtcToRskClientFileData.java:18`).
`ConcurrentHashMap` iterates bins in index order, the index is
`(n-1) & spread(key.hashCode())`, and
`org.bitcoinj.core.Sha256Hash.hashCode()` is the **last four bytes** of the hash.
The wtxid is attacker-controlled (dust output / signature nonce), so grinding 40
wtxids with `spread(hashCode) & 0x3ff == 0` places all 40 in bin 0 — the first 40
entries the iterator returns.

## 4. Attack

1. Wait for (or plan around) a federation change; the retiring federation is live
   for ~3.7 days.
2. Fan one UTXO into 40 outputs; build 40 transactions
   `500 000 sat → active fed | 2 000 sat → retiring fed | change → attacker`, each
   ground until `spread(hashCode(wtxid)) & 0x3ff == 0` (~1 000 ECDSA attempts per
   transaction).
3. Broadcast; wait `btc2RskMinimumAcceptableConfirmations` (100 BTC blocks, ~16 h).
4. From then on, on every turn of every federator, those 40 entries are the first
   visited: 40 `registerBtcTransaction` calls per turn, network-wide, all
   rejected. Real peg-ins, peg-out/migration UTXO registrations and the
   funds-migration transaction of the ongoing change stay queued until the
   retiring federation expires.

Cost to the attacker: 40 × 2 000 sat dust (never refunded, `NO_REFUND`) +
~40 × 1 200 sat fees ≈ **0.0013 BTC**; the 0.2 BTC peg-in principal is credited
back as RBTC when the window closes (`executePegIn` pays
`peginInformation.getRskDestinationAddress()`, which for a legacy peg-in is the
RSK address of the P2PKH sender — the attacker's key).

Cost to the federation: ~43 000 gas per rejected call
(`BridgeMethods.java:642`) × 70 560 calls ≈ 3.0e9 gas ≈ **0.18 RBTC per window
network-wide**, all of it producing no state change.

## 5. Impact

For the whole window (up to ~3.7 days, repeating at every federation change):

* **users who peg in are not credited.** Their BTC is confirmed and sits in the
  active federation's address, but no RBTC appears; the deposit is frozen from
  the user's point of view until the window ends.
* `PEGOUT_OR_MIGRATION` registrations (`BridgeSupport.java:411-415`) do not run,
  so the Bridge's UTXO accounting for the federation stops being replenished.
* the funds-migration transaction of the federation change — which the protocol
  expects to be registered *within* the retiring federation's lifetime — cannot
  get a budget slot.

This is temporary (the system self-heals when the retiring federation is cleared),
so it is **High — temporary freezing of funds**, not Critical.

## 6. Proof of concept

`./proof.sh` — one command, six claims, PASS/FAIL table.

What "real" means here: the six assertions run inside `powpeg-node`'s and
`rskj`'s own Gradle builds, against `BtcToRskClient.updateBridgeBtcTransactions()`,
`PegUtils.evaluatePegin()` and `BridgeSupport.registerBtcTransaction()` — the
production classes, real storage, real event logger, real active + retiring
federation. Nothing in the decision path is re-implemented.

The independent JVM proof (`./proof.sh --budget`, source in `poc/`) uses 40
Bitcoin transactions signed with libsecp256k1 whose wtxids are ground into bin 0
of a real `java.util.concurrent.ConcurrentHashMap` in a real JVM: the production
send loop then emits 40 attacker entries and 0 honest ones on every turn for all
1 764 turns of the window. Negative control (same transactions, hashes not
ground): 28 attacker / 12 honest — so the effect comes from the grinding, not
from the harness.

patches/  rskj-PegUtilsEvaluatePeginTest           Bridge rejects / registers after the window
          rskj-BridgeSupportRejectedPeginTest      rejection does not mark processed
          powpeg-node-BtcToRskClientTest           sends it, retiring client drops it, re-sends it
repro/    regtest_attack.py + 20_proof_regtest.sh  optional live regtest run (needs a federation change)

## 7. Fix

`powpeg-node` (no consensus change):

1. validate with the same federation set as the Bridge
   (`getFederationsNoSpendWallet(active + retiring)`) so a transaction the Bridge
   will reject is dropped instead of retried;
2. stop letting one entry monopolise the budget: per-entry retry counter +
   exponential backoff, and quarantine after N consecutive turns in which the
   Bridge still has not marked the tx processed;
3. iterate in insertion order (`LinkedHashMap`/queue) instead of by a
   hash-controlled key, removing the grinding vector.

`rskj` (defence in depth, needs a network-wide decision): reconsider
`shouldMarkRejectedPeginAsProcessed()` for rejections whose reason cannot change
(e.g. `INVALID_AMOUNT`).
