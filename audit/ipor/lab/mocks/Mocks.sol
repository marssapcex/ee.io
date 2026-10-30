// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

/// @dev 1:1 ERC4626 vault, stands in for the IPOR PlasmaVault (asset management).
contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Plasma Vault", "mpV") {}

    function decimals() public view override returns (uint8) {
        return IERC20Metadata(address(asset())).decimals();
    }
}

/// @dev non-zero placeholder contract for the addresses a real deployment also has.
contract Empty {
    function initialize(bool) external {}

    fallback() external payable {}
}
