// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";

/// PoC for F-<n>: <one line>
/// Run:   forge test --match-contract <Name> -vvv
/// Pass:  the three console.log numbers below must move in the direction the trace claims.
contract PocTest is Test {
    address attacker = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC_URL"), vm.envOr("FORK_BLOCK", uint256(0)));
        vm.label(attacker, "attacker");
    }

    function test_drain() public {
        uint256 before_attacker = 0; // token.balanceOf(attacker)
        uint256 before_victim = 0;   // treasury / pool

        vm.startPrank(attacker);
        // 1. ...
        // 2. ...
        vm.stopPrank();

        uint256 after_attacker = 0;
        uint256 after_victim = 0;

        console2.log("attacker delta", after_attacker - before_attacker);
        console2.log("victim  delta", before_victim - after_victim);

        assertGt(after_attacker, before_attacker, "attacker did not profit");
    }
}
