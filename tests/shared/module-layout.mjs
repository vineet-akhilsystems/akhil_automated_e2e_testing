import fs from 'node:fs';
import path from 'node:path';

// Single source of truth for where a module's files live. Imported by portal code (via portal/module-layout.mjs)
// and by Playwright TS (via tests/shared/module-paths.ts). Pure apart from listProductFolders, which reads one directory.
//   qa/<product>/<folder>, tests/<product>/<folder>, portal/modules/<product>/<folder>
// folder = module id with a leading "<product>-" removed (only when something remains).

export const KINDS = ['qa', 'tests', 'portal'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// Directories under qa/ and tests/ that hold shared (not product-scoped) content.
const RESERVED_BY_KIND = {
  qa: ['knowledge', 'tools'],
  tests: ['shared', 'fixtures', 'discovery', 'smoke'],
  portal: [],
};
export const RESERVED_PRODUCT_NAMES = [...new Set(Object.values(RESERVED_BY_KIND).flat())];

function checkKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown folder kind ${JSON.stringify(kind)} (expected one of: ${KINDS.join(', ')})`);
}

function checkId(label, value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} ${JSON.stringify(value)}: use lowercase letters, digits and hyphens only, starting with a letter or digit (no slashes, dots or spaces)`);
  }
}

// "modules" is also blocked as a product while the old flat layout (qa/modules/<id>) exists: (qa, modules, x) would collide with it. Task 3 removes it.
const BLOCKED_PRODUCT_NAMES = [...RESERVED_PRODUCT_NAMES, 'modules'];
/** True when `productId` cannot be used as a product folder (reserved for shared folders or the legacy layout). */
export function isReservedProductName(productId) { return BLOCKED_PRODUCT_NAMES.includes(productId); }

function checkProduct(productId) {
  checkId('product id', productId);
  if (isReservedProductName(productId)) {
    throw new Error(`Invalid product id ${JSON.stringify(productId)}: that name is reserved for shared folders (${BLOCKED_PRODUCT_NAMES.join(', ')})`);
  }
}

function base(kind) {
  return kind === 'portal' ? 'portal/modules' : kind;
}

export function productFolder(kind, productId) {
  checkKind(kind);
  checkProduct(productId);
  return `${base(kind)}/${productId}`;
}

export function moduleFolder(kind, productId, moduleId) {
  checkKind(kind);
  checkProduct(productId);
  checkId('module id', moduleId);
  const prefix = `${productId}-`;
  const folder = moduleId.startsWith(prefix) && moduleId.length > prefix.length ? moduleId.slice(prefix.length) : moduleId;
  return `${base(kind)}/${productId}/${folder}`;
}

// Product ids that have a folder for this kind under `root` (a repo root). Skips files, shared folders and non-id names.
export function listProductFolders(root, kind) {
  checkKind(kind);
  const dir = path.join(root, ...base(kind).split('/'));
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  const reserved = RESERVED_BY_KIND[kind];
  return entries
    .filter(e => e.isDirectory() && ID_PATTERN.test(e.name) && !reserved.includes(e.name))
    .map(e => e.name)
    .sort();
}

// TEMPORARY COMPATIBILITY (Task 2 of the product-scoped layout plan; Task 3 deletes this block and resolveModuleFolder's fallback):
// the folders still live in the old flat layout (qa/modules/<id>, tests/modules/<id>, portal/modules/<id>) until they are moved.
const LEGACY_BASE = { qa: 'qa/modules', tests: 'tests/modules', portal: 'portal/modules' };
export function legacyModuleFolder(kind, moduleId) {
  checkKind(kind);
  checkId('module id', moduleId);
  return `${LEGACY_BASE[kind]}/${moduleId}`;
}

// Runtime version of moduleFolder (reads the disk): the product-scoped folder when it exists under `root`; otherwise, for the
// augastam product ONLY (the only product with flat content), the legacy flat folder when THAT exists; otherwise the product-scoped folder (so new modules get the new layout). moduleFolder itself stays pure and strict.
export function resolveModuleFolder(root, kind, productId, moduleId) {
  const scoped = moduleFolder(kind, productId, moduleId);
  const isDir = rel => { try { return fs.statSync(path.join(root, ...rel.split('/'))).isDirectory(); } catch { return false; } };
  if (isDir(scoped)) return scoped;
  if (productId !== 'augastam') return scoped;
  const legacy = legacyModuleFolder(kind, moduleId);
  return isDir(legacy) ? legacy : scoped;
}
