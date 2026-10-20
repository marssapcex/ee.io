# Running the PoC against the real rskj + powpeg-node

This sandbox could not run the Java stack (see `README.md` §"Boundary": only
`github.com`, `codeload`, `api.github.com`, `registry.npmjs.org` and `pypi.org`
are reachable; the rskj/powpeg-node fat jars live on GitHub *release assets*,
which redirect to `objects.githubusercontent.com` and are blocked, and Maven
Central is blocked, so the sources cannot be compiled here either).
On a normal machine — the Mac setup in the original notes — the full stack is
reproducible. Everything below is taken from the two repositories themselves.

---

## 1. Build and run the pieces

Verified prerequisites in the tree:

* powpeg-node `build.gradle:179` → `sourceCompatibility = JavaVersion.VERSION_17`
  (JDK 17, not 1.8, despite the README text);
* powpeg-node tag `VETIVER-9.0.4.0` → `rskjcoreVersion = '9.0.4-VETIVER'`, a real
  Maven Central artifact (master tracks `9.1.0-SNAPSHOT`, which needs a local
  rskj build — use the tag to avoid that).

```bash
git clone https://github.com/rsksmart/powpeg-node && cd powpeg-node
git checkout VETIVER-9.0.4.0
./configure.sh            # fetches the pinned gradle-wrapper.jar
./gradlew build
```

Bitcoin Core and the node config are exactly as described in
`powpeg-node/README.md` ("Run bitcoind" → "Run PowPeg node", lines ~285-355):

```bash
bitcoind -regtest -printtoconsole -server -rpcuser=rsk -rpcpassword=rsk \
         -rpcport=18332 -txindex -debug=net -addresstype=legacy \
         -datadir=<PATH_TO_DATA_DIR>

bitcoin-cli -regtest --rpcuser=rsk --rpcpassword=rsk --rpcport=18332 generate 1
```

`node.conf` (same README, "Configuration file"):

```
federator{
    enabled = true
    signers {
       BTC { type = "keyFile"  path = "<ABS>/reg1.key" }
       RSK { type = "keyFile"  path = "<ABS>/reg1.key" }
       MST { type = "keyFile"  path = "<ABS>/reg1.key" }
    }
    bitcoinPeerAddresses = [ "127.0.0.1:18444" ]   # bitcoind p2p port, not RPC
}
```

```bash
java -cp build/libs/<JAR-NAME>.jar \
     -Drsk.conf.file=<ABS>/node.conf \
     co.rsk.federate.FederateRunner --regtest --reset
```

## 2. Drive turns on demand instead of waiting

`co.rsk.federate.rpc.Web3FederateImpl#fed_updateBridge`
(`src/main/java/co/rsk/federate/rpc/Web3FederateImpl.java:101-104`) is exposed on
the node's web3 endpoint and calls `updateBridge()` on **both** the active and
the retiring client synchronously:

```java
public void fed_updateBridge() {
    btcToRskClientActive.updateBridge();
    btcToRskClientRetiring.updateBridge();
}
```

So a turn can be triggered with a plain JSON-RPC call — no 15 s/180 s wait:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"fed_updateBridge","params":[],"id":1}' \
     http://127.0.0.1:4444/
```

Register the same BTC transaction in a second turn and watch it be sent again:

```bash
# was the BTC tx accepted by the Bridge?
curl -s -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_call","params":[{
        "to":"0x0000000000000000000000000000000001000006",
        "data":"<bridge_isBtcTxHashAlreadyProcessed(txid)>"},"latest"],"id":1}' \
     http://127.0.0.1:4444/
# the RSK tx of the last send: status + Bridge logNonRefundablePegin event
bitcoin-cli -regtest getrawmempool
```

(On regtest `btc2RskMinimumAcceptableConfirmations = 3`
(`BridgeRegTestConstants.java:62`) and `updateBridgeExecutionPeriod = 15 s`
(`:59`), so a full cycle takes seconds.)

## 3. The one thing that needs a federation change

The asymmetry only exists while **two** federations are live:
`FederationContext.getLiveFederations()` returns `[active, retiring]` and nothing
else (`rskj-core/src/main/java/co/rsk/peg/federation/FederationContext.java:32-36`),
so the trigger window is exactly `fundsMigrationAgeSinceActivationEnd`
(10 585 blocks on mainnet, **150 blocks on regtest**,
`FederationRegTestConstants.java:42`) — i.e. minutes, not days, in regtest.

Two ways to get there:

**a. Use the project's regtest federation-change flow.** In regtest the genesis
federation is a single member and the Bridge's `voteFederationChange` entry
point is open to it, so a scripted `ADD`/`COMMIT` sequence creates the new
federation and leaves the old one retiring. This is what the project's `rit`
(integration test) harness does; wiring it up is a few RPC calls but it depends
on that harness, which is not vendored in this repository — it is the step I
could not execute in this sandbox and would not guess at.

**b. Assert it at the level of the two real classes** (no federation change, no
consensus needed): add a JUnit test to powpeg-node that builds one `BtcTransaction`
with `500 000 sat` to the active federation and `2 000 sat` to a second
federation (the existing `BtcToRskClientTest` already constructs active and
retiring federations, see `src/test/java/co/rsk/federate/BtcToRskClientTest.java:1550-1590`),
then assert:

```java
// powpeg-node: the node is happy  -> the tx is sent, the budget is consumed
assertTrue(PegUtils.isValidPegInTx(btcTx, activeFedNoSpendWallet, peginInformation));

// rskj: the Bridge is not      -> NO_REFUND / INVALID_AMOUNT, never marked processed
assertEquals(PeginProcessAction.NO_REFUND,
    PegUtils.evaluatePegin(btcTx, peginInformation, Coin.valueOf(500_000),
                           liveFederationsWallet, activations).getPeginProcessAction());
```

That pair of assertions is the whole vulnerability; running it inside the real
build (`./gradlew test`) closes the "it was only re-implemented in Python" gap
with two lines of real assertions.

## 4. What to record for the report

1. `fed_updateBridge` called twice → the same wtxid submitted twice
   (`x` in the node log: `[sendTx] Will send btc tx ...`, and two RSK tx hashes).
2. The Bridge's receipt: `status = 0x1` (the RSK transaction does **not** revert),
   with a `logNonRefundablePegin` event and `INVALID_AMOUNT`.
3. `isBtcTxHashAlreadyProcessed(txid) == false` after both registrations.
4. The pending file of the client still contains the wtxid (the
   `BtcToRskClientFileStorage` file under the node's data directory).
5. With 40 ground txs in the map, add one honest peg-in (any 500 000+ sat output
   to the active federation) and show that `fed_updateBridge` never sends it
   until the 40 are removed.
