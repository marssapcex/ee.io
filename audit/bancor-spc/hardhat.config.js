// In-process hardhat EVM only. Contracts are pre-compiled by ./compile.js with solc-js,
// so this config never asks hardhat to download a solc binary.
require("@nomicfoundation/hardhat-ethers");
module.exports = {
  solidity: { version: "0.6.12", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: { hardhat: { hardfork: "shanghai", chainId: 31337 } },
};
