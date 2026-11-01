require("@nomicfoundation/hardhat-ethers");
// Hardhat with NO network access: point the compiler at npm's solc-js instead of
// downloading a native binary from binaries.soliditylang.org.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.26") {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: "0.8.26",
      longVersion: "0.8.26+commit.8a97fa7a",
    };
  }
  return runSuper();
});

module.exports = { solidity: { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 } } } };
