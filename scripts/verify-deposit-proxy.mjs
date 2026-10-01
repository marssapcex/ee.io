/* eslint-disable no-console */
/**
 * E2E verification of the v3 DepositProxy contracts against the repo's OWN
 * off-chain CREATE2 computation.
 *
 * Usage (ad-hoc deps, kept out of package.json to keep the bundle lean):
 *   npm i --no-save solc@0.8.30 ganache
 *   npx tsx scripts/verify-deposit-proxy.mjs
 *
 * Exits 1 on any check failure. Proves:
 *   1. deploy logic + factory on a local ganache
 *   2. computeDepositAddressBound (server TS) === factory.computeAddress(saltFor) — if these
 *      ever disagree, users would fund addresses that can never be deployed
 *   3. failed router call → atomic refund to destination (v3 fix)
 *   4. successful swap → output forwarded to destination
 *   5. self-service refund() by the destination wallet (v3 fix)
 */
import ganache from 'ganache';
import { ethers } from 'ethers';
import solc from 'solc';
import { readFileSync } from 'fs';

// ---- compile repo contracts + mocks ------------------------------------
const mocks = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IMint { function mint(address to, uint256 amount) external; }
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transfer(address to, uint256 value) external returns (bool) { require(balanceOf[msg.sender] >= value, "bal"); balanceOf[msg.sender] -= value; balanceOf[to] += value; return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(allowance[from][msg.sender] >= value, "allow");
        require(balanceOf[from] >= value, "balf");
        allowance[from][msg.sender] -= value; balanceOf[from] -= value; balanceOf[to] += value; return true;
    }
}
contract GoodRouter {
    function buyTokens(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external {
        (bool ok1, ) = tokenIn.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amountIn));
        require(ok1, "pull failed");
        IMint(tokenOut).mint(msg.sender, amountOut);
    }
}
contract BadRouter {
    fallback() external payable { revert("router says no"); }
    receive() external payable {}
}
`;

const input = {
  language: 'Solidity',
  sources: {
    'contracts/DepositProxy.sol': { content: readFileSync(new URL('../contracts/DepositProxy.sol', import.meta.url), 'utf8') },
    'contracts/DepositProxyFactory.sol': { content: readFileSync(new URL('../contracts/DepositProxyFactory.sol', import.meta.url), 'utf8') },
    'mocks.sol': { content: mocks },
  },
  settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errs.length) { console.error(errs.map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const art = (name, file) => ({
  abi: out.contracts[file][name].abi,
  bytecode: '0x' + out.contracts[file][name].evm.bytecode.object,
});

// ---- chain ---------------------------------------------------------------
const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } }));
const network = await provider.getNetwork();
const chainId = Number(network.chainId);
const [relayer, destination, griefer] = await provider.listAccounts();
const rel = await provider.getSigner(relayer.address ?? relayer);
const dest = await provider.getSigner(destination.address ?? destination);

const deploy = async (wallet, artifact, ...args) => {
  const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
};

const tokenIn = await deploy(rel, art('MockERC20', 'mocks.sol'));
const tokenOut = await deploy(rel, art('MockERC20', 'mocks.sol'));
const goodRouter = await deploy(rel, art('GoodRouter', 'mocks.sol'));
const badRouter = await deploy(rel, art('BadRouter', 'mocks.sol'));
const logic = await deploy(rel, art('DepositProxy', 'contracts/DepositProxy.sol'));
const factory = await deploy(rel, art('DepositProxyFactory', 'contracts/DepositProxyFactory.sol'), await logic.getAddress());
await (await factory.setRouterAllowed(await goodRouter.getAddress(), true)).wait();
await (await factory.setRouterAllowed(await badRouter.getAddress(), true)).wait();

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ---- 2. off-chain vs on-chain address agreement --------------------------
const { computeDepositAddressBound } = await import(new URL('../server/depositProxy.ts', import.meta.url).pathname);
process.env.EE_PROXY_FACTORY = await factory.getAddress();
process.env.EE_PROXY_LOGIC = await logic.getAddress();

const orderId = 'DP-000001';
const destAddr = destination.address ?? destination;
const offChain = computeDepositAddressBound(
  orderId, destAddr, await tokenIn.getAddress(), await tokenOut.getAddress(), chainId,
);
const onChain = await factory.computeAddressForOrder(orderId, destAddr, await tokenIn.getAddress(), await tokenOut.getAddress());
console.log('off-chain :', offChain);
console.log('on-chain  :', onChain);
console.log(offChain.toLowerCase() === onChain.toLowerCase() ? 'PASS  CREATE2 parity' : 'FAIL  CREATE2 parity MISMATCH');
if (offChain.toLowerCase() !== onChain.toLowerCase()) process.exit(1);

// ---- 3. failed router → atomic refund ------------------------------------
const amountIn = 1_000_000n;
await (await tokenIn.mint(offChain, amountIn)).wait(); // fund counterfactual address BEFORE deploy
await (await factory.createProxyForOrder(orderId, await tokenIn.getAddress(), await tokenOut.getAddress(), destAddr, 0n)).wait();
const proxy = new ethers.Contract(offChain, art('DepositProxy', 'contracts/DepositProxy.sol').abi, rel);

const before = await tokenIn.balanceOf(destAddr);
const badIface = new ethers.Interface(['function anything()']);
const tx1 = await proxy.execute(await badRouter.getAddress(), badIface.encodeFunctionData('anything'), await factory.saltFor(orderId, destAddr, await tokenIn.getAddress(), await tokenOut.getAddress()));
const r1 = await tx1.wait();
const refundedEvt = r1.logs.some((l) => l.topics[0] === ethers.id('Refunded(address,uint256,address)'));
const after = await tokenIn.balanceOf(destAddr);
console.log(after - before === amountIn && refundedEvt
  ? 'PASS  failed swap refunds input atomically to destination'
  : `FAIL  failed-swap refund (delta=${after - before}, event=${refundedEvt})`);
if (!(after - before === amountIn && refundedEvt)) process.exit(1);

// ---- 4. successful swap forwards output ----------------------------------
const orderId2 = 'DP-000002';
const addr2 = computeDepositAddressBound(orderId2, destAddr, await tokenIn.getAddress(), await tokenOut.getAddress(), chainId);
await (await tokenIn.mint(addr2, amountIn)).wait();
await (await factory.createProxyForOrder(orderId2, await tokenIn.getAddress(), await tokenOut.getAddress(), destAddr, 0n)).wait();
const proxy2 = new ethers.Contract(addr2, art('DepositProxy', 'contracts/DepositProxy.sol').abi, rel);
const goodIface = new ethers.Interface(['function buyTokens(address,uint256,address,uint256)']);
const outAmount = 950_000n;
const data = goodIface.encodeFunctionData('buyTokens', [await tokenIn.getAddress(), amountIn, await tokenOut.getAddress(), outAmount]);
const outBefore = await tokenOut.balanceOf(destAddr);
const tx2 = await proxy2.execute(await goodRouter.getAddress(), data, await factory.saltFor(orderId2, destAddr, await tokenIn.getAddress(), await tokenOut.getAddress()));
await tx2.wait();
const outAfter = await tokenOut.balanceOf(destAddr);
console.log(outAfter - outBefore === outAmount
  ? 'PASS  successful swap forwards output to destination'
  : `FAIL  swap forwarding (delta=${outAfter - outBefore})`);
if (outAfter - outBefore !== outAmount) process.exit(1);

// ---- 5. self-service refund() with native ETH -----------------------------
const orderId3 = 'DP-000003';
const addr3 = computeDepositAddressBound(orderId3, destAddr, NATIVE, await tokenOut.getAddress(), chainId);
await (await rel.sendTransaction({ to: addr3, value: ethers.parseEther('0.5') })).wait(); // fund counterfactual
await (await factory.createProxyForOrder(orderId3, NATIVE, await tokenOut.getAddress(), destAddr, 0n)).wait();
const proxy3 = new ethers.Contract(addr3, art('DepositProxy', 'contracts/DepositProxy.sol').abi, dest);
const ethBefore = await provider.getBalance(destAddr);
const tx3 = await proxy3.refund();
const r3 = await tx3.wait();
const gasPaid = r3.gasUsed * r3.gasPrice;
const ethAfter = await provider.getBalance(destAddr);
const gained = ethAfter - ethBefore + gasPaid;
console.log(gained === ethers.parseEther('0.5')
  ? 'PASS  refund() self-rescue by destination returns the native deposit'
  : `FAIL  refund() self-rescue (gained=${gained})`);
if (gained !== ethers.parseEther('0.5')) process.exit(1);

// ---- 6. griefer cannot redirect refunds via depositor slot ----------------
const orderId4 = 'DP-000004';
const addr4 = computeDepositAddressBound(orderId4, destAddr, NATIVE, await tokenOut.getAddress(), chainId);
const gr = await provider.getSigner(griefer.address ?? griefer);
await (await gr.sendTransaction({ to: addr4, value: 1n })).wait();          // grief: 1 wei first
await (await rel.sendTransaction({ to: addr4, value: ethers.parseEther('1') })).wait(); // victim funds
await (await factory.createProxyForOrder(orderId4, NATIVE, await tokenOut.getAddress(), destAddr, 2n ** 200n)).wait(); // insane minOut? no — use refund()
const proxy4d = new ethers.Contract(addr4, art('DepositProxy', 'contracts/DepositProxy.sol').abi, dest);
const depSlot = await proxy4d.depositor();
const eb = await provider.getBalance(destAddr);
await (await proxy4d.refund()).wait();
const ea = await provider.getBalance(destAddr);
const victimGot = ea - eb;
const grieferGot = await provider.getBalance(addr4);
console.log(victimGot >= ethers.parseEther('0.99') && grieferGot === 0n
  ? `PASS  depositor griefing neutralised (depositor slot = ${depSlot.slice(0, 10)}…, refund went to destination)`
  : `FAIL  griefing check (victim=${victimGot}, left=${grieferGot})`);
if (!(victimGot >= ethers.parseEther('0.99') && grieferGot === 0n)) process.exit(1);

console.log('\nALL CONTRACT E2E CHECKS PASSED');
process.exit(0);
