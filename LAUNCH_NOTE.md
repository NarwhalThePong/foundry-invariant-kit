# foundry-invariant-kit 0.1.0

A free command-line tool that writes a Foundry invariant and fuzz test scaffold (a Handler, an Invariant test and notes) for an ERC-20 or ERC-4626 contract. It also has an EXPERIMENTAL lending template.

**What it isn't:** the output is a starting point, not a guarantee of correctness or security. A green run means only that the generated properties held for the inputs the fuzzer tried. Review every property, fix every `TODO`, and add the properties that are specific to your protocol.

## Install and run

```
npx foundry-invariant-kit@0.1.0 init --type erc20 --contract src/MyToken.sol
forge test --match-contract MyTokenInvariantTest
```

## Example (on a deliberately buggy sample token in `examples/`)

```
BuggyTokenInvariantTest invariants: 2/5 invariants broken
[PASS] invariant_allowanceAccounting
[PASS] invariant_noBalanceExceedsTotalSupply
[PASS] invariant_totalSupplyEqualsSumOfBalances
[FAIL: a transfer did not move exactly the amount] invariant_transfersMoveExactAmount
[FAIL: a transfer changed totalSupply] invariant_transfersNeverChangeTotalSupply
```

Every ERC-20 and ERC-4626 property was made to fail by at least one deliberately buggy sample (see VALIDATION.md).

## Known limits

- The lending template is EXPERIMENTAL. Three of its properties are still UNPROVEN because no buggy sample has made them fail: "total borrows never exceed total deposits", the withdraw half of the borrow/withdraw LTV check, and liquidation succeeding on a genuinely unhealthy position.
- Sum checks only see tracked holders.
- The Solidity reader is pattern-based, not a compiler.
- Tokens or vaults with fees, rebasing or hooks need custom actions.
- See README "Limitations" for the full list.
