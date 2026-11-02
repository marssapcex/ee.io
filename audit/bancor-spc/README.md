# Bancor StandardPoolConverter v46 — attack harness (real code, in-process EVM)

    npm i --no-audit --no-fund
    node compile.js
    npx hardhat test test/spc.test.js

- `src/` — unmodified upstream sources of `bancorprotocol/contracts-solidity` @ 7fbf6c26
  (`solidity/contracts/...`), 16 files, only what `StandardPoolConverter` needs.
- `src/mocks/Mocks.sol` — harness mocks (ERC20 / DSToken anchor / registry / network settings).
- `compile.js` — solc-js 0.6.12, no solc binary download, no network.
- `test/spc.test.js` — 5 scenarios, prints real numbers (see ../REPORT.md §2).

Verdict: no permissionless drain in this file. See REPORT.md.
