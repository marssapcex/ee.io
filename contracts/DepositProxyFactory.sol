// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DepositProxy.sol";

/**
 * @title DepositProxyFactory — CREATE2 factory for per-order deposit proxies
 * @notice Deploys EIP-1167 minimal proxies of DepositProxy. The deposit
 *         address is counterfactual: users can fund it BEFORE deployment.
 *         computeAddress() predicts it off-chain via CREATE2.
 *
 * Each salt should be unique per order, e.g. keccak256(orderId).
 * The factory holds the router allowlist and is Ownable for governance,
 * but proxies themselves are immutable — owning the factory does NOT grant
 * fund custody (proxies forward only to their stored destination).
 */
contract DepositProxyFactory {
    address public owner;
    address public logic; // DepositProxy implementation
    mapping(bytes32 => address) public proxyOf;
    mapping(address => bool) public isRouterAllowed;

    event ProxyDeployed(bytes32 indexed salt, address indexed proxy, address fromToken, address toToken, address destination);
    event RouterAllowed(address router, bool allowed);

    // EIP-1167 minimal proxy creation code
    // 0x3d602d80600a3d3981f3363d3d373d3d3d363d73<logic>5af43d82803e903d91602b57fd5bf3
    bytes constant MINIMAL_PROXY_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes constant MINIMAL_PROXY_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _logic) {
        owner = msg.sender;
        logic = _logic;
        // Allowlist canonical routers by default
        isRouterAllowed[0x0000000000001fF3684f28c67538d4D072C22734] = true; // 0x Settler
        isRouterAllowed[0x111111125421cA6dc452d289314280a0f8842A65] = true; // 1inch V6
        isRouterAllowed[0x6131B5fae19EA4f9D964eAc0408E4408b66337b5] = true; // Kyber
        isRouterAllowed[0x6A000F20005980200259B80c5102003040001068] = true; // ParaSwap Augustus
        isRouterAllowed[0x000000000022D473030F116dDEE9F6B43aC78BA3] = true; // Permit2 (for completeness)
    }

    function setLogic(address _logic) external onlyOwner {
        logic = _logic;
    }

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        isRouterAllowed[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }

    /**
     * @notice Predict the deposit address for a given salt.
     * @dev Uses CREATE2: keccak256(0xff ++ address(this) ++ salt ++ keccak256(initCode))
     */
    function computeAddress(bytes32 salt) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(MINIMAL_PROXY_PREFIX, logic, MINIMAL_PROXY_SUFFIX);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode)));
        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Deploy proxy for order salt with immutable swap params.
     */
    function createProxy(
        bytes32 salt,
        address fromToken,
        address toToken,
        address destination,
        uint256 minOut
    ) external returns (address proxy) {
        require(proxyOf[salt] == address(0), "exists");
        bytes memory creationCode = abi.encodePacked(MINIMAL_PROXY_PREFIX, logic, MINIMAL_PROXY_SUFFIX);
        assembly {
            proxy := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(proxy != address(0), "create2 failed");
        DepositProxy(payable(proxy)).initialize(fromToken, toToken, destination, minOut);
        proxyOf[salt] = proxy;
        emit ProxyDeployed(salt, proxy, fromToken, toToken, destination);
    }

    // Helper to deploy and execute in one tx (relayer path) — saves gas
    function createAndExecute(
        bytes32 salt,
        address fromToken,
        address toToken,
        address destination,
        uint256 minOut,
        address router,
        bytes calldata data
    ) external returns (address proxy) {
        proxy = createProxy(salt, fromToken, toToken, destination, minOut);
        DepositProxy(payable(proxy)).execute(router, data);
    }
}
