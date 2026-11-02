// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../token/interfaces/IDSToken.sol";
import "../utility/interfaces/IContractRegistry.sol";
import "../utility/interfaces/ITokenHolder.sol";
import "../INetworkSettings.sol";

/// Plain ERC20 used as a pool reserve (18 decimals like WETH/DAI).
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory _name, string memory _symbol) public {
        name = _name;
        symbol = _symbol;
    }

    function mint(address _to, uint256 _amount) external {
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    function transfer(address _to, uint256 _amount) public override returns (bool) {
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(msg.sender, _to, _amount);
        return true;
    }

    function approve(address _spender, uint256 _amount) public override returns (bool) {
        allowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    function transferFrom(
        address _from,
        address _to,
        uint256 _amount
    ) public override returns (bool) {
        uint256 allowed = allowance[_from][msg.sender];
        require(allowed >= _amount, "AL");
        if (allowed != uint256(-1)) {
            allowance[_from][msg.sender] = allowed - _amount;
        }
        balanceOf[_from] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(_from, _to, _amount);
        return true;
    }
}

/// Minimal DSToken (the converter "anchor" / pool token). owner() == converter => converter active.
contract MockPoolToken is IDSToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public override totalSupply;
    address public override owner;
    address public newOwner;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory _name, string memory _symbol) public {
        name = _name;
        symbol = _symbol;
        decimals = 18;
        owner = msg.sender;
    }

    function transferOwnership(address _newOwner) public override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        newOwner = _newOwner;
    }

    function acceptOwnership() public override {
        require(msg.sender == newOwner, "ERR_ACCESS_DENIED");
        owner = newOwner;
        newOwner = address(0);
    }

    function issue(address _to, uint256 _amount) public override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    function destroy(address _from, uint256 _amount) public override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        balanceOf[_from] -= _amount;
        totalSupply -= _amount;
        emit Transfer(_from, address(0), _amount);
    }

    function transfer(address _to, uint256 _amount) public override returns (bool) {
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(msg.sender, _to, _amount);
        return true;
    }

    function approve(address _spender, uint256 _amount) public override returns (bool) {
        allowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    function transferFrom(
        address _from,
        address _to,
        uint256 _amount
    ) public override returns (bool) {
        uint256 allowed = allowance[_from][msg.sender];
        require(allowed >= _amount, "AL");
        if (allowed != uint256(-1)) {
            allowance[_from][msg.sender] = allowed - _amount;
        }
        balanceOf[_from] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(_from, _to, _amount);
        return true;
    }
}

contract MockRegistry is IContractRegistry {
    mapping(bytes32 => address) private addresses;

    function set(bytes32 _name, address _addr) external {
        addresses[_name] = _addr;
    }

    function addressOf(bytes32 _contractName) external view override returns (address) {
        return addresses[_contractName];
    }
}

/// Network fee wallet + network settings in one contract.
contract MockNetworkSettings is INetworkSettings, ITokenHolder {
    address public override owner;
    address public newOwner;
    uint32 private fee;
    ITokenHolder private wallet;

    constructor(uint32 _fee) public {
        owner = msg.sender;
        fee = _fee;
        wallet = ITokenHolder(address(this));
    }

    receive() external payable override {}

    function setFee(uint32 _fee) external {
        fee = _fee;
    }

    function networkFeeParams() external view override returns (ITokenHolder, uint32) {
        return (wallet, fee);
    }

    function networkFeeWallet() external view override returns (ITokenHolder) {
        return wallet;
    }

    function networkFee() external view override returns (uint32) {
        return fee;
    }

    function transferOwnership(address _newOwner) public override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        newOwner = _newOwner;
    }

    function acceptOwnership() public override {
        require(msg.sender == newOwner, "ERR_ACCESS_DENIED");
        owner = newOwner;
        newOwner = address(0);
    }

    function withdrawTokens(
        IERC20 _token,
        address payable _to,
        uint256 _amount
    ) public override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        _token.transfer(_to, _amount);
    }

    function withdrawTokensMultiple(
        IERC20[] calldata _tokens,
        address payable _to,
        uint256[] calldata _amounts
    ) external override {
        require(msg.sender == owner, "ERR_ACCESS_DENIED");
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tokens[i].transfer(_to, _amounts[i]);
        }
    }
}
