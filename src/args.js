'use strict';
// Builds Solidity expressions for constructor arguments.
const ASSET_TYPES = /^(I?ERC20\w*|IERC20Metadata|IERC4626Asset)$/;

function isAssetParam(p) {
  return ASSET_TYPES.test(p.type) || (p.type === 'address' && /asset|underlying|token/i.test(p.name));
}

function ctorArgs(contract, { assetExpr = null } = {}) {
  const warnings = [];
  const params = (contract.constructor && contract.constructor.params) || [];
  let usedAsset = false;
  const args = params.map((p) => {
    const t = p.type;
    if (assetExpr && !usedAsset && isAssetParam(p)) {
      usedAsset = true;
      return t === 'address' ? `address(${assetExpr})` : `${t}(address(${assetExpr}))`;
    }
    if (t === 'string') return `"${contract.name}${p.name ? ' ' + p.name.replace(/[^\w]/g, '') : ''}"`;
    if (/^uint\d*$/.test(t)) {
      if (/decimal/i.test(p.name)) return '18';
      return '0';
    }
    if (/^int\d*$/.test(t)) return '0';
    if (t === 'address') return 'address(this)';
    if (t === 'bool') return 'false';
    if (/^bytes\d+$/.test(t)) return `${t}(0)`;
    if (t === 'bytes') return '""';
    warnings.push(`constructor param "${t} ${p.name}" has no default; edit setUp() (TODO marker emitted)`);
    return `/* TODO: ${t} ${p.name} */ ${t}(address(0))`;
  });
  if (assetExpr && !usedAsset) warnings.push('no constructor param looked like the underlying asset; setUp() deploys a mock asset but you must wire it in');
  const needsGlobalImport = params.some((p) => !/^(u?int\d*|address|bool|string|bytes\d*)$/.test(p.type));
  return { args: args.join(', '), warnings, needsGlobalImport, usedAsset };
}

module.exports = { ctorArgs, isAssetParam };
