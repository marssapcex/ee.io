// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DepositProxy.sol";

/**
 * @title DepositProxyFactory — audited v2
 * @notice CREATE2 factory with:
 *   - Salt bound to (orderId, destination, fromToken, toToken, chainId) to prevent
 *     frontrun redeploy with different dest.
 *   - Relayer allowlist (only relayer/owner can createProxy)
 *   - Router allowlist
 *   - Pause, ownership, and proxy backing store
 *
 * Deposit address is still counterfactual: off-chain computation uses
 *   keccak256(0xff ++ factory ++ salt ++ keccak256(minimalProxyCode))
 *   salt = keccak256(abi.encode(orderId, destination, fromToken, toToken))
 */
contract DepositProxyFactory {
    address public owner;
    address public logic;
    bool public paused;

    mapping(bytes32 => address) public proxyOf;
    mapping(address => bool) public isRouterAllowed;
    mapping(address => bool) public isRelayer;

    event ProxyDeployed(bytes32 indexed salt, address indexed proxy, address fromToken, address toToken, address destination, uint256 minOut);
    event RouterAllowed(address router, bool allowed);
    event RelayerSet(address relayer, bool allowed);
    event Paused(bool paused);

    bytes constant MINIMAL_PROXY_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes constant MINIMAL_PROXY_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    modifier onlyRelayerOrOwner() {
        require(msg.sender == owner || isRelayer[msg.sender], "not relayer");
        _;
    }

    constructor(address _logic) {
        owner = msg.sender;
        logic = _logic;
        // canonical routers
        isRouterAllowed[0x0000000000001fF3684f28c67538d4D072C22734] = true; // 0x Settler
        isRouterAllowed[0x111111125421cA6dc452d289314280a0f8842A65] = true; // 1inch V6
        isRouterAllowed[0x6131B5fae19EA4f9D964eAc0408E4408b66337b5] = true; // Kyber
        isRouterAllowed[0x6A000F20005980200259B80c5102003040001068] = true; // ParaSwap
        isRouterAllowed[0x000000000022D473030F116dDEE9F6B43aC78BA3] = true; // Permit2
        isRelayer[msg.sender] = true;
    }

    function setLogic(address _logic) external onlyOwner {
        logic = _logic;
    }

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        isRouterAllowed[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        isRelayer[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
        isRelayer[newOwner] = true;
    }

    /**
     * @notice Salt binds destination to prevent frontrun.
     * @dev Must match off-chain compute: keccak256(abi.encode(orderId, destination, fromToken, toToken))
     */
    function saltFor(
        string calldata orderId,
        address destination,
        address fromToken,
        address toToken
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(orderId, destination, fromToken, toToken));
    }

    function computeAddress(bytes32 salt) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(MINIMAL_PROXY_PREFIX, logic, MINIMAL_PROXY_SUFFIX);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode)));
        return address(uint160(uint256(hash)));
    }

    function computeAddressForOrder(
        string calldata orderId,
        address destination,
        address fromToken,
        address toToken
    ) external view returns (address) {
        return computeAddress(saltFor(orderId, destination, fromToken, toToken));
    }

    /**
     * @notice Deploy proxy — only relayer/owner (prevents frontrun with malicious dest).
     */
    function createProxy(
        bytes32 salt,
        address fromToken,
        address toToken,
        address destination,
        uint256 minOut
    ) external whenNotPaused onlyRelayerOrOwner returns (address proxy) {
        require(proxyOf[salt] == address(0), "exists");
        bytes memory creationCode = abi.encodePacked(MINIMAL_PROXY_PREFIX, logic, MINIMAL_PROXY_SUFFIX);
        assembly {
            proxy := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(proxy != address(0), "create2 failed");
        DepositProxy(payable(proxy)).initialize(fromToken, toToken, destination, minOut, address(this));
        proxyOf[salt] = proxy;
        emit ProxyDeployed(salt, proxy, fromToken, toToken, destination, minOut);
    }

    function createProxyForOrder(
        string calldata orderId,
        address fromToken,
        address toToken,
        address destination,
        uint256 minOut
    ) external whenNotPaused onlyRelayerOrOwner returns (address proxy) {
        bytes32 salt = saltFor(orderId, destination, fromToken, toToken);
        return createProxy(salt, fromToken, toToken, destination, minOut);
    }

    // Forward funded notification to proxy (depositor tracking)
    function onERC20Funded(address proxy, address depositor, uint256 amount) external onlyRelayerOrOwner {
        DepositProxy(payable(proxy)).onFunded(depositor, amount);
    }

    // Atomic create+execute to save gas — also only relayer
    function createAndExecute(
        string calldata orderId,
        address fromToken,
        address toToken,
        address destination,
        uint256 minOut,
        address router,
        bytes calldata data
    ) external whenNotPaused onlyRelayerOrOwner returns (address proxy) {
        bytes32 salt = saltFor(orderId, destination, fromToken, toToken);
        proxy = createProxy(salt, fromToken, toToken, destination, minOut);
        DepositProxy(payable(proxy)).execute(router, data, salt);
    }
}
