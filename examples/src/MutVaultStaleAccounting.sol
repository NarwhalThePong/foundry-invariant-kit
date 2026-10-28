// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// MUTANT of SafeVault: totalAssets comes from an internal counter that withdrawals forget to decrement,
/// so the vault promises (and pays out) more than it holds.
contract MutVaultStaleAccounting is ERC4626 {
    uint256 private _managed;
    constructor(IERC20 asset_) ERC20("Safe Vault", "sVLT") ERC4626(asset_) {}

    function totalAssets() public view override returns (uint256) {
        return _managed;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        _managed += assets;
        super._deposit(caller, receiver, assets, shares);
    }
    // BUG: _withdraw is not overridden, so _managed is never reduced.
}
