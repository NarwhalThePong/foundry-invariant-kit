// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Minimal single-asset lending pool sample: borrow up to 75% of your own deposit.
contract SimpleLendingPool {
    IToken public immutable asset;
    uint256 public totalDeposits;
    uint256 public totalBorrows;
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public debts;

    constructor(address asset_) { asset = IToken(asset_); }

    function deposit(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposits += amount;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] - amount >= debts[msg.sender] * 4 / 3, "unhealthy");
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;
        asset.transfer(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        require(debts[msg.sender] + amount <= deposits[msg.sender] * 3 / 4, "unhealthy");
        debts[msg.sender] += amount;
        totalBorrows += amount;
        asset.transfer(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
        debts[msg.sender] -= amount;
        totalBorrows -= amount;
    }
}
