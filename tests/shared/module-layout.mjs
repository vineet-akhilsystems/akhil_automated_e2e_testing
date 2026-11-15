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

function checkProduct(productId) {
  checkId('product id', productId);
  if (RESERVED_PRODUCT_NAMES.includes(productId)) {
    throw new Error(`Invalid product id ${JSON.stringify(productId)}: that name is reserved for shared folders (${RESERVED_PRODUCT_NAMES.join(', ')})`);
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
