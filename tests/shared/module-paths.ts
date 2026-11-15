import { resolveModuleFolder } from './module-layout.mjs';

/** Repo-relative folder of a module (forward slashes): `qa/<product>/<folder>` or `tests/<product>/<folder>`.
 *  Delegates to the single resolver in module-layout.mjs; product and module id are both required.
 *  Runtime (disk-aware) version: while the folders are still in the old flat layout the resolver falls back to
 *  `<kind>/modules/<id>` when the product-scoped folder does not exist (removed with the move in Task 3).
 *  `root` is the repo root; Playwright runs from it, so the default `.` matches the existing relative paths. */
export function moduleDir(kind: 'qa' | 'tests', productId: string, id: string, root = '.'): string {
  return resolveModuleFolder(root, kind, productId, id);
}
