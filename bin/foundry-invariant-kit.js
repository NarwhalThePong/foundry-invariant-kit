#!/usr/bin/env node
'use strict';
const path = require('path');
const { generate } = require('../src/generate');
const pkg = require('../package.json');

const HELP = `foundry-invariant-kit ${pkg.version}
Generate a Foundry invariant/fuzz test scaffold from a Solidity contract.
The output is a starting point for your own invariant testing, not a guarantee
of correctness or security. Review and extend every property.

Usage:
  foundry-invariant-kit init --type <type> --contract <path/to/Contract.sol> [--name <ContractName>] [--out test/invariant] [--force] [--ltv-bps 7500]

Types:
  erc20      ERC-20 token: supply/balance/allowance accounting
  erc4626    ERC-4626 vault: rounding, previews, free shares, round-trip profit, solvency
  lending    EXPERIMENTAL: lending-pool scaffold (borrows <= deposits, LTV/health hook, repay and liquidation checks)

Options:
  --type       one of erc20, erc4626, lending (required)
  --contract   Solidity source file (required)
  --name       contract name in the file (required if the file has more than one contract)
  --out        output directory, relative to the current directory (default: test/invariant)
  --force      overwrite existing generated files
  --ltv-bps    lending only: max loan-to-value in basis points for the health hook (default 7500)
  -h, --help   show this help
  -v, --version
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '--force') opts.force = true;
    else if (['--type', '--contract', '--name', '--out', '--ltv-bps'].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else opts._.push(a);
  }
  return opts;
}

function main(argv, io = { log: console.log, error: console.error }) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { io.error(`error: ${e.message}\n\n${HELP}`); return 2; }
  if (opts.version) { io.log(pkg.version); return 0; }
  if (opts.help || opts._.length === 0) { io.log(HELP); return opts.help ? 0 : 2; }
  if (opts._[0] !== 'init') { io.error(`error: unknown command "${opts._[0]}"\n\n${HELP}`); return 2; }
  if (!opts.type) { io.error('error: --type is required'); return 2; }
  if (opts['ltv-bps'] !== undefined && !(/^\d+$/.test(opts['ltv-bps']) && Number(opts['ltv-bps']) > 0 && Number(opts['ltv-bps']) <= 10000)) { io.error('error: --ltv-bps must be an integer from 1 to 10000'); return 2; }
  try {
    const r = generate({ type: opts.type, contractPath: opts.contract, name: opts.name, out: opts.out || 'test/invariant', force: opts.force, ltvBps: opts['ltv-bps'] ? Number(opts['ltv-bps']) : 7500 });
    io.log(`Generated ${opts.type} scaffold for ${r.name}:`);
    for (const f of r.files) io.log('  ' + path.relative(process.cwd(), f));
    for (const w of r.warnings) io.log('warning: ' + w);
    io.log('Next: review the TODOs, then run forge test --match-contract ' + r.name + 'InvariantTest');
    return 0;
  } catch (e) { io.error('error: ' + e.message); return 1; }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parseArgs, HELP };
