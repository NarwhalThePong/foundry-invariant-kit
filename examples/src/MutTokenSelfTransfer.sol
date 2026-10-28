// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// MUTANT of SafeToken: self-transfer credits the amount without debiting (balance can exceed totalSupply).
contract MutTokenSelfTransfer is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 initialSupply) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }
    function transfer(address to, uint256 value) public override returns (bool) {
        if (to == _msgSender()) { _mintNoSupply(to, value); return true; }
        return super.transfer(to, value);
    }
    mapping(address => uint256) private _bonus;
    function _mintNoSupply(address to, uint256 v) private { _bonus[to] += v; }
    function balanceOf(address a) public view override returns (uint256) { return super.balanceOf(a) + _bonus[a]; }
}
