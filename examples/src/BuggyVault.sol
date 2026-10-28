// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// DELIBERATELY BUGGY sample: naive share math with no virtual offset and
/// rounding flipped in the user's favor (shares and assets both rounded up).
contract BuggyVault is ERC4626 {
    using Math for uint256;

    constructor(IERC20 asset_) ERC20("Buggy Vault", "bVLT") ERC4626(asset_) {}

    function _convertToShares(uint256 assets, Math.Rounding) internal view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : assets.mulDiv(supply, totalAssets(), Math.Rounding.Ceil); // bug
    }

    function _convertToAssets(uint256 shares, Math.Rounding) internal view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : shares.mulDiv(totalAssets(), supply, Math.Rounding.Ceil); // bug
    }
}
