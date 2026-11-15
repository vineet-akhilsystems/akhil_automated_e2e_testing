import fs from 'node:fs';
import { resolveModuleFolder } from './module-layout.mjs';

/** Repo-relative folder of a module (forward slashes): `qa/<product>/<folder>` or `tests/<product>/<folder>`.
 *  Delegates to the single resolver in module-layout.mjs; product and module id are both required.
 *  The old flat layout (`<kind>/modules/<id>`) is gone and is not resolved; the folder is always the product-scoped one.
 *  `root` is the repo root; Playwright runs from it, so the default `.` matches the existing relative paths. */
export function moduleDir(kind: 'qa' | 'tests', productId: string, id: string, root = '.'): string {
  return resolveModuleFolder(root, kind, productId, id);
}

/** Reads the portal CASES_FILE snapshot (or an optional fallback JSON path) without duplicating file logic per spec. */
export function readCasesSnapshot<T = unknown>(fallbackPath?: string): { bases: Record<string, Record<string, string>>; cases: T[] } {
  const file = process.env.CASES_FILE || (fallbackPath && fs.existsSync(fallbackPath) ? fallbackPath : '');
  if (!file || !fs.existsSync(file)) return { bases: {}, cases: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { bases: parsed?.bases ?? {}, cases: Array.isArray(parsed?.cases) ? parsed.cases : [] };
}
