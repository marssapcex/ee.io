// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC20 {
    string public symbol;
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    // fee-on-transfer: bps taken out of every transfer
    uint256 public feeBps;
    constructor(string memory s, uint256 _feeBps) { symbol = s; feeBps = _feeBps; }
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function transfer(address to, uint256 v) external returns (bool) {
        uint256 fee = (v * feeBps) / 10_000;
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v - fee;
        return true;
    }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        require(allowance[f][msg.sender] >= v, "allow");
        allowance[f][msg.sender] -= v;
        uint256 fee = (v * feeBps) / 10_000;
        balanceOf[f] -= v;
        balanceOf[to] += v - fee;
        return true;
    }
}

/// @dev Stand-in for an allowlisted aggregator router. Pulls `pull` of tokenIn
///      from msg.sender and sends `give` of tokenOut back to msg.sender.
contract MockRouter {
    function swap(address tokenIn, uint256 pull, address tokenOut, uint256 give) external payable {
        if (pull > 0) MockERC20(tokenIn).transferFrom(msg.sender, address(this), pull);
        if (give > 0) MockERC20(tokenOut).transfer(msg.sender, give);
    }
    /// @dev Same as swap() but pays the proceeds to `recv` — exactly what the
    ///      planner encodes (dstReceiver = user's destination, not the proxy).
    function swapTo(address tokenIn, uint256 pull, address tokenOut, uint256 give, address recv) external payable {
        if (pull > 0) MockERC20(tokenIn).transferFrom(msg.sender, address(this), pull);
        if (give > 0) MockERC20(tokenOut).transfer(recv, give);
    }
    function boom() external pure { revert("router down"); }
}
