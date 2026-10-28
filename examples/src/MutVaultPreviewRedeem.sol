// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// MUTANT of SafeVault: redeem pays 1 wei less than previewRedeem promised.
contract MutVaultPreviewRedeem is ERC4626 {
    constructor(IERC20 asset_) ERC20("Safe Vault", "sVLT") ERC4626(asset_) {}
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        uint256 assets = previewRedeem(shares);
        if (assets > 0) assets -= 1;
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }
}
