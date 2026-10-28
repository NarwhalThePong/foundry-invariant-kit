'use strict';
// Lightweight Solidity source parser. Not a full parser: it strips comments and
// neutralises braces inside strings, finds contract blocks, the constructor signature and public/external
// function signatures. Good enough for scaffold generation; review the output.

function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i++; } out += /[{}();]/.test(src[i]) ? '_' : src[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

function splitParams(s) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const toks = p.split(/\s+/).filter((t) => !['memory', 'calldata', 'storage', 'payable', 'indexed'].includes(t));
    return { type: toks[0], name: toks[1] || '' };
  });
}

function readBalanced(src, openIdx) {
  // openIdx points at '(' or '{'; returns index of the matching close
  const open = src[openIdx], close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced ' + open);
}

function parseContracts(source) {
  const src = stripComments(source);
  const contracts = [];
  const re = /\b(abstract\s+contract|contract|interface|library)\s+([A-Za-z_$][\w$]*)([^{]*)\{/g;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1].replace(/\s+/g, ' ');
    const name = m[2];
    const open = m.index + m[0].length - 1;
    const end = readBalanced(src, open);
    const body = src.slice(open + 1, end);
    const inherits = (m[3].match(/\bis\b([\s\S]*)/) || [, ''])[1]
      .split(',').map((s) => s.trim().split(/[\s(]/)[0]).filter(Boolean);
    contracts.push({ kind, name, inherits, ...parseBody(body) });
    re.lastIndex = end + 1;
  }
  return contracts;
}

function parseBody(body) {
  let ctor = null;
  const functions = [];
  const re = /\b(constructor|function\s+([A-Za-z_$][\w$]*))\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const pOpen = m.index + m[0].length - 1;
    const pClose = readBalanced(body, pOpen);
    const params = splitParams(body.slice(pOpen + 1, pClose));
    // modifiers/visibility up to '{' or ';'
    let j = pClose + 1, depth = 0;
    while (j < body.length && !((body[j] === '{' || body[j] === ';') && depth === 0)) {
      if (body[j] === '(') depth++; if (body[j] === ')') depth--; j++;
    }
    const tail = body.slice(pClose + 1, j);
    if (m[1] === 'constructor') {
      ctor = { params };
    } else {
      const vis = (tail.match(/\b(public|external|internal|private)\b/) || [, 'public'])[1];
      const mut = (tail.match(/\b(view|pure|payable)\b/) || [, 'nonpayable'])[1];
      const retM = tail.match(/\breturns\s*\(/);
      let returns = [];
      if (retM) {
        const ro = tail.indexOf('(', retM.index);
        returns = splitParams(tail.slice(ro + 1, readBalanced(tail, ro)));
      }
      functions.push({ name: m[2], params, visibility: vis, mutability: mut, returns });
    }
    re.lastIndex = j;
  }
  // public state variables become getter functions (top-level only, non-mapping)
  const top = topLevel(body);
  const vre = /(?<=^|;|\})\s*([A-Za-z_][\w.]*(?:\[\d*\])?)\s+public\s+(?:(?:constant|immutable|override)\s+)*([A-Za-z_$][\w$]*)(?=\s*[=;])/g;
  let v;
  while ((v = vre.exec(top))) {
    if (v[1] === 'mapping') continue;
    functions.push({ name: v[2], params: [], visibility: 'public', mutability: 'view', returns: [{ type: v[1], name: '' }], stateVar: true });
  }
  // public mapping(address => uint) getters (single address key only)
  const mre = /mapping\s*\(\s*address\s*=>\s*(uint\d*|int\d*)\s*\)\s+public\s+(?:(?:override)\s+)*([A-Za-z_$][\w$]*)(?=\s*;)/g;
  while ((v = mre.exec(top))) {
    functions.push({ name: v[2], params: [{ type: 'address', name: '' }], visibility: 'public', mutability: 'view', returns: [{ type: v[1], name: '' }], stateVar: true });
  }
  return { constructor: ctor, functions: functions.filter((f) => f.visibility === 'public' || f.visibility === 'external') };
}

function topLevel(body) {
  // keep only depth-0 text of a contract body (drop function/struct bodies)
  let out = '', depth = 0;
  for (const ch of body) {
    if (ch === '{') { if (depth === 0) out += ';'; depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0) out += ';'; continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

function findContract(source, name) {
  const all = parseContracts(source);
  if (!name) {
    const concrete = all.filter((c) => c.kind === 'contract');
    if (concrete.length === 1) return concrete[0];
    throw new Error(`could not pick a contract automatically; pass --name (found: ${all.map((c) => c.name).join(', ') || 'none'})`);
  }
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`contract ${name} not found (found: ${all.map((x) => x.name).join(', ') || 'none'})`);
  if (c.kind !== 'contract') throw new Error(`${name} is a ${c.kind}, not a deployable contract`);
  return c;
}

module.exports = { stripComments, splitParams, parseContracts, findContract };
