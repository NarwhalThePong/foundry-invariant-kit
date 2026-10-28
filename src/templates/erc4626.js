'use strict';
const { HEADER, importLine } = require('./common');

function handler({ name: N, rel, globalImport }) {
  const A = `${N}Asset`;
  return `${HEADER(`Fuzz handler for ${N} (ERC-4626).`)}
import {Test} from "forge-std/Test.sol";
${importLine(N, rel, globalImport)}
import {${A}} from "./${A}.sol";

contract ${N}Handler is Test {
    ${N} public immutable vault;
    ${A} public immutable asset;
    address[] internal actors;
    address internal currentActor;

    uint256 internal constant MAX_ASSETS = 1e30;
    uint256 internal constant MAX_DONATION = 1e24;

    // Ghost variables: set when an ERC-4626 rule is broken during a call.
    bool public ghost_previewDepositTooHigh;   // previewDeposit > shares actually minted
    bool public ghost_previewMintTooLow;       // previewMint < assets actually pulled
    bool public ghost_previewWithdrawTooLow;   // previewWithdraw < shares actually burned
    bool public ghost_previewRedeemTooHigh;    // previewRedeem > assets actually paid
    bool public ghost_freeShares;              // shares minted for zero assets
    bool public ghost_roundTripProfit;         // deposit then redeem returned more than deposited
    bool public ghost_conversionFavorsUser;    // convertToAssets(convertToShares(a)) > a, or the reverse
    uint256 public ghost_depositedAssets;
    uint256 public ghost_withdrawnAssets;

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

    constructor(${N} _vault, ${A} _asset, address[] memory _actors) {
        vault = _vault;
        asset = _asset;
        actors = _actors;
    }

    function _fund(address who, uint256 amount) internal {
        asset.mint(who, amount);
        asset.approve(address(vault), amount);
    }

    function deposit(uint256 actorSeed, uint256 assets) external useActor(actorSeed) countCall("deposit") {
        assets = bound(assets, 0, MAX_ASSETS);
        _fund(currentActor, assets);
        uint256 preview = vault.previewDeposit(assets);
        uint256 shares = vault.deposit(assets, currentActor);
        if (preview > shares) ghost_previewDepositTooHigh = true;
        if (shares > 0 && assets == 0) ghost_freeShares = true;
        ghost_depositedAssets += assets;
    }

    function mint(uint256 actorSeed, uint256 shares) external useActor(actorSeed) countCall("mint") {
        shares = bound(shares, 0, MAX_ASSETS);
        uint256 preview = vault.previewMint(shares);
        // Fund a margin above the preview so a vault that pulls more than previewed is observed, not just reverted.
        _fund(currentActor, preview + preview / 100 + 1e6);
        uint256 balBefore = asset.balanceOf(currentActor);
        uint256 assets = vault.mint(shares, currentActor);
        uint256 pulled = balBefore - asset.balanceOf(currentActor);
        if (preview < assets || preview < pulled) ghost_previewMintTooLow = true;
        if (shares > 0 && assets == 0) ghost_freeShares = true;
        ghost_depositedAssets += assets;
    }

    function withdraw(uint256 actorSeed, uint256 assets) external useActor(actorSeed) countCall("withdraw") {
        assets = bound(assets, 0, vault.maxWithdraw(currentActor));
        uint256 preview = vault.previewWithdraw(assets);
        uint256 shares = vault.withdraw(assets, currentActor, currentActor);
        if (preview < shares) ghost_previewWithdrawTooLow = true;
        ghost_withdrawnAssets += assets;
    }

    function redeem(uint256 actorSeed, uint256 shares) external useActor(actorSeed) countCall("redeem") {
        shares = bound(shares, 0, vault.balanceOf(currentActor));
        uint256 preview = vault.previewRedeem(shares);
        uint256 assets = vault.redeem(shares, currentActor, currentActor);
        if (preview > assets) ghost_previewRedeemTooHigh = true;
        ghost_withdrawnAssets += assets;
    }

    /// Someone sends assets straight to the vault (donation / share-price inflation attempt).
    function donate(uint256 amount) external countCall("donate") {
        amount = bound(amount, 0, MAX_DONATION);
        asset.mint(address(vault), amount);
    }

    /// Deposit and immediately redeem everything received: must not return more than was put in.
    function depositRedeemRoundTrip(uint256 actorSeed, uint256 assets) external useActor(actorSeed) countCall("roundTrip") {
        assets = bound(assets, 1, MAX_ASSETS);
        _fund(currentActor, assets);
        uint256 shares = vault.deposit(assets, currentActor);
        uint256 out = vault.redeem(shares, currentActor, currentActor);
        if (out > assets) ghost_roundTripProfit = true;
    }

    /// Pure conversion check at the current exchange rate.
    function checkConversions(uint256 amount) external countCall("convert") {
        amount = bound(amount, 0, MAX_ASSETS);
        if (vault.convertToAssets(vault.convertToShares(amount)) > amount) ghost_conversionFavorsUser = true;
        if (vault.convertToShares(vault.convertToAssets(amount)) > amount) ghost_conversionFavorsUser = true;
    }
}
`;
}

function invariantTest({ name: N, rel, globalImport, ctorArgs, actors = 3 }) {
  const A = `${N}Asset`;
  return `${HEADER(`Invariant suite for ${N} (ERC-4626).`)}
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
${importLine(N, rel, globalImport)}
import {${A}} from "./${A}.sol";
import {${N}Handler} from "./${N}Handler.sol";

contract ${N}InvariantTest is StdInvariant, Test {
    ${N} internal vault;
    ${A} internal asset;
    ${N}Handler internal handler;
    address[] internal actors;

    function setUp() public {
        asset = new ${A}();
        // TODO: check these constructor arguments (the mock asset is passed where detected).
        vault = new ${N}(${ctorArgs});
        for (uint256 i = 0; i < ${actors}; i++) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        handler = new ${N}Handler(vault, asset, actors);

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = ${N}Handler.deposit.selector;
        selectors[1] = ${N}Handler.mint.selector;
        selectors[2] = ${N}Handler.withdraw.selector;
        selectors[3] = ${N}Handler.redeem.selector;
        selectors[4] = ${N}Handler.donate.selector;
        selectors[5] = ${N}Handler.depositRedeemRoundTrip.selector;
        selectors[6] = ${N}Handler.checkConversions.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_conversionRoundTripNeverFavorsUser() public view {
        assertFalse(handler.ghost_conversionFavorsUser(), "share/asset conversion round trip rounded in the user's favor");
    }

    function invariant_previewDepositLeDeposit() public view {
        assertFalse(handler.ghost_previewDepositTooHigh(), "previewDeposit > shares minted by deposit");
    }

    function invariant_previewsAreConservative() public view {
        assertFalse(handler.ghost_previewMintTooLow(), "previewMint < assets pulled by mint");
        assertFalse(handler.ghost_previewWithdrawTooLow(), "previewWithdraw < shares burned by withdraw");
        assertFalse(handler.ghost_previewRedeemTooHigh(), "previewRedeem > assets paid by redeem");
    }

    function invariant_noFreeShares() public view {
        assertFalse(handler.ghost_freeShares(), "shares minted for zero assets");
    }

    function invariant_depositRedeemCannotProfit() public view {
        assertFalse(handler.ghost_roundTripProfit(), "deposit then redeem returned more assets than deposited");
    }

    /// The vault's real asset balance can pay out every share at the current redeem price.
    /// TODO: if the vault deploys assets elsewhere (strategies), add those holdings here.
    function invariant_solvency() public view {
        assertGe(asset.balanceOf(address(vault)), vault.previewRedeem(vault.totalSupply()), "vault cannot pay out all shares at the current redeem price");
    }

    /// TODO: if the vault deploys assets elsewhere (strategies), replace this with your own backing check.
    function invariant_assetsHeldCoverTotalAssets() public view {
        assertGe(asset.balanceOf(address(vault)), vault.totalAssets(), "vault holds fewer assets than totalAssets reports");
    }

    function invariant_totalSupplyEqualsSumOfShares() public view {
        uint256 sum;
        for (uint256 i = 0; i < actors.length; i++) {
            sum += vault.balanceOf(actors[i]);
        }
        assertEq(vault.totalSupply(), sum, "totalSupply != sum of tracked share balances");
    }
}
`;
}

module.exports = { handler, invariantTest };
