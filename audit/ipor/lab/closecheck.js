const { ethers } = require('ethers');
const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');
const TENOR = 2n, DAYS = 90n, INDEX = 5n * 10n ** 16n;
(async () => {
  const c = await main({ openingFeeRate: 5n * 10n ** 14n });
  const { P, usdc, ipToken, oracle, ammStorage, provider, atk, lp, msgSignerWallet, pools, openViaRouter, closeViaRouter } = c;
  const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
  await c.give(lp, PAD(1_000_000)); await c.give(atk, PAD(1_000_000));
  await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(1_000_000), { gasLimit: 5e6 })).wait();
  await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
  const COLL = PAD(74_000);
  const k = (1000n * E18 * 5n * 10n ** 14n * DAYS) / (365n * E18);
  const totalUsdc = ((COLL * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
  await c.give(atk, totalUsdc);
  const now = BigInt((await provider.getBlock('latest')).timestamp);
  const ins = { ...RISK_BASE, expiration: now + 3600n };
  await (await openViaRouter.connect(atk).openSwapReceiveFixed90daysUsdc(atkAddr, totalUsdc, 0n, 1000n * E18,
     { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, TENOR, 1n) }, { gasLimit: 9e6 })).wait();
  const swap = await ammStorage.getSwap(1, 1);
  console.log('opened: notional', swap.notional.toString(), 'coll', swap.collateral.toString(), 'fixed', swap.fixedInterestRate.toString(), 'tenor', swap.tenor);
  await provider.send('evm_increaseTime', [Number(DAYS) * 86400 + 60]); await provider.send('evm_mine', []);
  const t = BigInt((await provider.getBlock('latest')).timestamp);
  const mk = (dir, spread) => { const i = { ...RISK_BASE, baseSpreadPerLeg: spread, expiration: t + 3600n }; return { ...i, signature: signRisk(msgSignerWallet, i, P.usdc, TENOR, dir) }; };
  const before = await usdc.balanceOf(atkAddr);
  const lpBefore = (await ammStorage.getBalance()).liquidityPool;
  try {
    await closeViaRouter.connect(atk).closeSwapsUsdc.staticCall(atkAddr, [], [1], { payFixed: mk(0n, 10n ** 15n), receiveFixed: mk(1n, -(10n ** 15n)) }, { gasLimit: 9e6 });
    const rc = await (await closeViaRouter.connect(atk).closeSwapsUsdc(atkAddr, [], [1], { payFixed: mk(0n, 10n ** 15n), receiveFixed: mk(1n, -(10n ** 15n)) }, { gasLimit: 9e6 })).wait();
    console.log('CLOSE OK gas', rc.gasUsed.toString(), 'buyer_received', ((await usdc.balanceOf(atkAddr)) - before).toString()/1e6, 'liquidityPool before', Number(lpBefore)/1e18, 'after', Number((await ammStorage.getBalance()).liquidityPool)/1e18);
  } catch (e) { console.log('CLOSE FAIL:', e.shortMessage, e.data || ''); }
})().catch(e => console.error('FAIL', e.shortMessage || e.message));
