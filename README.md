# foundry-invariant-kit

[![npm](https://img.shields.io/npm/v/foundry-invariant-kit.svg)](https://www.npmjs.com/package/foundry-invariant-kit) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Generate a Foundry invariant/fuzz test scaffold from a Solidity contract.

**This tool generates a starting point for your own invariant testing. It is
not a guarantee of correctness or security.** A green run means only that the
generated properties held for the inputs the fuzzer tried. You must review the
generated properties, fix every `TODO`, and add the properties that are specific
to your protocol.

## Usage

```sh
# from the root of a Foundry project (forge-std installed)
npx foundry-invariant-kit init --type erc20   --contract src/MyToken.sol
npx foundry-invariant-kit init --type erc4626 --contract src/MyVault.sol --name MyVault --out test/invariant
forge test --match-contract MyVaultInvariantTest
```

Options: `--type` (required), `--contract` (required), `--name` (needed when the
file has more than one contract), `--out` (default `test/invariant`), `--force`
(overwrite). Output goes to `<out>/<ContractName>/`.

Suggested `foundry.toml`:

```toml
[invariant]
runs = 64
depth = 64
fail_on_revert = false
```

## Supported types

| type | generates | properties |
|---|---|---|
| `erc20` | `Handler` (mint via `deal`, transfer, approve, transferFrom; bounded, pranked actors, ghost flags), `Invariant.t.sol`, README note | totalSupply == sum of tracked balances; transfers never change totalSupply; transfers move exactly the amount; no balance exceeds totalSupply; allowance set/spent as expected |
| `erc4626` | `Handler` (deposit, mint, withdraw, redeem, donate, deposit-redeem round trip, conversion checks), mock asset, `Invariant.t.sol`, README note | convertToShares/convertToAssets round trip never favors the user; previewDeposit <= deposit result (and previewMint/Withdraw/Redeem conservative); no shares for zero assets; deposit-then-redeem cannot profit; solvency `asset.balanceOf(vault) >= previewRedeem(totalSupply)`; vault asset balance covers totalAssets; totalSupply == sum of tracked shares |
| `lending` | **EXPERIMENTAL.** Handler actions for any `deposit/withdraw/borrow/repay(uint256)` and `liquidate(address[,uint256])` found, mock asset, an explicit account-health hook (`collateralValue`/`debtValue`/`isHealthy` in the Handler) | total borrows <= total deposits; cash + borrows cover deposits; a successful borrow/withdraw leaves the account within LTV; every tracked actor stays healthy; repay never increases debt; repay never credits more than the pool received; liquidation only succeeds on unhealthy positions |

## Limitations

- The Solidity reader is a simple pattern-based parser, not a compiler. It finds
  the constructor, public/external functions and public state variables.
  Unusual syntax may be missed.
- Constructor arguments get placeholder values (`0`, `address(this)`, a name
  string, the mock asset for vault/lending). Unknown types are emitted as
  `TODO` and will not compile until you fix them.
- ERC-20 balances are created with forge-std `deal(..., true)`. Tokens with
  non-standard storage, fees, rebasing or transfer hooks need a custom mint
  action and adjusted properties.
- ERC-4626 suites use a plain mock asset. Fee-on-transfer assets, strategies
  that move assets out of the vault, fees, and caps (`maxDeposit` etc.) need
  extra handling; `invariant_assetsHeldCoverTotalAssets` assumes the vault holds
  its assets.
- Only tracked actors are summed; add any other holders (treasury, fee recipient).
- The lending type is experimental. Its account-health hook is wired automatically only when the pool exposes
  `healthFactor(address)` (healthy means >= 1e18), per-account getters such as `collateralOf`/`deposits` plus
  `debtOf`/`borrowBalanceOf`/`debts` (healthy means debt * 10000 <= collateral * LTV, with LTV from `ltvBps()` or
  `--ltv-bps`, default 7500), or `getUserAccountData(address)` (Aave-style return order assumed). Collateral and debt
  are compared 1:1 in the same unit: there is no oracle, price movement or interest accrual in the harness. If none of
  these are found, the hook is generated as NOT CONFIGURED and the health properties pass trivially until you fill it in.
- Lending properties that are still UNPROVEN (no buggy sample has made them fail yet): "total borrows never exceed
  total deposits", the withdraw half of "a successful borrow/withdraw stays within LTV", and liquidation succeeding on a
  genuinely unhealthy position (the harness has no price moves or interest, so only "liquidation is blocked on healthy
  positions" is validated). Treat the lending type as EXPERIMENTAL.
- Sum checks see tracked holders only. The ERC-20 `totalSupply == sum of balances` and the ERC-4626
  `totalSupply == sum of shares` invariants (and `no balance exceeds totalSupply`) only look at the three actors, the test
  contract and the handler. Balances or shares held at any other address (fee recipients, treasuries, contracts the token
  calls into) are invisible to them, so a bug that moves value to an untracked address can pass, and a protocol that
  legitimately mints to another address will fail until you add that holder to the sum.

## Development

```sh
npm test               # node --test, generator tests
cd examples && ./install-deps.sh && forge test   # installs pinned forge-std bd8c870 + OZ v5.1.0 into examples/lib, then runs the samples (see VALIDATION.md)
```

The `examples/` project contains safe and deliberately buggy samples; the buggy
suites are expected to fail.

Want a hand with a pre-audit review of a Solidity project? The [Smart Contract Pre-Audit Review Pack](https://payhip.com/b/G5agO) is a self-review aid with a 66-item checklist, a 40-point audit-readiness scoring sheet and scope/known-issues/threat-model templates. It is not an audit and gives no security guarantee ($19, our own paid product).

## License

MIT
