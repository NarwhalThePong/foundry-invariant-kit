// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// MUTANT of SafeVault: mint pulls 1 wei more than previewMint promised.
contract MutVaultPreviewMint is ERC4626 {
    constructor(IERC20 asset_) ERC20("Safe Vault", "sVLT") ERC4626(asset_) {}
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        uint256 assets = previewMint(shares) + 1; // pulls 1 wei more than previewed
        _deposit(_msgSender(), receiver, assets, shares);
        return assets;
    }
}
