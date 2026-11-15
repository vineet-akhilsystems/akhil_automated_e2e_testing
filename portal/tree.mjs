// Read-only test tree model. Groups existing cases under nodes and rolls run results up the tree.
// Nothing here changes how tests run.
import fs from 'node:fs';
import path from 'node:path';
import { resolveModuleFolder } from './module-layout.mjs';

const KINDS = new Set(['root', 'step', 'variant', 'group']);
const MATCH_KEYS = ['registrationType', 'category', 'action'];
const MAX_LEVELS = 6;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function validateTree(tree) {
  const errors = [];
  if (!isObj(tree)) return ['Tree must be an object.'];
  if (typeof tree.module !== 'string' || !tree.module) errors.push('Tree needs a module string.');
  if (!Array.isArray(tree.nodes) || !tree.nodes.length) { errors.push('Tree needs a non-empty nodes array.'); return errors; }
  const byId = Object.create(null), dup = new Set();
  tree.nodes.forEach((n, i) => {
    if (!isObj(n) || typeof n.id !== 'string' || !ID_RE.test(n.id)) { errors.push(`Node at position ${i + 1} needs an id made of letters, digits, "-" or "_".`); return; }
    if (n.id in byId) { if (!dup.has(n.id)) errors.push(`Node id "${n.id}" is used more than once.`); dup.add(n.id); } else byId[n.id] = n;
  });
  if (tree.note !== undefined && typeof tree.note !== 'string') errors.push('Tree note must be a string.');
  const valid = tree.nodes.filter(n => isObj(n) && typeof n.id === 'string' && ID_RE.test(n.id));
  const names = Object.create(null);
  for (const n of valid) {
    if (typeof n.name === 'string' && n.name.trim()) {
      if (n.name in names) errors.push(`Node name "${n.name}" is used more than once (nodes "${names[n.name]}" and "${n.id}").`); else names[n.name] = n.id;
    }
    if (typeof n.name !== 'string' || !n.name.trim()) errors.push(`Node "${n.id}" needs a name.`);
    if (!KINDS.has(n.kind)) errors.push(`Node "${n.id}" has unknown kind "${n.kind}".`);
    if (n.parent !== undefined && typeof n.parent !== 'string') errors.push(`Node "${n.id}" has a parent that is not a string.`);
    else if (n.parent !== undefined && !(n.parent in byId)) errors.push(`Node "${n.id}" has parent "${n.parent}" which does not exist.`);
    if (n.match !== undefined) {
      if (!isObj(n.match)) errors.push(`Node "${n.id}" match must be an object.`);
      else for (const [k, v] of Object.entries(n.match)) {
        if (!MATCH_KEYS.includes(k)) errors.push(`Node "${n.id}" has unknown match key "${k}".`);
        else if (!Array.isArray(v) || !v.length || v.some(x => typeof x !== 'string' || !x)) errors.push(`Node "${n.id}" match.${k} must be an array of non-empty strings.`);
      }
    }
  }
  const roots = valid.filter(n => n.parent === undefined);
  if (roots.length !== 1) errors.push(`Exactly one root is allowed, found ${roots.length}.`);
  for (const r of roots) {
    if (r.kind !== 'root') errors.push(`Node "${r.id}" has no parent so its kind must be "root".`);
    if (r.match !== undefined) errors.push(`Root node "${r.id}" must not have match.`);
  }
  for (const n of valid) if (n.parent !== undefined && n.kind === 'root') errors.push(`Node "${n.id}" has a parent so its kind cannot be "root".`);
  // cycles and depth: walk up from each node
  const depth = Object.create(null), cyc = new Set();
  for (const n of valid) {
    const seen = new Set(); let cur = n, level = 1, cycle = false;
    while (cur.parent !== undefined && cur.parent in byId) {
      if (seen.has(cur.id)) { cycle = true; break; }
      seen.add(cur.id); cur = byId[cur.parent]; level++;
    }
    if (cycle || seen.has(cur.id)) { cyc.add(n.id); continue; }
    depth[n.id] = level;
  }
  for (const id of cyc) errors.push(`Node "${id}" is part of a cycle or leads into one.`);
  for (const n of valid) if (depth[n.id] > MAX_LEVELS) errors.push(`Node "${n.id}" is at level ${depth[n.id]}; at most ${MAX_LEVELS} levels are allowed.`);
  return errors;
}

export function loadTree(root, productId, moduleId) {
  const id = String(moduleId ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid module id.');
  const file = path.join(root, ...resolveModuleFolder(root, 'qa', productId, id).split('/'), 'tree.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let tree;
  try { tree = JSON.parse(text); } catch (e) { throw new Error(`Tree file for "${id}" is not valid JSON: ${e.message}`); }
  const errors = validateTree(tree);
  if (errors.length) throw new Error(`Invalid tree for "${id}": ${errors.slice(0, 5).join(' ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`);
  return tree;
}

// Precedence: the node with the most declared match keys wins. Equal scores go to the FIRST node in file order,
// so a broad single-key node listed earlier (for example an action-only group) beats a later single-key variant.
export function assignCases(tree, cases) {
  const byNode = Object.create(null); const unassigned = [];
  const matchers = [];
  for (const n of tree.nodes) { byNode[n.id] = []; const keys = n.match ? Object.keys(n.match) : []; if (keys.length) matchers.push({ id: n.id, match: n.match, keys }); }
  for (const c of Array.isArray(cases) ? cases : []) {
    if (!isObj(c)) continue;
    let best = null, bestScore = 0;
    for (const m of matchers) {
      if (m.keys.length <= bestScore) continue;
      if (m.keys.every(k => c[k] !== undefined && c[k] !== null && m.match[k].includes(c[k]))) { best = m.id; bestScore = m.keys.length; }
    }
    if (best) byNode[best].push(c.id); else if (c.id !== undefined) unassigned.push(c.id);
  }
  return { byNode: { ...byNode }, unassigned };
}

const FAILED = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const zero = () => ({ total: 0, passed: 0, failed: 0, blocked: 0, other: 0 });

// results: latest per case; when an id appears more than once the LAST entry wins. Results for ids not in the tree are ignored.
export function rollupTree(tree, byNode, results) {
  const status = Object.create(null);
  for (const r of Array.isArray(results) ? results : []) if (isObj(r) && r.id !== undefined) status[r.id] = r.status;
  const out = Object.create(null), kids = Object.create(null);
  for (const n of tree.nodes) { out[n.id] = { ...zero(), subtree: zero() }; kids[n.id] = []; }
  for (const n of tree.nodes) if (n.parent !== undefined && kids[n.parent]) kids[n.parent].push(n.id);
  for (const n of tree.nodes) {
    const own = out[n.id];
    for (const id of (isObj(byNode) && Object.hasOwn(byNode, n.id) && Array.isArray(byNode[n.id]) ? byNode[n.id] : [])) {
      const s = status[id]; own.total++;
      if (s === 'PASS') own.passed++; else if (FAILED.has(s)) own.failed++; else if (s === 'BLOCKED') own.blocked++; else own.other++;
    }
    Object.assign(own.subtree, { total: own.total, passed: own.passed, failed: own.failed, blocked: own.blocked, other: own.other });
  }
  // post-order accumulation from the root(s), iteratively
  const order = [], stack = tree.nodes.filter(n => n.parent === undefined || !kids[n.parent]).map(n => n.id), seen = new Set();
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); order.push(id); stack.push(...kids[id]); }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    for (const k of kids[id]) for (const f of Object.keys(zero())) out[id].subtree[f] += out[k].subtree[f];
  }
  return { ...out };
}
