/**
 * Isolation run: find out how a zero-balance EOA's SplitsWarehouse ledger (ERC6909)
 * becomes non-zero, using only permissionless calls.
 *
 * run: npx hardhat test targets/splits-v2/test/probe.test.js
 */
const { expect } = require("chai");
const ethers = require("ethers");
const { ethers: hre, network } = require("hardhat");
const artifacts = require("../artifacts.json");

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const PREDICT_SALT = "predictDeterministicAddress((address[],uint256[],uint256,uint16),address,bytes32)";
const PREDICT_NONCE = "predictDeterministicAddress((address[],uint256[],uint256,uint16),address)";
const SALT1 = ethers.zeroPadValue("0x01", 32);
const id = (a) => BigInt(a);

function deploy(name, signer, ...args) {
  const a = artifacts[name];
  return new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
}
function splitStruct(recipients, allocations, incentive) {
  return {
    recipients,
    allocations,
    totalAllocation: allocations.reduce((a, b) => a + b, 0n),
    distributionIncentive: incentive,
  };
}

describe("probe: where does an attacker ledger balance come from?", function () {
  it("isolates each permissionless call", async function () {
    const [owner, alice, bob, carol, attacker, distributor] = await hre.getSigners();
    const warehouse = await deploy("SplitsWarehouse", owner, "Ether", "ETH");
    const pushFactory = await deploy("PushSplitFactory", owner, await warehouse.getAddress());
    const pullFactory = await deploy("PullSplitFactory", owner, await warehouse.getAddress());
    const token = await deploy("MockERC20", owner);
    const W = await warehouse.getAddress();
    const T = await token.getAddress();

    const recips = [alice.address, bob.address, carol.address];
    const split = splitStruct(recips, [500_000n, 300_000n, 200_000n], 0);

    const pushAddr = await pushFactory[PREDICT_SALT](split, owner.address, SALT1);
    await (await pushFactory.createSplitDeterministic(split, owner.address, owner.address, SALT1)).wait();
    const pushSplit = new ethers.Contract(pushAddr, artifacts.PushSplit.abi, owner);

    const pullAddr = await pullFactory[PREDICT_SALT](split, owner.address, SALT1);
    await (await pullFactory.createSplitDeterministic(split, owner.address, owner.address, SALT1)).wait();
    const pullSplit = new ethers.Contract(pullAddr, artifacts.PullSplit.abi, owner);

    // fund: 1e6 tokens in each wallet, 1e6 in each wallet's warehouse ledger
    for (const w of [pushAddr, pullAddr]) {
      await (await token.mint(owner.address, 2_000_000n)).wait();
      await (await token.approve(W, 2_000_000n)).wait();
      await (await token.transfer(w, 1_000_000n)).wait();
      await (await warehouse.deposit(w, T, 1_000_000n)).wait();
      await (await warehouse.deposit(w, NATIVE, 10n ** 18n, { value: 10n ** 18n })).wait();
    }

    const led = async (a) => warehouse.balanceOf(a, id(T));
    const show = async (label) => {
      console.log(
        `        ${label.padEnd(52)} attacker ledger=${await led(attacker.address)} tok=${await token.balanceOf(
          attacker.address
        )} | push=${await led(pushAddr)} pull=${await led(pullAddr)}`
      );
    };
    await show("after funding");

    const tries = [
      ["warehouse.withdraw(push, T)  2-arg", () => warehouse.connect(attacker).withdraw(pushAddr, T)],
      ["warehouse.withdraw(pull, T)  2-arg", () => warehouse.connect(attacker).withdraw(pullAddr, T)],
      [
        "warehouse.withdraw(pull,[T],[1e6],attacker) 4-arg",
        () => warehouse.connect(attacker).withdraw(pullAddr, [T], [1_000_000n], attacker.address),
      ],
      ["pushSplit.distribute(split,T,attacker)", () => pushSplit.connect(attacker).distribute(split, T, attacker.address)],
      ["pullSplit.distribute(split,T,attacker)", () => pullSplit.connect(attacker).distribute(split, T, attacker.address)],
      ["pushSplit.withdrawFromWarehouse(T)", () => pushSplit.connect(attacker).withdrawFromWarehouse(T)],
      ["pullSplit.depositToWarehouse(T, 1e5)", () => pullSplit.connect(attacker).depositToWarehouse(T, 100_000n)],
      ["warehouse.batchTransfer([attacker],T,[1e6])", () => warehouse.connect(attacker).batchTransfer([attacker.address], T, [1_000_000n])],
    ];

    for (const [label, fn] of tries) {
      let status = "ok";
      try {
        const tx = await fn();
        await tx.wait();
      } catch (e) {
        status = "revert(" + (e.shortMessage || e.message).slice(0, 40) + ")";
      }
      await show(`${label}  -> ${status}`);
    }
  });
});
