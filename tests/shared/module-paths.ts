import { moduleFolder } from './module-layout.mjs';

/** Repo-relative folder of a module (forward slashes): `qa/<product>/<folder>` or `tests/<product>/<folder>`.
 *  Delegates to the single resolver in module-layout.mjs. Product and module id are both required. */
export function moduleDir(kind: 'qa' | 'tests', productId: string, id: string): string {
  return moduleFolder(kind, productId, id);
}

/** TEMPORARY (removed by Task 2/3 of the product-scoped layout plan): the OLD flat path `<kind>/modules/<id>`. */
export function legacyModuleDir(kind: 'qa' | 'tests', id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid module id: ${JSON.stringify(id)} (expected lowercase letters, digits and hyphens)`);
  return `${kind}/modules/${id}`;
}
