# Changelog

## 0.1.0 (2026-10-28)

- `init --type erc20`: handler with bounded actors/ghost flags and five supply, balance and allowance invariants.
- `init --type erc4626`: handler with deposit/mint/withdraw/redeem/donate/round-trip actions, mock asset, and eight vault invariants.
- `init --type lending`: experimental minimal stub.
- Example Foundry project with safe and deliberately buggy samples (see VALIDATION.md).
- erc4626 template: `solvency` now checks the vault's real asset balance against `previewRedeem(totalSupply)` (the old `totalAssets >= convertToAssets(totalSupply)` form always held by construction); the `mint` handler funds a margin above `previewMint` and measures assets actually pulled.
- Mutation samples (`examples/src/Mut*.sol`) validating every ERC-20 and ERC-4626 property.
- lending (still EXPERIMENTAL): the health-factor TODO is replaced by an explicit account-health hook in the generated Handler
  (`collateralValue`, `debtValue`, `isHealthy`), auto-wired from `healthFactor(address)`, collateral/debt getters or
  `getUserAccountData(address)`, else generated as NOT CONFIGURED with a warning. New properties: successful borrow/withdraw
  stays within LTV, all tracked actors healthy, repay never increases debt, repay never credits more than paid, and
  liquidation only on unhealthy positions (when `liquidate` exists). New `--ltv-bps` option.
- Parser: public `mapping(address => uint)` variables are now exposed as getters.
- Generated README notes and the main README state that sum checks only see tracked holders.
- Example dependencies are no longer vendored: `examples/install-deps.sh` installs pinned forge-std bd8c870 and OpenZeppelin Contracts v5.1.0.
