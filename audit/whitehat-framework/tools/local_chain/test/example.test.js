const { expect } = require("chai");
const { ethers, network } = require("hardhat");


describe("local chain: deploy + exploit + inject state (no fork)", function () {
  it("reentrancy drains a vault that holds other users' deposits", async function () {
    const [deployer, alice, bob] = await ethers.getSigners();
    const V = await ethers.getContractFactory("Vault");
    const v = await V.deploy();
    await v.waitForDeployment();

    // --- simulated TVL: two honest users deposit 5 ETH each
    await v.connect(alice).deposit({ value: ethers.parseEther("5") });
    await v.connect(bob).deposit({ value: ethers.parseEther("5") });

    const A = await ethers.getContractFactory("Attacker");
    const a = await A.deploy(await v.getAddress(), { value: ethers.parseEther("1") });
    await a.waitForDeployment();

    await a.hit();

    const got = await ethers.provider.getBalance(await a.getAddress());
    console.log("      vault left :", ethers.formatEther(await ethers.provider.getBalance(await v.getAddress())), "ETH");
    console.log("      attacker   :", ethers.formatEther(got), "ETH");
    expect(got > ethers.parseEther("5")).to.equal(true); // took the victims' money
  });

  it("inject mainnet-like state WITHOUT a fork: setBalance / setStorageAt / impersonate", async function () {
    // this is the answer to "no real state": you can write the state in by hand
    const whale = "0x1111111111111111111111111111111111111111";
    await network.provider.send("hardhat_setBalance", [whale, "0x" + (10n ** 21n).toString(16)]);
    console.log("      whale balance injected:", ethers.formatEther(await ethers.provider.getBalance(whale)), "ETH");

    await network.provider.send("hardhat_impersonateAccount", [whale]);
    const signer = await ethers.getSigner(whale);
    const V = await ethers.getContractFactory("Vault");
    const v = await V.deploy();
    await v.waitForDeployment();
    await v.connect(signer).deposit({ value: ethers.parseEther("900") });
    console.log("      whale deposited 900 ETH as a fake LP:", ethers.formatEther(await v.bal(whale)));
    expect(await v.bal(whale)).to.equal(ethers.parseEther("900"));

    // and raw storage can be written too (slot = keccak(key, pos) for a mapping):
    await network.provider.send("hardhat_setStorageAt", [await v.getAddress(), "0x" + "0".repeat(64), "0x" + (5).toString(16).padStart(64, "0")]);
    await network.provider.send("hardhat_mine", ["0x10"]); // skip 16 blocks
    console.log("      block number after hardhat_mine:", await ethers.provider.getBlockNumber());
  });

  it("invariant + mini-fuzz over random deposit sizes", async function () {
    const V = await ethers.getContractFactory("Vault");
    const v = await V.deploy();
    await v.waitForDeployment();
    const signers = await ethers.getSigners();

    let sum = 0n;
    for (let i = 0; i < 25; i++) {
      const who = signers[i % 5];
      const amt = BigInt(Math.floor(Math.random() * 1e15)) + 1n; // 0..0.001 ETH
      await v.connect(who).deposit({ value: amt });
      sum += amt;
    }
    const bal = await ethers.provider.getBalance(await v.getAddress());
    console.log("      fuzz sum:", ethers.formatEther(sum), "contract:", ethers.formatEther(bal));
    expect(bal).to.equal(sum); // invariant: balance == sum of credits
  });
});