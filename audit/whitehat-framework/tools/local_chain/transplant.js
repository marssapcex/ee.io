#!/usr/bin/env node
/**
 * Replay a hand-dumped state snapshot into a hardhat chain, so real deployed
 * bytecode can be exercised without an RPC / fork.
 *
 *   node transplant.js transplant.json
 *
 * Snapshot format: see README.md.
 */
const hre = require("hardhat");
const fs = require("fs");

const hexPad = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node transplant.js <snapshot.json>");
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  const rpc = (m, a) => hre.network.provider.send(m, a);

  if (snap.blockTimestamp) {
    await rpc("evm_setNextBlockTimestamp", [snap.blockTimestamp]);
    console.log("timestamp ->", snap.blockTimestamp);
  }

  for (const c of snap.contracts || []) {
    if (c.code) await rpc("hardhat_setCode", [c.address, c.code]);
    for (const [slot, value] of Object.entries(c.slots || {})) {
      await rpc("hardhat_setStorageAt", [c.address, hexPad(slot), hexPad(value)]);
    }
    console.log(
      "contract", c.name || c.address,
      "| code", c.code ? "set" : "kept",
      "| slots", Object.keys(c.slots || {}).length
    );
  }

  for (const [addr, wei] of Object.entries(snap.balances || {})) {
    await rpc("hardhat_setBalance", [addr, "0x" + BigInt(wei).toString(16)]);
    console.log("native balance", addr, wei);
  }

  for (const t of snap.erc20 || []) {
    if (t.code) await rpc("hardhat_setCode", [t.address, t.code]);
    const slot = BigInt(t.slot ?? 0);
    for (const [holder, bal] of Object.entries(t.holders || {})) {
      const key = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot])
      );
      await rpc("hardhat_setStorageAt", [t.address, key, hexPad(bal)]);
    }
    if (t.totalSupply !== undefined) {
      const tsSlot = BigInt(t.totalSupplySlot ?? 2);
      await rpc("hardhat_setStorageAt", [t.address, hexPad(tsSlot), hexPad(t.totalSupply)]);
    }
    console.log(
      "erc20", t.address, "| holders", Object.keys(t.holders || {}).length,
      t.totalSupply !== undefined ? "| totalSupply set" : ""
    );
  }

  await rpc("hardhat_mine", ["0x1"]);
  console.log("applied | block", parseInt(await rpc("eth_blockNumber", []), 16));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
