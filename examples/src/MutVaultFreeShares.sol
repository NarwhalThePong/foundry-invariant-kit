// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// MUTANT of SafeVault: deposit(0) mints 1 share.
contract MutVaultFreeShares is ERC4626 {
    constructor(IERC20 asset_) ERC20("Safe Vault", "sVLT") ERC4626(asset_) {}
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (assets == 0) { _mint(receiver, 1); return 1; }
        return super.deposit(assets, receiver);
    }
}
