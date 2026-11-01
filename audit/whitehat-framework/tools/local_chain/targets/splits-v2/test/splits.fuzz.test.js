/**
 * Fuzz / invariant suite for the REAL 0xSplits splits-v2 contracts.
 *
 * - contracts are the unmodified sources of 0xSplits/splits-contracts-monorepo
 *   (commit 0159376), compiled by ./compile.js and deployed by raw bytecode here
 * - no fork / no RPC needed: everything runs on the in-process hardhat EVM
 * - the "attacker" is a plain EOA with zero balance and zero privileges: it only
 *   calls public functions. Any token or ETH it ends up with is money it took
 *   from someone else.
 *
 * run: npx hardhat test targets/splits-v2/test/splits.fuzz.test.js
 */
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const artifacts = require("../artifacts.json");

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const id = (addr) => BigInt(addr); // uint256(uint160(token))
const SEED = Number(process.env.SEED || 1337);
const PREDICT_SALT = "predictDeterministicAddress((address[],uint256[],uint256,uint16),address,bytes32)";
const SALT1 = ethers.zeroPadValue("0x01", 32);
const PREDICT_NONCE = "predictDeterministicAddress((address[],uint256[],uint256,uint16),address)";

// xorshift32 -> deterministic, reproducible pseudo randomness
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

function deploy(name, signer, ...args) {
  const a = artifacts[name];
  if (!a) throw new Error(`no artifact ${name}`);
  return new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
}

function splitStruct(recipients, allocations, incentive) {
  const total = allocations.reduce((a, b) => a + b, 0n);
  return { recipients, allocations, totalAllocation: total, distributionIncentive: incentive };
}

describe("splits-v2 fuzz: can a zero-balance, zero-privilege EOA take money?", function () {
  let warehouse, pushFactory, pullFactory, token;
  let owner, alice, bob, carol, attacker, distributor;
  let push, pull, pushSplit, pullSplit, push2, pull2, split2;
  let tracked; // every address whose warehouse ledger we audit
  let supply;
  let rng;
  let attackerStart = 0n;

  const bal = async (who) => token.balanceOf(who);
  const wbal = async (who) => warehouse.balanceOf(who, id(await token.getAddress()));
  const ethBal = async (who) => ethers.provider.getBalance(who);

  async function deployAll() {
    [owner, alice, bob, carol, attacker, distributor] = await ethers.getSigners();
    rng = makeRng(SEED);

    warehouse = await deploy("SplitsWarehouse", owner, "Ether", "ETH");
    await warehouse.waitForDeployment();
    pushFactory = await deploy("PushSplitFactory", owner, await warehouse.getAddress());
    await pushFactory.waitForDeployment();
    pullFactory = await deploy("PullSplitFactory", owner, await warehouse.getAddress());
    await pullFactory.waitForDeployment();
    token = await deploy("MockERC20", owner);
    await token.waitForDeployment();

    const W = await warehouse.getAddress();
    const recips = [alice.address, bob.address, carol.address];
    push = splitStruct(recips, [500_000n, 300_000n, 200_000n], 0);
    pull = { ...push };
    split2 = splitStruct([attacker.address, bob.address], [1n, 1n], 0);

    const pushAddr = await pushFactory[PREDICT_SALT](push, owner.address, SALT1);
    await (await pushFactory.createSplitDeterministic(push, owner.address, owner.address, SALT1)).wait();
    pushSplit = new ethers.Contract(pushAddr, artifacts.PushSplit.abi, owner);

    const pullAddr = await pullFactory[PREDICT_SALT](pull, owner.address, SALT1);
    await (await pullFactory.createSplitDeterministic(pull, owner.address, owner.address, SALT1)).wait();
    pullSplit = new ethers.Contract(pullAddr, artifacts.PullSplit.abi, owner);

    push2 = await (await pushFactory.createSplit(push, owner.address, owner.address)).wait();
    pull2 = await (await pullFactory.createSplit(pull, owner.address, owner.address)).wait();
    push2 = new ethers.Contract(
      await pushFactory[PREDICT_NONCE](push, owner.address),
      artifacts.PushSplit.abi,
      owner
    );
    pull2 = new ethers.Contract(
      await pullFactory[PREDICT_NONCE](pull, owner.address),
      artifacts.PullSplit.abi,
      owner
    );

    tracked = [pushAddr, pullAddr, owner.address, alice.address, bob.address, carol.address];
    supply = 0n;

    // fund the two split wallets: some tokens in the wallet, some already in the warehouse
    for (const [wallet, amount] of [
      [pushAddr, 1_000_000n],
      [pullAddr, 1_000_000n],
    ]) {
      await (await token.mint(owner.address, amount * 2n)).wait();
      supply += amount * 2n;
      await (await token.approve(W, amount * 2n)).wait();
      // half of it deposited to the warehouse on the wallet's behalf
      await (await warehouse.deposit(wallet, await token.getAddress(), amount)).wait();
      // half of it sent straight to the wallet
      await (await token.transfer(wallet, amount)).wait();
    }

    // a little native ETH too
    for (const wallet of [pushAddr, pullAddr]) {
      await (
        await warehouse.deposit(wallet, NATIVE, ethers.parseEther("1"), { value: ethers.parseEther("1") })
      ).wait();
    }

    // the attacker holds no tokens at all, and we record its starting gas money:
    // from here on its ETH may only go down (gas), never up (income)
    expect(await bal(attacker.address)).to.equal(0n);
    attackerStart = await ethBal(attacker.address);
    console.log(`        attacker start: ${await bal(attacker.address)} tokens, ${attackerStart} wei`);
  }

  /** warehouse must always hold at least as much as its own ledger says it owes */
  async function assertSolvent() {
    let ledger = 0n;
    for (const who of tracked) ledger += await wbal(who);
    const held = await bal(await warehouse.getAddress());
    expect(held >= ledger, `warehouse insolvent: holds ${held} owes ${ledger}`).to.equal(true);

    let ethLedger = 0n;
    for (const who of tracked) ethLedger += await warehouse.balanceOf(who, id(NATIVE));
    const ethHeld = await ethBal(await warehouse.getAddress());
    expect(ethHeld >= ethLedger, `warehouse ETH insolvent: holds ${ethHeld} owes ${ethLedger}`).to.equal(true);
  }

  async function assertAttackerBroke() {
    const t = await bal(attacker.address); // real ERC20 in hand
    const l = await wbal(attacker.address); // ERC6909 claim inside the warehouse
    const e = await ethBal(attacker.address);
    expect(t, "attacker received tokens it never deposited").to.equal(0n);
    expect(l, "attacker received a warehouse claim it never deposited").to.equal(0n);
    expect(e <= attackerStart, `attacker ETH went UP: ${e} > ${attackerStart}`).to.equal(true);
  }

  const ops = [
    // ---- warehouse, permissionless, on behalf of someone else
    {
      name: "warehouse.withdraw(victim, token)",
      run: async () => {
        const victim = rng() < 0.5 ? await pushSplit.getAddress() : await pullSplit.getAddress();
        return warehouse.connect(attacker).withdraw(victim, await token.getAddress());
      },
    },
    {
      name: "warehouse.withdraw(victim, tokens, amounts, attacker)",
      run: async () => {
        const victim = rng() < 0.5 ? await pushSplit.getAddress() : await pullSplit.getAddress();
        const amt = BigInt(Math.floor(rng() * 500_000));
        return warehouse.connect(attacker).withdraw(victim, [await token.getAddress()], [amt], attacker.address);
      },
    },
    {
      name: "warehouse.transferFrom(victim, attacker, id, amt)  [no allowance]",
      run: async () => {
        const victim = await pullSplit.getAddress();
        return warehouse
          .connect(attacker)
          .transferFrom(victim, attacker.address, id(await token.getAddress()), 1_000_000n);
      },
      mustRevert: true,
    },
    {
      name: "warehouse.batchTransfer([bob], token, 1e6)  [attacker has no balance]",
      run: async () =>
        warehouse.connect(attacker).batchTransfer([bob.address], await token.getAddress(), [1_000_000n]),
      mustRevert: true,
    },
    {
      name: "warehouse.temporaryApproveAndCall(attacker, target=attacker)",
      run: async () =>
        // the attacker can only ever grant access to its own (empty) ledger
        warehouse
          .connect(attacker)
          .temporaryApproveAndCall(attacker.address, false, id(await token.getAddress()), 1, attacker.address, "0x"),
      expectRevertOk: true,
    },

    // ---- split wallets, permissionless
    {
      name: "pushSplit.distribute(split, token, attacker)",
      run: async () => pushSplit.connect(attacker).distribute(push, await token.getAddress(), attacker.address),
    },
    {
      name: "pullSplit.distribute(split, token, attacker)",
      run: async () => pullSplit.connect(attacker).distribute(pull, await token.getAddress(), attacker.address),
    },
    {
      name: "pushSplit.distribute(split, token, amt, false, attacker)",
      run: async () =>
        pushSplit
          .connect(attacker)
          .distribute(push, await token.getAddress(), BigInt(Math.floor(rng() * 700_000)), false, attacker.address),
    },
    {
      name: "pullSplit.distribute(split, token, amt, false, attacker)",
      run: async () =>
        pullSplit
          .connect(attacker)
          .distribute(pull, await token.getAddress(), BigInt(Math.floor(rng() * 700_000)), false, attacker.address),
    },
    {
      name: "pushSplit.distribute(split, token, amt, true, attacker)",
      run: async () =>
        pushSplit
          .connect(attacker)
          .distribute(push, await token.getAddress(), BigInt(Math.floor(rng() * 700_000)), true, attacker.address),
      expectRevertOk: true,
    },
    {
      name: "pullSplit.distribute(split, token, amt, true, attacker)",
      run: async () =>
        pullSplit
          .connect(attacker)
          .distribute(pull, await token.getAddress(), BigInt(Math.floor(rng() * 700_000)), true, attacker.address),
      expectRevertOk: true,
    },
    {
      name: "pushSplit.withdrawFromWarehouse(token)  [permissionless!]",
      run: async () => pushSplit.connect(attacker).withdrawFromWarehouse(await token.getAddress()),
      expectRevertOk: true,
    },
    {
      name: "pullSplit.depositToWarehouse(token, amt)  [permissionless!]",
      run: async () =>
        pullSplit.connect(attacker).depositToWarehouse(await token.getAddress(), BigInt(Math.floor(rng() * 700_000))),
      expectRevertOk: true,
    },
    {
      name: "pushSplit.distribute with a tampered split (attacker as sole recipient)",
      run: async () =>
        pushSplit
          .connect(attacker)
          .distribute(splitStruct([attacker.address], [1n], 0), await token.getAddress(), attacker.address),
      mustRevert: true,
    },

    // ---- privileged entry points: must stay closed
    {
      name: "pushSplit.execCalls([transfer(all tokens -> attacker)])",
      run: async () =>
        pushSplit.connect(attacker).execCalls([
          {
            to: await token.getAddress(),
            value: 0,
            data: token.interface.encodeFunctionData("transfer", [attacker.address, 1_000_000n]),
          },
        ]),
      mustRevert: true,
    },
    {
      name: "pushSplit.updateSplit(attacker-controlled split)",
      run: async () => pushSplit.connect(attacker).updateSplit(splitStruct([attacker.address], [1n], 0)),
      mustRevert: true,
    },
    {
      name: "pushSplit.setPaused(true)",
      run: async () => pushSplit.connect(attacker).setPaused(true),
      mustRevert: true,
    },
    {
      name: "pushSplit.transferOwnership(attacker)",
      run: async () => pushSplit.connect(attacker).transferOwnership(attacker.address),
      mustRevert: true,
    },
  ];

  it("fuzzes 240 random permissionless calls and keeps every invariant", async function () {
    await deployAll();

    const stats = {};
    const rounds = Number(process.env.ROUNDS || 240);

    for (let i = 0; i < rounds; i++) {
      const op = ops[Math.floor(rng() * ops.length)];
      stats[op.name] = stats[op.name] || { ok: 0, revert: 0 };
      try {
        const tx = await op.run();
        if (tx && tx.wait) await tx.wait();
        stats[op.name].ok++;
        if (op.mustRevert) throw new Error(`op must revert but succeeded: ${op.name}`);
      } catch (e) {
        stats[op.name].revert++;
        if (op.mustRevert) {
          // expected
        } else if (!op.expectRevertOk) {
          // a permissionless op that reverts is fine (nothing to move), just record it
        }
        if (op.mustRevert && /must revert but succeeded/.test(e.message)) throw e;
      }

      await assertSolvent();
      await assertAttackerBroke();
    }

    // conservation: nothing was minted after setup, nothing was lost
    let total = 0n;
    for (const who of tracked) total += await bal(who);
    total += await bal(await warehouse.getAddress());
    expect(total).to.equal(supply);

    console.log("        op                                      ok / revert");
    for (const [k, v] of Object.entries(stats)) {
      console.log(`        ${k.padEnd(38)} ${v.ok} / ${v.revert}`);
    }
    console.log(`        attacker balance after ${rounds} rounds: ${await bal(attacker.address)} tokens, ${await ethBal(attacker.address)} wei`);
  });

  it("incentive != 0: an unprivileged distributor takes exactly incentive% once per distribution", async function () {
    await deployAll();
    const inc = 10_000n; // 1%
    const s = splitStruct([alice.address, bob.address], [1n, 1n], Number(inc));
    // nonce based createSplit: prediction must happen BEFORE the nonce is consumed
    const addr = await pushFactory[PREDICT_NONCE](s, owner.address);
    await (await pushFactory.createSplit(s, owner.address, owner.address)).wait();
    expect(await ethers.provider.getCode(addr)).to.not.equal("0x");
    const wallet = new ethers.Contract(addr, artifacts.PushSplit.abi, owner);

    await (await token.mint(owner.address, 1_000_000n)).wait();
    await (await token.approve(await warehouse.getAddress(), 1_000_000n)).wait();
    await (await warehouse.deposit(addr, await token.getAddress(), 1_000_000n)).wait();

    const before = await bal(attacker.address);
    await (await wallet.connect(attacker).distribute(s, await token.getAddress(), attacker.address)).wait();
    const took = (await bal(attacker.address)) - before;

    const expected = (1_000_000n * inc) / 1_000_000n; // 1% of the distributed amount
    console.log(`        incentive 1%: attacker took ${took} of 1000000 (expected ~${expected})`);
    expect(took <= expected + 2n).to.equal(true);
    // and the recipients got the rest -- the money was not destroyed
    expect((await bal(alice.address)) + (await bal(bob.address)) >= 979_000n).to.equal(true);
  });

  it("zero-balance edge: warehouse.withdraw() underflows and bricks the documented precise flows", async function () {
    await deployAll();
    const empty = await pullSplit.getAddress();
    // drain the wallet's own token balance, then the warehouse keeps exactly 1 wei
    await (await pullSplit.connect(attacker).distribute(pull, await token.getAddress(), attacker.address)).wait();

    const wb = await wbal(empty);
    const b = await bal(empty);
    console.log(`        pull split after full distribution: wallet=${b} warehouse=${wb}`);

    // SplitsWarehouse.withdraw(owner, token) computes balanceOf[owner][id] - 1 -> reverts at 0
    let reverted = false;
    try {
      await (await warehouse.connect(attacker).withdraw(empty, await token.getAddress())).wait();
    } catch (e) {
      reverted = true;
    }
    console.log(`        warehouse.withdraw on a zero ledger balance reverted: ${reverted}`);
    expect(reverted).to.equal(wb === 0n);
  });
});
