// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev Harness-only token. Not part of the repo under audit.
contract MockERC20 {
    string public name = "Mock USD";
    string public symbol = "mUSD";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Recipient that refuses native ETH (and anything else) so PushSplit takes its
///      `SplitsWarehouse.deposit` fallback path.
contract RejectingRecipient {
    receive() external payable {
        revert("no eth");
    }
}

/// @dev Recipient that, while being paid native ETH, tries to re-enter `distribute`
///      on the split wallet it was paid from. Used to test the documented PushSplit
///      re-entrancy note. Only succeeds if it is given more than the 2300 gas stipend.
contract ReenteringRecipient {
    address public target;
    bytes public payload;
    bool public armed;
    bool public fired;

    function arm(address _target, bytes calldata _payload) external {
        target = _target;
        payload = _payload;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        fired = true;
        (bool ok,) = target.call(payload);
        ok; // swallow: we only care whether the outer call survived
    }
}
