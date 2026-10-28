// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// MUTANT of SafeLendingPool: repay pulls only half the amount but credits the full amount.
contract MutLendingRepayMiscount {
    IToken public immutable asset;
    uint256 public constant ltvBps = 7500;
    uint256 public totalDeposits;
    uint256 public totalBorrows;
    mapping(address => uint256) internal _collateral;
    mapping(address => uint256) internal _debt;

    constructor(address asset_) { asset = IToken(asset_); }

    function collateralOf(address user) external view returns (uint256) { return _collateral[user]; }
    function debtOf(address user) external view returns (uint256) { return _debt[user]; }

    function _healthy(uint256 coll, uint256 debt) internal pure returns (bool) {
        return debt * 10_000 <= coll * ltvBps;
    }

    function deposit(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
        _collateral[msg.sender] += amount;
        totalDeposits += amount;
    }

    function withdraw(uint256 amount) external {
        require(_healthy(_collateral[msg.sender] - amount, _debt[msg.sender]), "unhealthy");
        _collateral[msg.sender] -= amount;
        totalDeposits -= amount;
        asset.transfer(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        require(_healthy(_collateral[msg.sender], _debt[msg.sender] + amount), "unhealthy");
        _debt[msg.sender] += amount;
        totalBorrows += amount;
        asset.transfer(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount / 2); // BUG: half
        _debt[msg.sender] -= amount;
        totalBorrows -= amount;
    }

    /// Repay part of an unhealthy borrower's debt and seize the same amount of their collateral.
    function liquidate(address borrower, uint256 amount) external {
        require(!_healthy(_collateral[borrower], _debt[borrower]), "healthy");
        asset.transferFrom(msg.sender, address(this), amount);
        _debt[borrower] -= amount;
        totalBorrows -= amount;
        _collateral[borrower] -= amount;
        totalDeposits -= amount;
        asset.transfer(msg.sender, amount);
    }
}
