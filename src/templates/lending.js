'use strict';
// EXPERIMENTAL: lending scaffold. Generates handler actions for deposit/withdraw/borrow/repay(uint256)
// and liquidate(address[,uint256]) functions it can find, plus account-health checks driven by an
// explicit hook in the generated Handler (collateralValue / debtValue / isHealthy).
// The hook is wired automatically only when the pool exposes one of the recognised getters below;
// otherwise it is left NOT CONFIGURED and the health properties are inert until you fill it in.
const { HEADER, importLine } = require('./common');

const ACTIONS = ['deposit', 'withdraw', 'borrow', 'repay'];
const COLLATERAL_NAMES = ['collateralOf', 'collateralBalanceOf', 'deposits', 'depositOf', 'depositsOf', 'suppliedOf', 'supplyBalanceOf'];
const DEBT_NAMES = ['debtOf', 'borrowBalanceOf', 'borrowBalance', 'debts', 'borrowsOf', 'borrowedOf'];
const LTV_NAMES = ['ltvBps', 'LTV_BPS', 'ltvBPS'];

function detect(contract) {
  const fns = contract.functions;
  const has = (n, arity) => fns.some((f) => f.name === n && (arity === undefined || f.params.length === arity));
  const acct = (names) => names.find((n) => fns.some((f) => f.name === n && f.params.length === 1 && f.params[0].type === 'address' && f.returns.length >= 1 && /^uint/.test(f.returns[0].type)));
  const hf = fns.find((f) => f.name === 'healthFactor' && f.params.length === 1 && f.params[0].type === 'address' && f.returns.length >= 1);
  const aave = fns.find((f) => f.name === 'getUserAccountData' && f.params.length === 1 && f.params[0].type === 'address' && f.returns.length >= 2);
  const liq = fns.find((f) => f.name === 'liquidate' && f.params.length >= 1 && f.params[0].type === 'address' && f.params.length <= 2 && (f.params.length === 1 || /^uint/.test(f.params[1].type)));
  const collateral = acct(COLLATERAL_NAMES);
  const debt = acct(DEBT_NAMES);
  let health = 'none';
  if (hf) health = 'healthFactor';
  else if (collateral && debt) health = 'getters';
  else if (aave) health = 'accountData';
  return {
    actions: ACTIONS.filter((a) => fns.some((f) => f.name === a && f.params.length === 1 && /^uint/.test(f.params[0].type))),
    totalBorrows: has('totalBorrows', 0),
    totalDeposits: has('totalDeposits', 0),
    collateral, debt, health,
    aaveReturns: aave ? aave.returns.length : 0,
    ltvGetter: LTV_NAMES.find((n) => has(n, 0)),
    liquidate: liq ? liq.params.length : 0,
  };
}

function hookBody(d, ltvBps) {
  const ltv = d.ltvGetter ? `pool.${d.ltvGetter}()` : 'LTV_BPS';
  const tuple = (want) => `(${Array.from({ length: d.aaveReturns }, (_, i) => (i === want ? 'uint256 v' : '')).join(', ')})`;
  let coll, debt, healthy;
  if (d.health === 'getters' || d.health === 'healthFactor') {
    coll = d.collateral ? `return pool.${d.collateral}(user);` : 'user; return 0; // TODO: not detected';
    debt = d.debt ? `return pool.${d.debt}(user);` : 'user; return 0; // TODO: not detected';
  } else if (d.health === 'accountData') {
    coll = `${tuple(0)} = pool.getUserAccountData(user);\n        return v;`;
    debt = `${tuple(1)} = pool.getUserAccountData(user);\n        return v;`;
  } else {
    coll = 'user; return 0; // TODO: NOT CONFIGURED. Return the collateral value of `user` (same unit as debtValue).';
    debt = 'user; return 0; // TODO: NOT CONFIGURED. Return the debt of `user`.';
  }
  if (d.health === 'healthFactor') healthy = 'return pool.healthFactor(user) >= HEALTH_FACTOR_ONE;';
  else healthy = `return debtValue(user) * BPS <= collateralValue(user) * ${ltv};`;
  const src = {
    healthFactor: 'detected `healthFactor(address)`; healthy means healthFactor >= HEALTH_FACTOR_ONE',
    getters: `detected \`${d.collateral}(address)\` / \`${d.debt}(address)\`; healthy means debt * 10000 <= collateral * LTV (bps), values taken 1:1 (no oracle)`,
    accountData: 'detected `getUserAccountData(address)`; collateral = return #0, debt = return #1 (Aave-style ordering, check it)',
    none: 'NOT CONFIGURED: no recognised per-account getters were found. Health properties pass trivially until you implement these three functions',
  }[d.health];
  return `    // ---------------------------------------------------------------------------------------------
    // ACCOUNT-HEALTH HOOK (EXPERIMENTAL). Source: ${src}.
    // Override or edit these for your protocol (oracle prices, multiple assets, interest accrual).
    // ---------------------------------------------------------------------------------------------
    uint256 public constant BPS = 10_000;
    uint256 public constant LTV_BPS = ${ltvBps}; // ${d.ltvGetter ? `unused: pool.${d.ltvGetter}() was detected` : 'TODO: set to your max loan-to-value (bps), or pass --ltv-bps'}
    uint256 public constant HEALTH_FACTOR_ONE = 1e18; // TODO: your protocol's health-factor scale

    function collateralValue(address user) public view virtual returns (uint256) {
        ${coll}
    }

    function debtValue(address user) public view virtual returns (uint256) {
        ${debt}
    }

    function isHealthy(address user) public view virtual returns (bool) {
        ${healthy}
    }
`;
}

function handler({ name: N, rel, globalImport, contract, ltvBps = 7500 }) {
  const A = `${N}Asset`;
  const d = detect(contract);
  const debtKnown = d.health !== 'none';
  const fns = d.actions.map((a) => {
    if (a === 'repay') {
      const boundLine = debtKnown ? '        amount = bound(amount, 0, debtValue(currentActor));' : '        amount = bound(amount, 0, MAX_AMOUNT);';
      return `    function repay(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
${boundLine}
        asset.mint(currentActor, amount);
        asset.approve(address(pool), amount);
        uint256 debtBefore = debtValue(currentActor);
        uint256 cashBefore = asset.balanceOf(address(pool));
        pool.repay(amount);
        uint256 debtAfter = debtValue(currentActor);
        uint256 paid = asset.balanceOf(address(pool)) - cashBefore;
        if (debtAfter > debtBefore) ghost_repayIncreasedDebt = true;
        if (debtBefore > debtAfter && debtBefore - debtAfter > paid) ghost_repayOverCredited = true;
        calls["repay"]++;
    }
`;
    }
    const fund = a === 'deposit' ? `        asset.mint(currentActor, amount);\n        asset.approve(address(pool), amount);\n` : '';
    const check = a === 'borrow' || a === 'withdraw'
      ? `        if (!isHealthy(currentActor)) ghost_unhealthyAfter${a === 'borrow' ? 'Borrow' : 'Withdraw'} = true;\n` : '';
    return `    function ${a}(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        amount = bound(amount, 0, MAX_AMOUNT);
${fund}        pool.${a}(amount);
${check}        calls["${a}"]++;
    }
`;
  });
  if (d.liquidate) {
    fns.push(`    /// Liquidation must only succeed against a position that was unhealthy before the call.
    function liquidate(uint256 liquidatorSeed, uint256 borrowerSeed, uint256 amount) external useActor(liquidatorSeed) {
        address borrower = actors[bound(borrowerSeed, 0, actors.length - 1)];
        amount = bound(amount, 0, debtValue(borrower));
        asset.mint(currentActor, amount);
        asset.approve(address(pool), amount);
        bool healthyBefore = isHealthy(borrower);
        pool.liquidate(borrower${d.liquidate === 2 ? ', amount' : ''});
        if (healthyBefore) ghost_liquidatedHealthy = true;
        calls["liquidate"]++;
    }
`);
  }
  return `${HEADER(`EXPERIMENTAL fuzz handler for ${N} (lending). Actions were inferred from function names; check them.`)}
import {Test} from "forge-std/Test.sol";
${importLine(N, rel, globalImport)}
import {${A}} from "./${A}.sol";

contract ${N}Handler is Test {
    ${N} public immutable pool;
    ${A} public immutable asset;
    address[] internal actors;
    address internal currentActor;
    uint256 internal constant MAX_AMOUNT = 1e30;
    mapping(bytes32 => uint256) public calls;

    // Ghost flags, set when a rule is broken during a successful call.
    bool public ghost_unhealthyAfterBorrow;   // a borrow succeeded but left the borrower over the LTV / health threshold
    bool public ghost_unhealthyAfterWithdraw; // a collateral withdrawal succeeded but left the account unhealthy
    bool public ghost_repayIncreasedDebt;     // repay increased the payer's debt
    bool public ghost_repayOverCredited;      // repay reduced debt by more than the assets the pool received
    bool public ghost_liquidatedHealthy;      // liquidate succeeded against a healthy position

    modifier useActor(uint256 seed) {
        currentActor = actors[bound(seed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    constructor(${N} _pool, ${A} _asset, address[] memory _actors) {
        pool = _pool;
        asset = _asset;
        actors = _actors;
    }

${hookBody(d, ltvBps)}
${fns.join('\n') || '    // TODO: no deposit/withdraw/borrow/repay(uint256) functions were found; add your own actions.\n'}}
`;
}

function invariantTest({ name: N, rel, globalImport, ctorArgs, contract, actors = 3 }) {
  const A = `${N}Asset`;
  const d = detect(contract);
  const acts = d.actions.concat(d.liquidate ? ['liquidate'] : []);
  const sels = acts.map((a, i) => `        selectors[${i}] = ${N}Handler.${a}.selector;`).join('\n');
  const borrows = d.totalBorrows ? 'pool.totalBorrows()' : 'uint256(0) /* TODO: total borrowed assets */';
  const deposits = d.totalDeposits ? 'pool.totalDeposits()' : 'uint256(0) /* TODO: total deposited assets */';
  const notConfigured = d.health === 'none' ? '\n    // WARNING: the account-health hook in the Handler is NOT CONFIGURED, so the health properties below pass trivially.\n' : '';
  return `${HEADER(`EXPERIMENTAL invariant suite for ${N} (lending). Minimal set only.`)}
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
${importLine(N, rel, globalImport)}
import {${A}} from "./${A}.sol";
import {${N}Handler} from "./${N}Handler.sol";

contract ${N}InvariantTest is StdInvariant, Test {
    ${N} internal pool;
    ${A} internal asset;
    ${N}Handler internal handler;
    address[] internal actors;

    function setUp() public {
        asset = new ${A}();
        // TODO: check these constructor arguments.
        pool = new ${N}(${ctorArgs});
        for (uint256 i = 0; i < ${actors}; i++) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        handler = new ${N}Handler(pool, asset, actors);
${acts.length ? `        bytes4[] memory selectors = new bytes4[](${acts.length});\n${sels}\n        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));\n` : ''}        targetContract(address(handler));
    }

    function invariant_borrowsNeverExceedDeposits() public view {
        assertLe(${borrows}, ${deposits}, "total borrows exceed total deposits");
    }

    function invariant_cashPlusBorrowsCoverDeposits() public view {
        assertGe(asset.balanceOf(address(pool)) + ${borrows}, ${deposits}, "cash + borrows < deposits");
    }
${notConfigured}
    /// A borrow or collateral withdrawal that succeeds must leave the account within the LTV / health threshold.
    function invariant_successfulBorrowStaysHealthy() public view {
        assertFalse(handler.ghost_unhealthyAfterBorrow(), "borrow succeeded but left the borrower over the LTV");
        assertFalse(handler.ghost_unhealthyAfterWithdraw(), "withdraw succeeded but left the account unhealthy");
    }

    /// With no price moves or interest in this harness, every tracked actor should stay healthy.
    /// TODO: drop or relax this if your protocol accrues interest or uses moving oracle prices.
    function invariant_allActorsHealthy() public view {
        for (uint256 i = 0; i < actors.length; i++) {
            assertTrue(handler.isHealthy(actors[i]), "actor below health threshold");
        }
    }

    function invariant_repayNeverIncreasesDebt() public view {
        assertFalse(handler.ghost_repayIncreasedDebt(), "repay increased debt");
    }

    function invariant_repayCreditsAtMostWhatWasPaid() public view {
        assertFalse(handler.ghost_repayOverCredited(), "repay reduced debt by more than the pool received");
    }
${d.liquidate ? `
    function invariant_liquidationOnlyWhenUnhealthy() public view {
        assertFalse(handler.ghost_liquidatedHealthy(), "liquidate succeeded against a healthy position");
    }
` : ''}}
`;
}

module.exports = { handler, invariantTest, detect };
