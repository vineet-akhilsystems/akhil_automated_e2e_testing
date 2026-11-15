import { resolveModuleFolder } from './module-layout.mjs';

/** Repo-relative folder of a module (forward slashes): `qa/<product>/<folder>` or `tests/<product>/<folder>`.
 *  Delegates to the single resolver in module-layout.mjs; product and module id are both required.
 *  The old flat layout (`<kind>/modules/<id>`) is gone and is not resolved; the folder is always the product-scoped one.
 *  `root` is the repo root; Playwright runs from it, so the default `.` matches the existing relative paths. */
export function moduleDir(kind: 'qa' | 'tests', productId: string, id: string, root = '.'): string {
  return resolveModuleFolder(root, kind, productId, id);
}
