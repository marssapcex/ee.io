// Deploys the real IPOR protocol contracts (compiled from ../../repo) on an in-process EVM and wires
// them exactly the way test/utils/factory/IporProtocolFactory.sol does.
const { ethers } = require('ethers');
const ganache = require('ganache');
const A = require('./artifacts.json');

const E18 = 10n ** 18n;
const PAD = (n) => BigInt(n) * 10n ** 6n;

const ART = {
    MockERC20: 'mocks/Mocks.sol:MockERC20',
    MockVault: 'mocks/Mocks.sol:MockVault',
    Empty: 'mocks/Mocks.sol:Empty',
    ERC1967Proxy: 'node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy',
    IpToken: 'contracts/tokens/IpToken.sol:IpToken',
    IporOracle: 'contracts/oracles/IporOracle.sol:IporOracle',
    Spread28: 'contracts/amm/spread/Spread28Days.sol:Spread28Days',
    Spread60: 'contracts/amm/spread/Spread60Days.sol:Spread60Days',
    Spread90: 'contracts/amm/spread/Spread90Days.sol:Spread90Days',
    SpreadStorageLens: 'contracts/amm/spread/SpreadStorageLens.sol:SpreadStorageLens',
    SpreadStorageService: 'contracts/amm/spread/SpreadStorageService.sol:SpreadStorageService',
    SpreadCloseSwapService: 'contracts/amm/spread/SpreadCloseSwapService.sol:SpreadCloseSwapService',
    SpreadRouter: 'contracts/amm/spread/SpreadRouter.sol:SpreadRouter',
    AmmStorage: 'contracts/amm/AmmStorage.sol:AmmStorage',
    AmmTreasury: 'contracts/amm/AmmTreasury.sol:AmmTreasury',
    AmmPoolsService: 'contracts/amm/AmmPoolsService.sol:AmmPoolsService',
    AmmOpenSwapService: 'contracts/amm/AmmOpenSwapService.sol:AmmOpenSwapService',
    AmmCloseSwapServiceUsdc: 'contracts/amm/AmmCloseSwapServiceUsdc.sol:AmmCloseSwapServiceUsdc',
    AmmGovernanceService: 'contracts/base/amm/services/AmmGovernanceServiceBaseV1.sol:AmmGovernanceServiceBaseV1',
    Router: 'contracts/chains/ethereum/router/IporProtocolRouterEthereum.sol:IporProtocolRouterEthereum',
};

async function main(opts = {}) {
    const provider = new ethers.BrowserProvider(
        ganache.provider({
            wallet: { deterministic: true, totalAccounts: 12 },
            chain: { hardfork: 'shanghai' },
            logging: { quiet: true },
            miner: { blockGasLimit: 60_000_000 },
        })
    );
    const MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
    const wallets = [0, 1, 2, 3].map((i) =>
        ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider)
    );
    // NonceManager keeps tx nonces locally (ethers caches eth_getTransactionCount for a short window)
    const signers = wallets.map((w) => new ethers.NonceManager(w));
    const owner = signers[0];
    const lp = signers[1];
    const atk = signers[2];
    const msgSigner = signers[3];
    const records = {};

    // external libraries that must be linked into the bytecode (solc placeholder __$hash$__)
    const LINKS = {};
    const linkBytecode = (a) => {
        let bc = a.bytecode;
        for (const [file, libs] of Object.entries(a.links || {})) {
            for (const name of Object.keys(libs)) {
                const h = ethers.keccak256(ethers.toUtf8Bytes(file + ':' + name)).slice(2, 36);
                const addr = LINKS[name];
                if (!addr) throw new Error('unlinked library ' + name);
                bc = bc.split('__$' + h + '$__').join(addr.slice(2).toLowerCase());
            }
        }
        return bc;
    };
    const dep = async (key, args = [], signer = owner) => {
        const a = A[ART[key] || key];
        if (!a) throw new Error('missing artifact ' + key);
        const f = new ethers.ContractFactory(a.abi, linkBytecode(a), signer);
        const c = await f.deploy(...args);
        await c.waitForDeployment();
        return new ethers.Contract(await c.getAddress(), a.abi, owner);
    };
    const proxy = async (implAddr, iface, fn, args) => {
        const a = A[ART.ERC1967Proxy];
        const f = new ethers.ContractFactory(a.abi, a.bytecode, owner);
        const data = new ethers.Interface(iface).encodeFunctionData(fn, args);
        const c = await f.deploy(implAddr, data);
        await c.waitForDeployment();
        return await c.getAddress();
    };

    const now = (await provider.getBlock('latest')).timestamp;

    // ------------------------------------------------------------------ tokens / vault
    const usdc = await dep('MockERC20', ['USD Coin', 'USDC', 6]);
    const usdt = await dep('MockERC20', ['Tether', 'USDT', 6]);
    const dai = await dep('MockERC20', ['Dai', 'DAI', 18]);
    const vault = await dep('MockVault', [await usdc.getAddress()]);
    const vaultUsdt = await dep('MockVault', [await usdt.getAddress()]);
    const vaultDai = await dep('MockVault', [await dai.getAddress()]);
    const fake = await dep('Empty');
    const fakeAddr = await fake.getAddress();
    const usdcAddr = await usdc.getAddress();
    const vaultAddr = await vault.getAddress();
    const usdcDecimals = 6;

    const ipToken = await dep('IpToken', ['IPOR USDC', 'ipUSDC', usdcAddr]);
    const ipTokenAddr = await ipToken.getAddress();

    // ------------------------------------------------------------------ oracle
    const oracleImpl = await dep('IporOracle', [fakeAddr, E18, usdcAddr, E18, fakeAddr, E18]);
    let oracleAddr = await proxy(await oracleImpl.getAddress(), A[ART.IporOracle].abi, 'initialize', [
        [usdcAddr],
        [now - 10],
    ]);
    const oracle = new ethers.Contract(oracleAddr, A[ART.IporOracle].abi, owner);
    await (await oracle.addUpdater(await owner.getAddress())).wait();

    // ------------------------------------------------------------------ spread layer
    const spread28 = await dep('Spread28', [fakeAddr, usdcAddr, fakeAddr]);
    const spread60 = await dep('Spread60', [fakeAddr, usdcAddr, fakeAddr]);
    const spread90 = await dep('Spread90', [fakeAddr, usdcAddr, fakeAddr]);
    const storageLens = await dep('SpreadStorageLens');
    const storageService = await dep('SpreadStorageService');
    const spreadClose = await dep('SpreadCloseSwapService', [fakeAddr, usdcAddr, fakeAddr]);
    const spreadDeployed = {
        iporProtocolRouter: fakeAddr, // patched after the router exists
        spread28Days: await spread28.getAddress(),
        spread60Days: await spread60.getAddress(),
        spread90Days: await spread90.getAddress(),
        storageLens: await storageLens.getAddress(),
        closeSwapService: await spreadClose.getAddress(),
        storageService: await storageService.getAddress(),
    };

    // ------------------------------------------------------------------ router proxy (empty impl first)
    const routerDeployedFake = {
        ammSwapsLens: fakeAddr, ammPoolsLens: fakeAddr, ammPoolsLensBaseV1: fakeAddr,
        assetManagementLens: fakeAddr, ammOpenSwapService: fakeAddr,
        ammCloseSwapServiceUsdt: fakeAddr, ammCloseSwapServiceUsdc: fakeAddr,
        ammCloseSwapServiceDai: fakeAddr, ammCloseSwapLens: fakeAddr, ammPoolsService: fakeAddr,
        ammGovernanceService: fakeAddr, liquidityMiningLens: fakeAddr, powerTokenLens: fakeAddr,
        flowService: fakeAddr, stakeService: fakeAddr, stEth: fakeAddr, weEth: fakeAddr, usdm: fakeAddr,
    };
    const routerImplEmpty = await dep('Router', [routerDeployedFake]);
    const routerAddr = await proxy(await routerImplEmpty.getAddress(), A[ART.Router].abi, 'initialize', [false]);
    const router = new ethers.Contract(routerAddr, A[ART.Router].abi, owner);
    spreadDeployed.iporProtocolRouter = routerAddr;
    const spreadImpl = await dep('SpreadRouter', [spreadDeployed]);
    const spreadRouterAddr = await proxy(await spreadImpl.getAddress(), A[ART.SpreadRouter].abi, 'initialize', [false]);

    // ------------------------------------------------------------------ storage (needs the treasury address up-front)
    const soapLib = await dep('contracts/amm/libraries/SoapIndicatorRebalanceLogic.sol:SoapIndicatorRebalanceLogic');
    LINKS.SoapIndicatorRebalanceLogic = await soapLib.getAddress();

    const nonce = await owner.getNonce();
    // tx nonce+0 = ammStorage impl, +1 = ammStorage proxy, +2 = treasury impl, +3 = treasury proxy
    const treasuryAddr = ethers.getCreateAddress({ from: await owner.getAddress(), nonce: nonce + 3 });
    const ammStorageImpl2 = await dep('AmmStorage', [routerAddr, treasuryAddr]);
    const ammStorageAddr = await proxy(await ammStorageImpl2.getAddress(), A[ART.AmmStorage].abi, 'initialize', []);
    const ammStorage = new ethers.Contract(ammStorageAddr, A[ART.AmmStorage].abi, owner);

    const treasuryImpl = await dep('AmmTreasury', [usdcAddr, usdcDecimals, ammStorageAddr, vaultAddr, routerAddr]);
    const treasuryProxyAddr = await proxy(await treasuryImpl.getAddress(), A[ART.AmmTreasury].abi, 'initialize', [false]);
    if (treasuryProxyAddr.toLowerCase() !== treasuryAddr.toLowerCase()) {
        throw new Error('treasury address prediction failed ' + treasuryProxyAddr + ' != ' + treasuryAddr);
    }
    const treasury = new ethers.Contract(treasuryProxyAddr, A[ART.AmmTreasury].abi, owner);

    // ------------------------------------------------------------------ services
    const openCfg = (asset, spread) => ({
        asset,
        decimals: usdcDecimals,
        spread,
        ammStorage: ammStorageAddr,
        ammTreasury: treasuryProxyAddr,
        iporPublicationFee: 10n * E18,
        maxSwapCollateralAmount: 100_000n * E18,
        liquidationDepositAmount: 25,
        minLeverage: 10n * E18,
        openingFeeRate: opts.openingFeeRate ?? 10n ** 16n,
        openingFeeTreasuryPortionRate: 0n,
    });
    const fakeOpenCfg = {
        asset: fakeAddr,
        decimals: usdcDecimals,
        spread: fakeAddr,
        ammStorage: fakeAddr,
        ammTreasury: fakeAddr,
        iporPublicationFee: 0n,
        maxSwapCollateralAmount: 1n,
        liquidationDepositAmount: 1,
        minLeverage: 1n,
        openingFeeRate: 0n,
        openingFeeTreasuryPortionRate: 0n,
    };
    const openSvc = await dep('AmmOpenSwapService', [
        fakeOpenCfg,
        openCfg(usdcAddr, spreadRouterAddr),
        fakeOpenCfg,
        oracleAddr,
        await msgSigner.getAddress(),
        spreadRouterAddr,
    ]);
    const openSvcAddr = await openSvc.getAddress();

    const closeCfg = {
        asset: usdcAddr,
        decimals: usdcDecimals,
        ammStorage: ammStorageAddr,
        ammTreasury: treasuryProxyAddr,
        assetManagement: vaultAddr,
        spread: spreadRouterAddr,
        unwindingFeeRate: 5n * 10n ** 14n,
        unwindingFeeTreasuryPortionRate: 5n * 10n ** 14n,
        maxLengthOfLiquidatedSwapsPerLeg: 10,
        timeBeforeMaturityAllowedToCloseSwapByCommunity: 3600,
        timeBeforeMaturityAllowedToCloseSwapByBuyerTenor28days: 86400,
        timeBeforeMaturityAllowedToCloseSwapByBuyerTenor60days: 86400,
        timeBeforeMaturityAllowedToCloseSwapByBuyerTenor90days: 86400,
        minLiquidationThresholdToCloseBeforeMaturityByCommunity: 995n * 10n ** 15n,
        minLiquidationThresholdToCloseBeforeMaturityByBuyer: 99n * 10n ** 16n,
        minLeverage: 10n * E18,
        timeAfterOpenAllowedToCloseSwapWithUnwindingTenor28days: 86400,
        timeAfterOpenAllowedToCloseSwapWithUnwindingTenor60days: 86400,
        timeAfterOpenAllowedToCloseSwapWithUnwindingTenor90days: 86400,
    };
    const closeSvc = await dep('AmmCloseSwapServiceUsdc', [closeCfg, oracleAddr, await msgSigner.getAddress()]);
    const closeSvcAddr = await closeSvc.getAddress();

    const poolsCfg = {
        asset: usdcAddr,
        decimals: usdcDecimals,
        ipToken: ipTokenAddr,
        ammStorage: ammStorageAddr,
        ammTreasury: treasuryProxyAddr,
        assetManagement: vaultAddr,
        redeemFeeRate: 0n,
        redeemLpMaxCollateralRatio: E18,
    };
    const fakePoolsCfg = (asset, vault_) => ({
        asset,
        decimals: 6,
        ipToken: fakeAddr,
        ammStorage: fakeAddr,
        ammTreasury: fakeAddr,
        assetManagement: vault_,
        redeemFeeRate: 0n,
        redeemLpMaxCollateralRatio: E18,
    });
    const poolsSvc = await dep('AmmPoolsService', [
        fakePoolsCfg(await usdt.getAddress(), await vaultUsdt.getAddress()),
        poolsCfg,
        fakePoolsCfg(await dai.getAddress(), await vaultDai.getAddress()),
        oracleAddr,
    ]);
    const poolsSvcAddr = await poolsSvc.getAddress();
    const govSvc = await dep('AmmGovernanceService');
    const govSvcAddr = await govSvc.getAddress();

    // ------------------------------------------------------------------ final router implementation
    const routerDeployed = {
        ...routerDeployedFake,
        ammOpenSwapService: openSvcAddr,
        ammCloseSwapServiceUsdc: closeSvcAddr,
        ammPoolsService: poolsSvcAddr,
        ammGovernanceService: govSvcAddr,
    };
    const routerImpl = await dep('Router', [routerDeployed]);
    await (await router.upgradeTo(await routerImpl.getAddress())).wait();

    // ------------------------------------------------------------------ governance configuration (owner only)
    const govViaRouter = new ethers.Contract(routerAddr, A[ART.AmmGovernanceService].abi, owner);
    const ownerAddr = await owner.getAddress();
    await (await govViaRouter.setMessageSigner(await msgSigner.getAddress())).wait();
    await (
        await govViaRouter.setAmmGovernancePoolConfiguration(usdcAddr, {
            decimals: usdcDecimals,
            ammStorage: ammStorageAddr,
            ammTreasury: treasuryProxyAddr,
            ammVault: vaultAddr,
            ammPoolsTreasury: ownerAddr,
            ammPoolsTreasuryManager: ownerAddr,
            ammCharlieTreasury: ownerAddr,
            ammCharlieTreasuryManager: ownerAddr,
        })
    ).wait();
    await (await govViaRouter.setAmmPoolsParams(usdcAddr, 1000000000, 50, 8500)).wait();

    // ------------------------------------------------------------------ token wiring
    await (await treasury.grantMaxAllowanceForSpender(routerAddr)).wait();
    await (await treasury.grantMaxAllowanceForSpender(vaultAddr)).wait();
    await (await ipToken.setTokenManager(routerAddr)).wait();

    // ------------------------------------------------------------------ router views for the pools
    const pools = new ethers.Contract(routerAddr, A[ART.AmmPoolsService].abi, owner);
    const openViaRouter = new ethers.Contract(routerAddr, A[ART.AmmOpenSwapService].abi, owner);
    const closeViaRouter = new ethers.Contract(routerAddr, A[ART.AmmCloseSwapServiceUsdc].abi, owner);

    const give = async (signer, amount) => {
        const s = new ethers.Contract(usdcAddr, A[ART.MockERC20].abi, signer);
        await (await s.mint(await signer.getAddress(), amount)).wait();
        await (await s.approve(routerAddr, amount)).wait();
    };

    return {
        provider, owner, lp, atk,
        msgSignerWallet: wallets[3],
        msgSigner,
        P: {
            usdc: usdcAddr,
            vault: vaultAddr,
            ipToken: ipTokenAddr,
            oracle: oracleAddr,
            router: routerAddr,
            spreadRouter: spreadRouterAddr,
            storage: ammStorageAddr,
            treasury: treasuryProxyAddr,
            openSvc: openSvcAddr,
            closeSvc: closeSvcAddr,
            poolsSvc: poolsSvcAddr,
        },
        usdc, ipToken, oracle, treasury, ammStorage, pools, openViaRouter, closeViaRouter, give, dep,
    };
}

// ---------------------------------------------------------------- risk indicator signing
const RISK_BASE = {
    maxCollateralRatio: 900000000000000000n,
    maxCollateralRatioPerLeg: 480000000000000000n,
    maxLeveragePerLeg: 1000n * E18,
    baseSpreadPerLeg: 1000000000000000n,
    fixedRateCapPerLeg: 20000000000000000n,
    demandSpreadFactor: 280n,
};

function signRisk(wallet, inputs, asset, tenor, direction) {
    const packed = ethers.solidityPacked(
        ['uint256', 'uint256', 'uint256', 'int256', 'uint256', 'uint256', 'uint256', 'address', 'uint256', 'uint256'],
        [
            inputs.maxCollateralRatio,
            inputs.maxCollateralRatioPerLeg,
            inputs.maxLeveragePerLeg,
            inputs.baseSpreadPerLeg,
            inputs.fixedRateCapPerLeg,
            inputs.demandSpreadFactor,
            inputs.expiration,
            asset,
            tenor,
            direction,
        ]
    );
    const digest = ethers.keccak256(packed);
    return wallet.signingKey.sign(digest).serialized;
}

module.exports = { main, ART, E18, PAD, RISK_BASE, signRisk };
