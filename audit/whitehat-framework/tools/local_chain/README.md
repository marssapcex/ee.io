# local_chain — a chain with no RPC, for PoCs that do not need live mainnet state

```bash
npm install            # ~15 s, everything from the npm registry
npx hardhat test       # compiles with solc-js, runs the EVM in-process
```

This works in a sandbox that can reach only the npm registry and GitHub. Verified output:

```
vault left : 0.0 ETH
attacker   : 11.0 ETH
✔ reentrancy drains a vault that holds other users' deposits
whale balance injected: 1000.0 ETH
whale deposited 900 ETH as a fake LP: 900.0
✔ inject mainnet-like state WITHOUT a fork: setBalance / setStorageAt / impersonate
fuzz sum: 0.013151994639852306 contract: 0.013151994639852306
✔ invariant + mini-fuzz over random deposit sizes
```

| capability | how | in the test file |
|---|---|---|
| compile solc 0.8.x offline | `solc` npm package + subtask override in `hardhat.config.js` | `npx hardhat compile` |
| deploy target contracts | `ethers.getContractFactory` on the in-process chain | yes |
| exploit and measure the drain | real value between real contracts | attacker 1 -> 11 ETH, vault 10 -> 0 |
| write arbitrary state | `hardhat_setBalance`, `hardhat_setStorageAt`, `hardhat_setCode`, `hardhat_setNonce` | yes |
| act as any address | `hardhat_impersonateAccount` + `getSigner` | yes |
| control time / blocks | `hardhat_mine`, `hardhat_setNextBlockTimestamp`, `evm_increaseTime` | `hardhat_mine` |
| property fuzz | loop random inputs, assert the invariant | 25 random deposits, sum == balance |

## What this cannot do

**Read mainnet state.** No RPC means no `forking: { url: ... }`. That is the only missing piece, and
it is a network limit, not a framework limit. `forge`/`anvil` binaries are also unreachable from a
locked-down sandbox (GitHub release assets are blocked), which is why this is hardhat + solc-js.

## State transplant — the workaround for "no fork"

You do not need a live RPC to test against real state; you need the handful of slots that matter.
Dump them where RPC exists, replay them here:

```bash
# on a machine with RPC
cast code    <contract> --rpc-url $RPC                 # runtime bytecode
cast storage <contract> <slot> --rpc-url $RPC          # one slot at a time
cast call    <erc20> "balanceOf(address)(uint256)" <holder> --rpc-url $RPC
cast block   latest timestamp --rpc-url $RPC
```

`transplant.json`:

```json
{
  "blockTimestamp": 1764547200,
  "contracts": [
    { "name": "treasury", "address": "0x...", "code": "0x...",
      "slots": { "0": "0x...", "3": "0x..." } }
  ],
  "balances": { "0x...": "1000000000000000000" },
  "erc20": [
    { "address": "0x...", "code": "0x...", "slot": 0,
      "holders": { "0x...": "123456" } }
  ]
}
```

```bash
node transplant.js transplant.json
```

Now the **real deployed bytecode runs against real storage values**, no fork. A normal mocha test can
call it afterwards.

Limits, stated honestly:

- You must know which slots matter (storage layout from the repo, or `forge inspect <C> storageLayout`).
- It is a snapshot, not a chain: state you did not transplant is missing, and nothing re-enters it.
- Contracts that read a live oracle on every call still need the oracle's slot transplanted too.
