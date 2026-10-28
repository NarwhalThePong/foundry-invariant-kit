'use strict';
const { HEADER, importLine } = require('./common');

function handler({ name: N, rel, globalImport }) {
  return `${HEADER(`Fuzz handler for ${N} (ERC-20).`)}
import {Test} from "forge-std/Test.sol";
${importLine(N, rel, globalImport)}

contract ${N}Handler is Test {
    ${N} public immutable token;
    address[] internal actors;
    address internal currentActor;

    uint256 internal constant MAX_MINT = 1e30;

    // Ghost variables: set when an accounting rule is broken during a call.
    bool public ghost_transferChangedSupply;
    bool public ghost_balanceAccountingMismatch;
    bool public ghost_allowanceMismatch;
    uint256 public ghost_mintedTotal;

    mapping(bytes32 => uint256) public calls;

    modifier useActor(uint256 seed) {
        currentActor = actors[bound(seed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    modifier countCall(bytes32 key) {
        calls[key]++;
        _;
    }

    constructor(${N} _token, address[] memory _actors) {
        token = _token;
        actors = _actors;
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    /// Gives an actor tokens. Uses forge-std deal() with totalSupply adjustment.
    /// TODO: if ${N} has a permissioned mint, replace this with a pranked call.
    function mint(uint256 actorSeed, uint256 amount) external countCall("mint") {
        address to = _actor(actorSeed);
        amount = bound(amount, 0, MAX_MINT);
        deal(address(token), to, token.balanceOf(to) + amount, true);
        ghost_mintedTotal += amount;
    }

    function transfer(uint256 actorSeed, uint256 toSeed, uint256 amount) external useActor(actorSeed) countCall("transfer") {
        address to = _actor(toSeed);
        uint256 fromBal = token.balanceOf(currentActor);
        uint256 toBal = token.balanceOf(to);
        amount = bound(amount, 0, fromBal);
        uint256 supplyBefore = token.totalSupply();

        token.transfer(to, amount);

        if (token.totalSupply() != supplyBefore) ghost_transferChangedSupply = true;
        _checkMoved(currentActor, to, fromBal, toBal, amount);
    }

    function approve(uint256 actorSeed, uint256 spenderSeed, uint256 amount) external useActor(actorSeed) countCall("approve") {
        address spender = _actor(spenderSeed);
        token.approve(spender, amount);
        if (token.allowance(currentActor, spender) != amount) ghost_allowanceMismatch = true;
    }

    function transferFrom(uint256 ownerSeed, uint256 spenderSeed, uint256 toSeed, uint256 amount)
        external
        useActor(spenderSeed)
        countCall("transferFrom")
    {
        address owner = _actor(ownerSeed);
        address to = _actor(toSeed);
        uint256 allowed = token.allowance(owner, currentActor);
        uint256 fromBal = token.balanceOf(owner);
        uint256 toBal = token.balanceOf(to);
        amount = bound(amount, 0, allowed < fromBal ? allowed : fromBal);
        uint256 supplyBefore = token.totalSupply();

        token.transferFrom(owner, to, amount);

        if (token.totalSupply() != supplyBefore) ghost_transferChangedSupply = true;
        uint256 allowedAfter = token.allowance(owner, currentActor);
        if (allowed != type(uint256).max && allowedAfter != allowed - amount) ghost_allowanceMismatch = true;
        _checkMoved(owner, to, fromBal, toBal, amount);
    }

    function _checkMoved(address from, address to, uint256 fromBal, uint256 toBal, uint256 amount) internal {
        if (from == to) {
            if (token.balanceOf(from) != fromBal) ghost_balanceAccountingMismatch = true;
        } else {
            if (token.balanceOf(from) != fromBal - amount) ghost_balanceAccountingMismatch = true;
            if (token.balanceOf(to) != toBal + amount) ghost_balanceAccountingMismatch = true;
        }
    }
}
`;
}

function invariantTest({ name: N, rel, globalImport, ctorArgs, actors = 3 }) {
  return `${HEADER(`Invariant suite for ${N} (ERC-20).`)}
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
${importLine(N, rel, globalImport)}
import {${N}Handler} from "./${N}Handler.sol";

contract ${N}InvariantTest is StdInvariant, Test {
    ${N} internal token;
    ${N}Handler internal handler;
    address[] internal actors;

    function setUp() public {
        // TODO: check these constructor arguments.
        token = new ${N}(${ctorArgs});
        for (uint256 i = 0; i < ${actors}; i++) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        handler = new ${N}Handler(token, actors);

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = ${N}Handler.mint.selector;
        selectors[1] = ${N}Handler.transfer.selector;
        selectors[2] = ${N}Handler.approve.selector;
        selectors[3] = ${N}Handler.transferFrom.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// Sum of balances of every address the suite can touch.
    /// TODO: add any other holders (fee recipients, treasury, etc.).
    function _sumTrackedBalances() internal view returns (uint256 sum) {
        for (uint256 i = 0; i < actors.length; i++) {
            sum += token.balanceOf(actors[i]);
        }
        sum += token.balanceOf(address(this));
        sum += token.balanceOf(address(handler));
    }

    function invariant_totalSupplyEqualsSumOfBalances() public view {
        assertEq(token.totalSupply(), _sumTrackedBalances(), "totalSupply != sum of tracked balances");
    }

    function invariant_transfersNeverChangeTotalSupply() public view {
        assertFalse(handler.ghost_transferChangedSupply(), "a transfer changed totalSupply");
    }

    function invariant_transfersMoveExactAmount() public view {
        assertFalse(handler.ghost_balanceAccountingMismatch(), "a transfer did not move exactly the amount");
    }

    function invariant_noBalanceExceedsTotalSupply() public view {
        uint256 supply = token.totalSupply();
        for (uint256 i = 0; i < actors.length; i++) {
            assertLe(token.balanceOf(actors[i]), supply, "balance exceeds totalSupply");
        }
    }

    function invariant_allowanceAccounting() public view {
        assertFalse(handler.ghost_allowanceMismatch(), "allowance not set/spent as expected");
    }
}
`;
}

module.exports = { handler, invariantTest };
