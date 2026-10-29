'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generate } = require('../src/generate');
const { ctorArgs } = require('../src/args');
const { main, parseArgs } = require('../bin/foundry-invariant-kit');

const EX = path.join(__dirname, '..', 'examples', 'src');
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fik-'));
  fs.mkdirSync(path.join(d, 'src'));
  for (const f of fs.readdirSync(EX)) fs.copyFileSync(path.join(EX, f), path.join(d, 'src', f));
  return d;
}
function capture() {
  const out = [], err = [];
  return { io: { log: (s) => out.push(s), error: (s) => err.push(s) }, out, err };
}

test('erc20: writes handler, invariant test and README with expected properties', () => {
  const cwd = tmp();
  const r = generate({ type: 'erc20', contractPath: 'src/SafeToken.sol', cwd });
  assert.strictEqual(r.name, 'SafeToken');
  const dir = path.join(cwd, 'test/invariant/SafeToken');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['README.md', 'SafeTokenHandler.sol', 'SafeTokenInvariant.t.sol']);
  const t = fs.readFileSync(path.join(dir, 'SafeTokenInvariant.t.sol'), 'utf8');
  for (const p of ['invariant_totalSupplyEqualsSumOfBalances', 'invariant_transfersNeverChangeTotalSupply', 'invariant_noBalanceExceedsTotalSupply', 'invariant_allowanceAccounting']) assert.ok(t.includes(p), p);
  assert.ok(t.includes('import {SafeToken} from "../../../src/SafeToken.sol";'));
  assert.ok(t.includes('new SafeToken("SafeToken name_", "SafeToken symbol_", 0)'));
  const h = fs.readFileSync(path.join(dir, 'SafeTokenHandler.sol'), 'utf8');
  assert.ok(h.includes('bound(') && h.includes('vm.startPrank') && h.includes('ghost_'));
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /not a guarantee/);
});

test('erc4626: generates mock asset and passes it to the constructor', () => {
  const cwd = tmp();
  generate({ type: 'erc4626', contractPath: 'src/SafeVault.sol', cwd, out: 'test/inv' });
  const dir = path.join(cwd, 'test/inv/SafeVault');
  assert.ok(fs.existsSync(path.join(dir, 'SafeVaultAsset.sol')));
  const t = fs.readFileSync(path.join(dir, 'SafeVaultInvariant.t.sol'), 'utf8');
  assert.ok(t.includes('new SafeVault(IERC20(address(asset)))'));
  assert.ok(t.includes('import "../../../src/SafeVault.sol";'), 'global import so IERC20 is in scope');
  for (const p of ['invariant_conversionRoundTripNeverFavorsUser', 'invariant_previewDepositLeDeposit', 'invariant_noFreeShares', 'invariant_depositRedeemCannotProfit', 'invariant_solvency']) assert.ok(t.includes(p), p);
});

test('lending: experimental, detects actions and public totals', () => {
  const cwd = tmp();
  const r = generate({ type: 'lending', contractPath: 'src/SimpleLendingPool.sol', cwd });
  assert.match(r.warnings[0], /EXPERIMENTAL/);
  const dir = path.join(cwd, 'test/invariant/SimpleLendingPool');
  const t = fs.readFileSync(path.join(dir, 'SimpleLendingPoolInvariant.t.sol'), 'utf8');
  assert.ok(t.includes('assertLe(pool.totalBorrows(), pool.totalDeposits()'));
  const h = fs.readFileSync(path.join(dir, 'SimpleLendingPoolHandler.sol'), 'utf8');
  for (const a of ['deposit', 'withdraw', 'borrow', 'repay']) assert.ok(h.includes(`pool.${a}(amount)`), a);
});

test('refuses to overwrite without --force', () => {
  const cwd = tmp();
  generate({ type: 'erc20', contractPath: 'src/SafeToken.sol', cwd });
  assert.throws(() => generate({ type: 'erc20', contractPath: 'src/SafeToken.sol', cwd }), /--force/);
  assert.doesNotThrow(() => generate({ type: 'erc20', contractPath: 'src/SafeToken.sol', cwd, force: true }));
});

test('unknown type and missing file error clearly', () => {
  const cwd = tmp();
  assert.throws(() => generate({ type: 'erc721', contractPath: 'src/SafeToken.sol', cwd }), /unknown type "erc721"/);
  assert.throws(() => generate({ type: 'erc20', contractPath: 'src/Nope.sol', cwd }), /not found/);
  assert.throws(() => generate({ type: 'erc20', cwd }), /--contract is required/);
});

test('ctorArgs: defaults and TODO for unknown types', () => {
  const r = ctorArgs({ name: 'X', constructor: { params: [{ type: 'uint8', name: 'decimals_' }, { type: 'bool', name: 'b' }, { type: 'Foo', name: 'f' }] } });
  assert.match(r.args, /^18, false, \/\* TODO: Foo f \*\/ Foo\(address\(0\)\)$/);
  assert.strictEqual(r.warnings.length, 1);
  const v = ctorArgs({ name: 'V', constructor: { params: [{ type: 'address', name: 'underlying' }] } }, { assetExpr: 'asset' });
  assert.strictEqual(v.args, 'address(asset)');
});

test('CLI flag handling', () => {
  assert.deepStrictEqual(parseArgs(['init', '--type', 'erc20', '--contract', 'a.sol']), { _: ['init'], type: 'erc20', contract: 'a.sol' });
  assert.throws(() => parseArgs(['init', '--type']), /needs a value/);
  assert.throws(() => parseArgs(['init', '--bogus']), /unknown option/);
  let c = capture();
  assert.strictEqual(main(['--help'], c.io), 0);
  assert.match(c.out.join(''), /lending\s+EXPERIMENTAL/);
  c = capture(); assert.strictEqual(main(['--version'], c.io), 0); assert.strictEqual(c.out[0], require('../package.json').version);
  c = capture(); assert.strictEqual(main(['build'], c.io), 2); assert.match(c.err.join(''), /unknown command/);
  c = capture(); assert.strictEqual(main(['init', '--contract', 'x.sol'], c.io), 2); assert.match(c.err.join(''), /--type is required/);
  c = capture(); assert.strictEqual(main(['init', '--type', 'nft', '--contract', 'x.sol'], c.io), 1); assert.match(c.err.join(''), /unknown type/);
});

test('CLI end to end via child process', () => {
  const cwd = tmp();
  const { execFileSync } = require('child_process');
  const bin = path.join(__dirname, '..', 'bin', 'foundry-invariant-kit.js');
  const out = execFileSync('node', [bin, 'init', '--type', 'erc20', '--contract', 'src/BuggyToken.sol', '--name', 'BuggyToken', '--out', 'test/x'], { cwd, encoding: 'utf8' });
  assert.match(out, /Generated erc20 scaffold for BuggyToken/);
  assert.ok(fs.existsSync(path.join(cwd, 'test/x/BuggyToken/BuggyTokenHandler.sol')));
});

test('lending: wires the account-health hook from collateralOf/debtOf, ltvBps and liquidate', () => {
  const cwd = tmp();
  const r = generate({ type: 'lending', contractPath: 'src/SafeLendingPool.sol', cwd });
  const dir = path.join(cwd, 'test/invariant/SafeLendingPool');
  const h = fs.readFileSync(path.join(dir, 'SafeLendingPoolHandler.sol'), 'utf8');
  assert.ok(h.includes('return pool.collateralOf(user);') && h.includes('return pool.debtOf(user);'));
  assert.ok(h.includes('collateralValue(user) * pool.ltvBps()'));
  assert.ok(h.includes('pool.liquidate(borrower, amount)'));
  const t = fs.readFileSync(path.join(dir, 'SafeLendingPoolInvariant.t.sol'), 'utf8');
  for (const p of ['invariant_successfulBorrowStaysHealthy', 'invariant_repayNeverIncreasesDebt', 'invariant_repayCreditsAtMostWhatWasPaid', 'invariant_liquidationOnlyWhenUnhealthy']) assert.ok(t.includes(p), p);
  assert.ok(r.warnings.some((w) => /EXPERIMENTAL/.test(w)));
});

test('lending: public mappings are detected, --ltv-bps is used, and missing getters leave the hook NOT CONFIGURED', () => {
  const cwd = tmp();
  generate({ type: 'lending', contractPath: 'src/SimpleLendingPool.sol', cwd, ltvBps: 8000 });
  const h = fs.readFileSync(path.join(cwd, 'test/invariant/SimpleLendingPool/SimpleLendingPoolHandler.sol'), 'utf8');
  assert.ok(h.includes('return pool.deposits(user);') && h.includes('LTV_BPS = 8000'));
  fs.writeFileSync(path.join(cwd, 'src/Bare.sol'), 'pragma solidity ^0.8.20;\ncontract Bare { constructor(address a) {} function borrow(uint256 x) external {} }\n');
  const r = generate({ type: 'lending', contractPath: 'src/Bare.sol', cwd });
  assert.ok(r.warnings.some((w) => /NOT CONFIGURED/.test(w)));
  const hb = fs.readFileSync(path.join(cwd, 'test/invariant/Bare/BareHandler.sol'), 'utf8');
  assert.match(hb, /NOT CONFIGURED/);
});

test('cli: rejects a bad --ltv-bps', () => {
  const c = capture();
  assert.strictEqual(main(['init', '--type', 'lending', '--contract', 'x.sol', '--ltv-bps', 'abc'], c.io), 2);
});
