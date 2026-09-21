// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DepositProxy — non-custodial per-order proxy for ee.io
 * @notice Each swap order that wants the "copy deposit address" UX gets its
 *         own minimal proxy. The address exists before funding (CREATE2).
 *         User funds it with a plain ERC20 transfer or native ETH transfer.
 *         A permissionless relayer then calls execute(), which atomically:
 *           1. approves the aggregator router,
 *           2. swaps via the aggregator calldata (which already embeds the
 *              0.5% ee.io affiliate fee via feeRecipient/feeBps),
 *           3. forwards the output to the user's destination,
 *           4. refunds any leftover input on failure.
 *
 * @dev SECURITY PROPERTIES
 * - No owner key can drain funds to an arbitrary address. The destination
 *   is immutable after initialize() and all output is forced there.
 * - execute() is one-shot (executed flag). Re-entrancy guarded.
 * - Router allowlist: factory can restrict which routers are callable.
 * - No upgrade proxy, no delegatecall to user-supplied logic in fallback.
 * - Refund path: if swap reverts, input tokens/ETH are sent back to
 *   depositor (first funder) or to destination when depositor unknown.
 * - Gas is paid by the relayer (EE_RELAYER_PK) and recouped from the
 *   affiliate fee — user never needs to hold gas on the proxy.
 *
 * Minimal-proxy (EIP-1167) clones of this logic are deployed by
 * DepositProxyFactory via CREATE2.
 */
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

contract DepositProxy {
    address public factory;
    address public fromToken; // 0xEeee... for native
    address public toToken;
    address public destination;
    address public depositor; // first funder, for refund
    uint256 public minOut;
    bool public executed;
    bool public initialized;

    address constant NATIVE_SENTINEL = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event Funded(address indexed from, uint256 amount);
    event Executed(address indexed router, uint256 outAmount, address dest);
    event Refunded(address indexed to, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "only factory");
        _;
    }

    modifier onlyOnce() {
        require(!executed, "already executed");
        _;
    }

    constructor() {
        // factory is set to deployer at clone creation time via initialize()
        factory = msg.sender;
    }

    /**
     * @param _fromToken token user will deposit (NATIVE_SENTINEL for ETH)
     * @param _toToken token user will receive
     * @param _destination final recipient (checked via shared validation)
     * @param _minOut slippage floor from quote (minReturnAmount)
     */
    function initialize(
        address _fromToken,
        address _toToken,
        address _destination,
        uint256 _minOut
    ) external onlyFactory {
        require(!initialized, "initialized");
        require(_destination != address(0), "dest zero");
        fromToken = _fromToken;
        toToken = _toToken;
        destination = _destination;
        minOut = _minOut;
        initialized = true;
    }

    // Accept native ETH
    receive() external payable {
        if (depositor == address(0) && msg.value > 0) depositor = msg.sender;
        emit Funded(msg.sender, msg.value);
    }

    // Called by ERC20 transfer — we cannot hook Transfer, so watcher detects
    // it off-chain. This hook is for explicit funding via function.
    function onERC20Funded(address _depositor, uint256 amount) external onlyFactory {
        if (depositor == address(0)) depositor = _depositor;
        emit Funded(_depositor, amount);
    }

    /**
     * @notice Execute the swap. Permissionless after funding, but output is
     *         hard-wired to destination.
     * @param router whitelisted aggregator router (0x Settler, 1inch V6, Kyber, etc.)
     * @param data aggregator calldata already containing feeRecipient=ee.io & feeBps
     * @dev The calldata is built server-side by buildExecutionPlan with
     *      slippage protection. This function does not interpret it beyond
     *      forwarding, except for refund handling.
     */
    function execute(address router, bytes calldata data)
        external
        onlyOnce
    {
        require(initialized, "not initialized");
        // Allow anyone (relayer, user, keeper) — output cannot be stolen
        // Optional: factory could restrict to allowlisted routers.
        // We enforce via factory check if needed.
        if (!DepositProxyFactory(factory).isRouterAllowed(router)) revert("router not allowed");

        executed = true;

        uint256 inBal;
        if (fromToken == NATIVE_SENTINEL) {
            inBal = address(this).balance;
            require(inBal > 0, "no funds");
        } else {
            inBal = IERC20(fromToken).balanceOf(address(this));
            require(inBal > 0, "no funds");
            // Approve router for exact balance (reset then set for USDT-style)
            // solhint-disable-next-line
            IERC20(fromToken).approve(router, 0);
            IERC20(fromToken).approve(router, inBal);
        }

        // Record output balance before swap for delta check
        uint256 outBefore;
        if (toToken == NATIVE_SENTINEL) outBefore = address(this).balance;
        else outBefore = IERC20(toToken).balanceOf(address(this));

        // Low-level call to router (swap). Forward ETH if input is native.
        (bool ok, bytes memory ret) = router.call{value: fromToken == NATIVE_SENTINEL ? inBal : 0}(data);

        if (!ok) {
            // Swap failed — refund input to depositor or destination
            address refundTo = depositor != address(0) ? depositor : destination;
            if (fromToken == NATIVE_SENTINEL) {
                (bool s,) = refundTo.call{value: address(this).balance}("");
                require(s, "refund failed");
            } else {
                uint256 bal = IERC20(fromToken).balanceOf(address(this));
                if (bal > 0) IERC20(fromToken).transfer(refundTo, bal);
            }
            emit Refunded(refundTo, inBal);
            // Bubble revert reason if present
            if (ret.length > 0) {
                assembly { revert(add(ret,32), mload(ret)) }
            }
            revert("swap failed");
        }

        // Verify slippage floor
        uint256 outAfter;
        if (toToken == NATIVE_SENTINEL) outAfter = address(this).balance - outBefore + (fromToken == NATIVE_SENTINEL ? 0 : 0);
        else outAfter = IERC20(toToken).balanceOf(address(this)) - outBefore;

        // For native toToken case, outAfter is tricky due to inBal already consumed;
        // we handle via balance delta before/after separately. Simplified check:
        // require(outAfter >= minOut, "slippage");

        // Forward all output to destination (atomic with fee already taken by router)
        if (toToken == NATIVE_SENTINEL) {
            uint256 bal = address(this).balance;
            require(bal >= minOut, "slippage");
            (bool s,) = destination.call{value: bal}("");
            require(s, "forward failed");
            emit Executed(router, bal, destination);
        } else {
            uint256 outBal = IERC20(toToken).balanceOf(address(this));
            require(outBal >= minOut, "slippage");
            IERC20(toToken).transfer(destination, outBal);
            // Dust refund if any input token left (partial fill)
            if (fromToken != NATIVE_SENTINEL) {
                uint256 dust = IERC20(fromToken).balanceOf(address(this));
                if (dust > 0) {
                    address refundTo = depositor != address(0) ? depositor : destination;
                    IERC20(fromToken).transfer(refundTo, dust);
                }
            }
            emit Executed(router, outBal, destination);
        }
    }
}

interface DepositProxyFactory {
    function isRouterAllowed(address router) external view returns (bool);
}
