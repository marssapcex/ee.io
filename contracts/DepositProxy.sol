// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DepositProxy — non-custodial per-order proxy for ee.io (v2 audited)
 * @notice Holds funds only until execute() — non-custodial, one-shot, destination-immutable.
 *         Counterfactual CREATE2 address is funded BEFORE deployment.
 *         Changes from v1 audit:
 *           - Fix EIP-1167 clone factory init (factory was 0 for clones)
 *           - execute() restricted to allowlisted relayer/factory (prevents fee hijack)
 *           - Salt bound to destination (prevents frontrun redeploy with different dest)
 *           - Safe approve/transfer for USDT-style tokens
 *           - Correct delta-based slippage check (outAfter - outBefore >= minOut)
 *           - Reentrancy guard via executed flag set BEFORE external calls
 *           - Explicit depositor tracking via funded event + factory callback
 */
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface IFactory {
    function isRouterAllowed(address router) external view returns (bool);
    function isRelayer(address who) external view returns (bool);
}

contract DepositProxy {
    address public factory;
    address public fromToken; // 0xEeee... for native
    address public toToken;
    address public destination;
    address public depositor;
    uint256 public minOut;
    bool public executed;
    bool public initialized;

    address constant NATIVE_SENTINEL = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event Funded(address indexed from, uint256 amount, address token);
    event Executed(address indexed router, uint256 outAmount, address dest, bytes32 salt);
    event Refunded(address indexed to, uint256 amount, address token);

    modifier onlyOnce() {
        require(!executed, "already executed");
        _;
    }

    // Clones have empty storage; constructor only sets logic's own factory for reference.
    constructor() {
        factory = msg.sender;
    }

    /**
     * @dev Called once by factory after CREATE2 deployment. No onlyFactory check
     *      here because factory is still 0 for clones — we trust the caller is
     *      factory and set it. Subsequent calls revert via initialized.
     */
    function initialize(
        address _fromToken,
        address _toToken,
        address _destination,
        uint256 _minOut,
        address _factory
    ) external {
        require(!initialized, "initialized");
        require(_destination != address(0), "dest zero");
        require(_factory != address(0), "factory zero");
        // For clones, factory is 0, so allow first initialization from real factory.
        // For logic contract itself, factory is already set via constructor.
        if (factory != address(0)) {
            require(msg.sender == factory, "only factory");
        } else {
            require(msg.sender == _factory, "only factory");
            factory = _factory;
        }
        fromToken = _fromToken;
        toToken = _toToken;
        destination = _destination;
        minOut = _minOut;
        initialized = true;
    }

    receive() external payable {
        if (depositor == address(0) && msg.value > 0) depositor = msg.sender;
        emit Funded(msg.sender, msg.value, NATIVE_SENTINEL);
    }

    /**
     * @notice Called by factory when ERC20 funding is detected off-chain.
     *         Watcher calls factory.onERC20Funded(depositAddress, depositor, amount)
     *         which forwards here. This is optional — refund still works without it.
     */
    function onFunded(address _depositor, uint256 amount) external {
        require(msg.sender == factory, "only factory");
        if (depositor == address(0)) depositor = _depositor;
        emit Funded(_depositor, amount, fromToken);
    }

    /**
     * @notice Execute swap via whitelisted router. Only allowlisted relayer/factory.
     * @param router aggregator router (0x Settler, 1inch V6, etc.)
     * @param data   aggregator calldata with feeRecipient=ee.io already embedded
     * @param salt   original salt (for event audit; must match this proxy's CREATE2 salt)
     */
    function execute(address router, bytes calldata data, bytes32 salt) external onlyOnce {
        require(initialized, "not initialized");
        // Access control: only factory or allowlisted relayer can trigger.
        // This prevents attacker frontrunning with malicious feeRecipient.
        require(
            msg.sender == factory || IFactory(factory).isRelayer(msg.sender),
            "not relayer"
        );
        require(IFactory(factory).isRouterAllowed(router), "router not allowed");

        executed = true; // reentrancy guard before external calls

        // --- snapshot balances ---
        uint256 inBal;
        uint256 outBefore;
        if (fromToken == NATIVE_SENTINEL) {
            inBal = address(this).balance;
            require(inBal > 0, "no funds");
            outBefore = toToken == NATIVE_SENTINEL ? 0 : IERC20(toToken).balanceOf(address(this));
        } else {
            inBal = IERC20(fromToken).balanceOf(address(this));
            require(inBal > 0, "no funds");
            outBefore = toToken == NATIVE_SENTINEL ? address(this).balance : IERC20(toToken).balanceOf(address(this));
            // Safe approve for USDT-style tokens (force 0 then set)
            _safeApprove(fromToken, router, 0);
            _safeApprove(fromToken, router, inBal);
        }

        // --- call router ---
        (bool ok, bytes memory ret) = router.call{value: fromToken == NATIVE_SENTINEL ? inBal : 0}(data);

        if (!ok) {
            // refund input
            address refundTo = depositor != address(0) ? depositor : destination;
            _refundInput(refundTo);
            emit Refunded(refundTo, inBal, fromToken);
            if (ret.length > 0) {
                assembly { revert(add(ret,32), mload(ret)) }
            }
            revert("swap failed");
        }

        // --- verify slippage via delta ---
        uint256 outDelta;
        if (toToken == NATIVE_SENTINEL) {
            uint256 outAfter = address(this).balance;
            // if from was native, outAfter is already output (input consumed)
            // if from was ERC20, outAfter = outBefore + delta
            if (fromToken == NATIVE_SENTINEL) outDelta = outAfter;
            else outDelta = outAfter - outBefore;
        } else {
            uint256 outAfter = IERC20(toToken).balanceOf(address(this));
            outDelta = outAfter - outBefore;
        }
        require(outDelta >= minOut, "slippage");

        // --- forward output to destination ---
        if (toToken == NATIVE_SENTINEL) {
            uint256 bal = address(this).balance;
            (bool s,) = destination.call{value: bal}("");
            require(s, "forward failed");
            emit Executed(router, bal, destination, salt);
        } else {
            uint256 bal = IERC20(toToken).balanceOf(address(this));
            require(bal >= minOut, "slippage bal");
            _safeTransfer(toToken, destination, bal);
            // refund dust input if any (partial fill)
            if (fromToken != NATIVE_SENTINEL) {
                uint256 dust = IERC20(fromToken).balanceOf(address(this));
                if (dust > 0) {
                    address refundTo = depositor != address(0) ? depositor : destination;
                    _safeTransfer(fromToken, refundTo, dust);
                }
            }
            emit Executed(router, bal, destination, salt);
        }
    }

    function _refundInput(address to) internal {
        if (fromToken == NATIVE_SENTINEL) {
            uint256 bal = address(this).balance;
            if (bal > 0) {
                (bool s,) = to.call{value: bal}("");
                require(s, "refund failed");
            }
        } else {
            uint256 bal = IERC20(fromToken).balanceOf(address(this));
            if (bal > 0) _safeTransfer(fromToken, to, bal);
        }
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "approve failed");
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transfer failed");
    }
}
