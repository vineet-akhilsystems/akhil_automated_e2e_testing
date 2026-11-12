/** Repo-relative folder of a portal module: `qa/modules/<id>` or `tests/modules/<id>` (forward slashes).
 *  The id is required: module code passes its own id, so a missing id can never fall back to another module's folders. */
export function moduleDir(kind: 'qa' | 'tests', id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid module id: ${JSON.stringify(id)} (expected lowercase letters, digits and hyphens)`);
  return `${kind}/modules/${id}`;
}
