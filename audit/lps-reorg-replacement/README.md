# RSK: a reorged-out transaction, replaced, never comes back

Two real rskj regtest nodes. Real proof-of-work fork choice, real P2P, real
blocks. No mocks, no emulator, no patched constant, no database written by hand.

It answers one question: **if a transaction is mined, then orphaned by a reorg,
and a same-nonce transaction takes its nonce, does the first one ever come
back?** The answer on rskj is no, and the run prints the numbers that say so.

## Run it

```sh
python3 regtest_reorg_replacement.py --rskj-jar "$HOME/rskj.jar"
```

Needs a JRE 17+ and the rskj fat jar:

```sh
curl -L -o ~/rskj.jar https://github.com/rsksmart/rskj/releases/download/VETIVER-9.0.4/rskj-core-9.0.4-VETIVER-all.jar
```

Nothing else: no docker, no web3, no unlocked account. Transactions are signed
by `ethsign.py` (stdlib keccak256 + secp256k1 + RLP) and pushed with
`eth_sendRawTransaction`, using the account premined in rskj's own regtest
genesis.

```
--prefix N     blocks of history before the fork (default 12)
--keep         keep both node directories and their logs
--probe        start one node and report what it does, without measuring anything
--skip-policy  skip stage P1
```

## What it does

1. **P1** measures the pool rules with ordinary transfers: a mined transaction
   cannot be replaced; a pooled one needs +40%, so +15% is refused and +100% is
   accepted; once accepted the old hash is gone.
2. Grows node1's chain to `--prefix` blocks. That history is what the reorg must
   not touch.
3. Starts node2 pointed at node1 and waits until node2 reports node1's tip hash
   at node1's height, so both nodes own exactly the same history.
4. Separates them (peer count on both is waited down to 0 and asserted) and lets
   the chains diverge: node1 mines one block holding the victim and the control,
   node2 mines three empty blocks on the same parent. Node2's chain now has the
   larger total difficulty, printed from both nodes.
5. Reconnects them and waits for node1 to switch: the block with the two
   transactions is orphaned, its hash changes, every prefix block keeps its hash,
   and both transactions go back into node1's pool with the account nonce and
   balance rolled back to their pre-fork values.
6. Sends a same-nonce replacement for the victim at +15% (refused, still) and
   +100% (accepted), mines three blocks, then reads every surviving block for the
   victim's hash. It is in none of them. The control - orphaned in the same
   block, never replaced - is mined again normally.

## Reading the output

One line per measurement, numbers only, grouped by stage:

```
rskj RskJ/9.0.4/…/VETIVER-731b9d8
regtest  ·  gas 1000 wei (quoted 1)  ·  prefix 12 blocks
node1 :4444/:50501  ·  node2 :4445/:50502
account 0xcd2a3d…d826  bal=…

P1  replacement rules
     P1a ok   tx mined, 1 wei             blk=2 status=1 bal=1
     P1c ok   in pool, +15%               1150/1000 -> gas price not enough to bump transaction
     P1d ok   in pool, +100%              2000/1000 -> accepted, old hash gone
P2  reorg of the tip
     P2c ok   victim + control mined      blk=15 0xec9e598603db3d75 txs=3
     P2d ok   B heavier, same parent      A h=15 td=16 | B h=17 td=18
     P2f ok   switch, prefix intact       blk15 0xec9e5986->0xdbb931f1 blk1..14 intact
     P2h ok   pool + state rollback       nonce=3 bal=1 pool=2
P3  replacement after the reorg
     P3c ok   victim in any block         blk15..20: none replacement blk=18
P4  control
     P4  ok   control mined again         blk=18 bal=3 = bal@P2c

  17/17 ok  ·  41.2 s
```

(The layout is real, the numbers are placeholders - the log of an actual run goes
here once it has been produced.) `ok` is green and `FAIL` red on a terminal;
`NO_COLOR=1` turns that off. Redirected output carries no progress redraws, so
the file is exactly what is printed above.

## Where those numbers come from in rskj

| thing | source |
| --- | --- |
| `transaction.gasPriceBump = 40` | `reference.conf:306` |
| a same-nonce replacement needs `new >= old * 140 / 100` | `TransactionPoolImpl:305-311` (`isBumpingGasPriceForSameNonceTx`) |
| a reorg returns the orphaned block's transactions to the pool | `TransactionPoolImpl:315-334` (`processBest` -> `retractBlock`) and `:357-363` (`retractBlock` -> `addTransactions`) |
| a mined transaction can never be replaced | `TxValidatorNonceRangeValidator:50` -> `transaction nonce too low` |

So a reorg on its own *rescues* the transaction. What kills it is the
replacement, which is only possible after the reorg.

## Why 1000 wei

Regtest quotes `eth_gasPrice = 1 wei`, and 15% of 1 wei is not a whole number.
Every transfer here uses 1000 wei, so +15% is 1150 and +100% is 2000.

## Files

- `regtest_reorg_replacement.py` - the PoC
- `ethsign.py` - keccak256, secp256k1, RLP, `sign_tx`, `address_of`; run it
  directly for its self-test
- `result.json` - written by a run, next to the log
