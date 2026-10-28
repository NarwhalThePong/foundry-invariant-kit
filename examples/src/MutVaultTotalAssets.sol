// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// MUTANT of SafeVault: totalAssets overstated by a phantom 1e18 (e.g. counts unrealised yield).
contract MutVaultTotalAssets is ERC4626 {
    constructor(IERC20 asset_) ERC20("Safe Vault", "sVLT") ERC4626(asset_) {}
    function totalAssets() public view override returns (uint256) {
        return super.totalAssets() + 1e18;
    }
}
