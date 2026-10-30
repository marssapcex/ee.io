// Off-chain replica of AmmLib.getSoap / AmmLib.getExchangeRate, used only to print the mark at
// arbitrary timestamps without touching state. Validated against a real redeem probe in capital.js.
const { E18 } = require('./poc');

const YEAR = 31536000n;

// e^x in 18-dec fixed point (x is 18-dec, |x| < ~1)
function exp18(x) {
    let term = E18;
    let sum = E18;
    for (let i = 1n; i <= 40n; i++) {
        term = (term * x) / (E18 * i);
        sum += term;
        if (term === 0n) break;
    }
    return sum;
}

// InterestRates.addContinuousCompoundInterestUsingRatePeriodMultiplication(value, rate * timeInSeconds)
function compound(value, rate18, dtSeconds) {
    const years = (rate18 * dtSeconds) / YEAR; // 18-dec rate for the period
    return (value * exp18(years)) / E18;
}

// SoapIndicatorLogic.calculateHypotheticalInterestTotal
function hypotheticalTotal(si, timestamp) {
    const r = BigInt(si.rebalanceTimestamp);
    const dt = BigInt(timestamp) - r;
    const notional = BigInt(si.totalNotional) + BigInt(si.hypotheticalInterestCumulative);
    return BigInt(si.hypotheticalInterestCumulative) + (compound(notional, BigInt(si.averageInterestRate), dt) - notional);
}

// AmmLib.getSoap  (ibtPrice comes from IporOracle.calculateAccruedIbtPrice, read on chain)
function soapAt(pf, rf, timestamp, ibtPrice) {
    const pfSoap =
        (BigInt(pf.totalIbtQuantity) * ibtPrice) / E18 -
        (BigInt(pf.totalNotional) + hypotheticalTotal(pf, timestamp));
    const rfSoap =
        BigInt(rf.totalNotional) +
        hypotheticalTotal(rf, timestamp) -
        (BigInt(rf.totalIbtQuantity) * ibtPrice) / E18;
    return { pfSoap, rfSoap, soap: pfSoap + rfSoap };
}

// AmmLib.getExchangeRate
function exchangeRate(liquidityPool, soap, ipTokenSupply) {
    const balance = BigInt(liquidityPool) - soap;
    if (balance <= 0n) return 0n;
    return (balance * E18) / BigInt(ipTokenSupply);
}

module.exports = { exp18, compound, hypotheticalTotal, soapAt, exchangeRate, YEAR };
