# splits-v2 fuzz harness (real code, no fork needed)

Compiles **the unmodified 0xSplits sources** and fuzzes them on the in-process hardhat EVM.
No forge binary, no RPC, no fork: `solc-js` from npm + hardhat's EVM.

```
cd audit/whitehat-framework/tools/local_chain
npm install                                             # once
SPLITS_ROOT=/tmp/splits/packages/splits-v2 \
  node targets/splits-v2/compile.js                     # real sources -> artifacts.json
npx hardhat test targets/splits-v2/test/splits.fuzz.test.js
npx hardhat test targets/splits-v2/test/edge.test.js
```

`SPLITS_ROOT` points at `packages/splits-v2` of a clone of
`github.com/0xSplits/splits-contracts-monorepo` (commit `0159376`). `compile.js` implements the
package's `remappings.txt` by hand (`@openzeppelin/contracts/`, `solady/`, `src/`, `test/`) and
rewrites every import to an absolute source-unit name, so nothing is fetched from the network.

## What the fuzz test asserts

The attacker is a plain EOA: zero tokens, zero privileges, it can only call public functions.
After every one of 240 random calls it must still be worth **zero**:

| invariant | why it matters |
| --- | --- |
| `attacker.tokenBalance == 0` | no real ERC20 ever moved to it |
| `attacker.warehouseLedger == 0` | no ERC6909 claim was minted to it |
| `attacker.ethBalance <= start` | it never received ETH, only burned gas |
| `warehouse.tokenBalance >= Σ ledger` | the warehouse never became insolvent |
| `Σ everyone == minted supply` | nothing was created or destroyed |

Ops covered, all permissionless: `warehouse.withdraw` (both overloads), `transferFrom`,
`batchTransfer`, `temporaryApproveAndCall`, `pushSplit.distribute` (4 shapes),
`pullSplit.distribute` (4 shapes), `pushSplit.withdrawFromWarehouse`,
`pullSplit.depositToWarehouse`, `distribute` with a tampered split struct. Privileged entry
points (`execCalls`, `updateSplit`, `setPaused`, `transferOwnership`) are asserted to **revert**.

`SEED` / `ROUNDS` env vars change the run: `SEED=7 ROUNDS=1000 npx hardhat test ...`.

## Files

- `compile.js` — source gathering + solc-js standard JSON, writes `artifacts.json`
- `test/splits.fuzz.test.js` — the invariant fuzz + the incentive test + the zero-balance edge
- `test/edge.test.js` — one `it` per concrete observation, prints the revert data it hits
- `test/probe.test.js` — isolates each permissionless call, prints ledger movements per call
- `test/harness/MockERC20.sol` — token + rejecting/reentering recipients (not part of the repo under audit)
