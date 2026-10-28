'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseContracts, findContract, stripComments, splitParams } = require('../src/parse');

const SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
/* contract Fake { } */
interface IThing { function x() external; }
contract Token is ERC20, Ownable(msg.sender) {
    uint256 public constant CAP = 1e24;
    uint256 public totalDeposits;
    mapping(address => uint256) public deposits;
    string internal note = "contract Nope {";
    constructor(string memory name_, string memory symbol_, uint256 supply) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external onlyOwner { if (true) { } }
    function peek() public view returns (uint256 a, bool) { return (1, true); }
    function _hidden() internal {}
    function priv() private {}
}
`;

test('strips comments but keeps strings', () => {
  const s = stripComments('a // c\nb /* d */ "e // f"');
  assert.ok(!s.includes(' c'));
  assert.ok(!s.includes(' d '));
  assert.ok(s.includes('"e // f"'));
});

test('splits params and drops data locations', () => {
  assert.deepStrictEqual(splitParams('string memory n, uint256[] calldata xs, address'), [
    { type: 'string', name: 'n' }, { type: 'uint256[]', name: 'xs' }, { type: 'address', name: '' },
  ]);
});

test('finds contracts, interfaces and inheritance, ignoring commented code', () => {
  const all = parseContracts(SRC);
  assert.deepStrictEqual(all.map((c) => c.name), ['IThing', 'Token']);
  assert.deepStrictEqual(all[1].inherits, ['ERC20', 'Ownable']);
});

test('parses constructor params', () => {
  const c = findContract(SRC, 'Token');
  assert.deepStrictEqual(c.constructor.params.map((p) => p.type), ['string', 'string', 'uint256']);
});

test('keeps only public/external functions and adds public state and address-mapping getters', () => {
  const c = findContract(SRC, 'Token');
  const names = c.functions.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['CAP', 'deposits', 'mint', 'peek', 'totalDeposits']);
  const peek = c.functions.find((f) => f.name === 'peek');
  assert.strictEqual(peek.mutability, 'view');
  assert.deepStrictEqual(peek.returns.map((r) => r.type), ['uint256', 'bool']);
});

test('auto-picks the only concrete contract, errors otherwise', () => {
  assert.strictEqual(findContract(SRC).name, 'Token');
  assert.throws(() => findContract(SRC + 'contract B {}'), /pass --name/);
  assert.throws(() => findContract(SRC, 'Missing'), /not found/);
  assert.throws(() => findContract(SRC, 'IThing'), /interface/);
});
