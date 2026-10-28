// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// MUTANT of SafeToken: transfer debits the sender 1 wei less than it credits (sum of balances drifts above totalSupply).
contract MutTokenNoDebit is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 initialSupply) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }
    mapping(address => uint256) private _bonus;
    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        if (value > 0 && to != _msgSender()) _bonus[_msgSender()] += 1; // sender keeps 1 wei: not fully debited
        return ok;
    }
    function balanceOf(address a) public view override returns (uint256) { return super.balanceOf(a) + _bonus[a]; }
}
