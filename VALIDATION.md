# Validation (v0.1.0)

Environment: forge 1.8.5 (commit 51a52c5), solc 0.8.24, forge-std (git bd8c870, installed by `examples/install-deps.sh`),
OpenZeppelin Contracts v5.1.0 (same script). Node v20.19.2. Run date: 2026-10-27 (ET).

Project: `examples/` (foundry.toml `[invariant] runs = 64, depth = 64, fail_on_revert = false`).
Each suite was generated with `node ../bin/foundry-invariant-kit.js init --type <type> --contract src/<C>.sol`
with no hand edits, then run with `forge test --match-contract <C>InvariantTest`. Full logs: `validation-logs/`.

| sample | type | result | runs/calls | failing invariants |
|---|---|---|---|---|
| SafeToken (OZ ERC20) | erc20 | PASS 5/5 | 64 / 4096, 0 reverts | none |
| BuggyToken (mints 1% bonus on transfer) | erc20 | FAIL (expected) | 64 / 4096 | transfersNeverChangeTotalSupply, transfersMoveExactAmount |
| SafeVault (OZ ERC4626) | erc4626 | PASS 8/8 | 64 / 4096, 0 reverts | none |
| BuggyVault (no virtual offset, rounds up for user) | erc4626 | FAIL (expected) | 64 / 4096 | conversionRoundTripNeverFavorsUser, depositRedeemCannotProfit |
| SimpleLendingPool | lending (experimental) | PASS 6/6 | 64 / 4096 | none |
| BuggyLendingPool (borrow does not record totalBorrows) | lending (experimental) | FAIL (expected) | 64 / 4096 | cashPlusBorrowsCoverDeposits |

Extra run on the safe samples with `FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=128` (65,536 calls each): SafeToken, SafeVault and SimpleLendingPool all PASS.

## Counterexamples (shrunk sequences from forge)

- **BuggyToken**: `mint(actor, 1e24)` then `transfer(from, to, 22993)`. The recipient got 22993 + 229 and
  totalSupply rose by 229.
- **BuggyVault, round trip**: `donate(816)`, `deposit(2660 seed, ~2.96e9)`, `checkConversions(5)`. After the donation the
  share price is not 1:1 and ceil rounding turns 5 assets into shares worth more than 5 assets.
- **BuggyVault, profit**: `donate(816)` then `depositRedeemRoundTrip(...)`. Depositing then redeeming at once returned more
  assets than were deposited.
- **BuggyLendingPool**: `deposit(1e24)` then `borrow(10181)`. Cash fell by 10181 while totalBorrows stayed 0, so
  cash + borrows < deposits (999999999999999999989819 < 1e24).

Seeds differ between runs, so exact args vary; the failing invariants were the same on every run.

## Mutation testing (per property)

Each mutant in `examples/src/Mut*.sol` is SafeToken / SafeVault plus one small override. Every suite was regenerated with the
CLI (no hand edits) and run with the default 64 runs x depth 64. Logs: `validation-logs/mutants/`. A property is called
**validated** only if a mutant made it fail.

### ERC-4626

| property | status | mutant | counterexample (shrunk) |
|---|---|---|---|
| conversionRoundTripNeverFavorsUser | validated | BuggyVault | `donate(816)`, deposit, `checkConversions(5)` |
| depositRedeemCannotProfit | validated | BuggyVault | `donate(816)` then deposit/redeem round trip returns more than deposited |
| noFreeShares | validated | MutVaultFreeShares (`deposit(0)` mints 1 share) | single `deposit(actor, 0)` |
| previewDepositLeDeposit | validated | MutVaultPreviewDeposit (deposit mints 1 share less than previewed) | single `deposit(actor, 18)` |
| previewsAreConservative (previewMint) | validated after template fix | MutVaultPreviewMint (mint pulls 1 wei more than previewed) | single `mint(actor, 12324)` |
| previewsAreConservative (previewRedeem) | validated | MutVaultPreviewRedeem (redeem pays 1 wei less than previewed) | `deposit(~3.7e9)` then `redeem(..)` |
| previewsAreConservative (previewWithdraw) | validated | MutVaultPreviewWithdraw (withdraw burns 1 share more than previewed) | `deposit(1e30)` then `withdraw(1e6)` |
| solvency | validated after template fix | MutVaultStaleAccounting (internal totalAssets counter not decremented on withdraw) | `mint(..)` then `redeem(1e24)`: balance 9.99999e29 < previewRedeem(totalSupply) ~1e30 |
| assetsHeldCoverTotalAssets | validated | MutVaultTotalAssets (totalAssets + 1e18 phantom); also MutVaultStaleAccounting | empty vault: balance 0 < totalAssets 1e18 |
| totalSupplyEqualsSumOfShares | validated | MutVaultUntrackedShares (deposit mints 1 extra share to an untracked fee address) | single deposit: totalSupply 1e30+1 != tracked 1e30 |

### ERC-20

| property | status | mutant | counterexample (shrunk) |
|---|---|---|---|
| transfersNeverChangeTotalSupply | validated | BuggyToken | mint then transfer: supply +1% |
| transfersMoveExactAmount | validated | BuggyToken, MutTokenNoDebit, MutTokenSelfTransfer | see logs |
| totalSupplyEqualsSumOfBalances | validated | MutTokenNoDebit (sender debited 1 wei less than recipient is credited) | mint then transfer: supply 455396512335513 != sum 455396512335514 |
| noBalanceExceedsTotalSupply | validated | MutTokenSelfTransfer (self-transfer credits without debiting) | `mint(1e30)` then self `transfer(1e30)`: balance 2e30 > supply 1e30 |
| allowanceAccounting | validated | MutTokenNoAllowanceSpend (`_spendAllowance` is a no-op) | approve, mint, transferFrom: allowance unchanged |

Forge reports a whole invariant contract as one test; per-property results above were confirmed with
`forge test --match-contract <C>InvariantTest --match-test <invariant>`. Each mutant also tripped only the intended
property (plus closely related ones as listed), and the safe samples stayed green after the template fixes, including a
512 x 128 run of SafeToken and SafeVault.

### Template changes made because of this pass

1. **solvency was tautological.** The old form `totalAssets() >= convertToAssets(totalSupply())` holds for any OZ-style vault by
   the conversion formula itself, whatever totalAssets reports, so no mutant could fail it. It now checks
   `asset.balanceOf(vault) >= previewRedeem(totalSupply())` (with a TODO for vaults that hold assets in strategies).
   Note that a plain "totalAssets + phantom" mutant still passes solvency on OZ vaults, because the virtual share absorbs the
   phantom; that bug is caught by assetsHeldCoverTotalAssets instead.
2. **previewMint could not be observed.** The handler funded exactly `previewMint`, so a vault pulling more simply reverted (and
   reverts are ignored with `fail_on_revert = false`). It now funds a margin and compares the preview with the assets actually
   pulled from the actor's balance.

## Not exercised

- Sum checks see tracked holders only: the ERC-20 sum/max-balance checks and the ERC-4626 sum-of-shares check look at the three
  actors, the test contract and the handler. Balances or shares at any other address are invisible (MutVaultUntrackedShares is
  caught only because the generated check compares against totalSupply; a bug that moves existing balance to an untracked
  address while keeping totalSupply consistent would not be).
- The ERC-20 handler mints with `deal(..., adjustTotalSupply=true)`, so a bug in a token's own mint function is not exercised.

## Lending (EXPERIMENTAL): account-health hook

Samples: `SafeLendingPool` (per-account `collateralOf`/`debtOf`, `ltvBps() = 7500`, `liquidate(address,uint256)` only when
unhealthy) and four mutants, each one edit of it. Suites regenerated with the CLI, no hand edits; the hook was auto-wired from
`collateralOf`/`debtOf`/`ltvBps`. Per-property results via `--match-test`, logs in `validation-logs/lending/`.

| property | status | mutant | counterexample (shrunk) |
|---|---|---|---|
| successfulBorrowStaysHealthy | validated | MutLendingIgnoreLtv (borrow skips the LTV check) | `deposit(~9.4e8)`, `borrow(1e4)` over the limit |
| allActorsHealthy | validated | MutLendingIgnoreLtv | deposit then `borrow(1e6)` |
| repayNeverIncreasesDebt | validated | MutLendingRepaySignFlip (repay adds to debt) | deposit, `borrow`, `repay` |
| repayCreditsAtMostWhatWasPaid | validated | MutLendingRepayMiscount (pulls half, credits full) | deposit, borrow, repay |
| liquidationOnlyWhenUnhealthy | validated | MutLendingLiquidateHealthy (no health check) | `liquidate` on a healthy (empty) position |
| cashPlusBorrowsCoverDeposits | validated | BuggyLendingPool; also MutLendingRepayMiscount | see above |
| borrowsNeverExceedDeposits | UNPROVEN | no mutant tripped it | |
| withdraw branch of successfulBorrowStaysHealthy | UNPROVEN | no withdraw mutant written | the borrow branch is validated |

SafeLendingPool and SimpleLendingPool PASS on every property, including a 512 x 128 run. SimpleLendingPool's hook was wired from
its public `deposits`/`debts` mappings with the default 7500 bps.

Not exercised: the `healthFactor(address)` and `getUserAccountData(address)` wiring paths (generated and unit-tested for shape, no
forge sample), liquidation against a genuinely unhealthy position (the harness has no price moves or interest, so positions never
become unhealthy legitimately), multi-asset pools, oracles and interest accrual. These need a protocol-specific hook.
