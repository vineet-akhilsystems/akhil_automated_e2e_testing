// Plugin loader. Pure code: no I/O, and it must not import portal/registry.mjs (avoids import cycles).
// createPluginRegistry() builds an isolated registry (used by tests); the exported functions wrap one shared instance.
import { assertPlugin } from './contract.mjs';

export function createPluginRegistry() {
  const byId = new Map();
  function registerPlugin(p) {
    assertPlugin(p);
    if (byId.has(p.id)) throw new Error(`Module plugin "${p.id}" is already registered.`);
    byId.set(p.id, p);
    return p;
  }
  // Accepts a module record or a plain id string; matches module.adapter first, then module.id.
  function pluginFor(moduleOrId) {
    if (typeof moduleOrId === 'string') return byId.get(moduleOrId);
    if (!moduleOrId || typeof moduleOrId !== 'object') return undefined;
    const { adapter, id } = moduleOrId;
    return (typeof adapter === 'string' ? byId.get(adapter) : undefined) ?? (typeof id === 'string' ? byId.get(id) : undefined);
  }
  const plugins = () => [...byId.values()];
  const reservedIds = () => new Set(byId.keys());
  return { registerPlugin, pluginFor, plugins, reservedIds };
}

const shared = createPluginRegistry();
export const registerPlugin = shared.registerPlugin;
export const pluginFor = shared.pluginFor;
export const plugins = shared.plugins;
export const reservedIds = shared.reservedIds;
