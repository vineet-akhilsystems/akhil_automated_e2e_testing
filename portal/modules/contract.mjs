// Module plugin contract. Pure code: no I/O, and it must not import portal/registry.mjs (avoids import cycles).
//
// A plugin is repo code (never loaded from a user-supplied path) describing one built-in module:
//   {
//     id:        /^[a-z][a-z0-9-]*$/                     required, unique across plugins
//     adapter:   { id, name, spec, fields, actions, outcomes, variants,   required; same shape as a built-in adapter
//                  [variantLabel, targetLabel, targetPlaceholder, prefix, bases] }
//     builtIn:   true                                    required; marks the id as reserved (no adapter.json override)
//     validate:  { afterOutcome, blockedSource, checkInput, workflow, afterWorkflow }   optional; see below
//     updateTargetLabel: string                          optional
//     seed(store) -> void                                optional; run once on a fresh data dir
//     ai:        object                                  optional; AI-generation data (presets, pool, requirement map)
//     agent:     { referenceDir, referenceLabel, referenceFirst, crossFieldExamples(module) -> string|undefined }   optional
//                                                        referenceDir is repo-relative; the first plugin defining it supplies the agent's reference files
//     discovery: true                                    optional; the module's live discovery output counts as existing when its folder is non-empty
//   }
//
// Validation hooks (plugin.validate, optional object; every present member must be a function). validateCase() in
// portal/registry.mjs calls them at fixed points, in this order, for the plugin found by pluginFor(module).
// Each receives ctx = { module, adapter, check, textValue } as its last argument (plugins must not import registry.mjs).
//   afterOutcome(c, ctx)           after the generic action/outcome checks; before the unavailable branch
//   blockedSource(c, ctx) -> src   in the 'unavailable' branch; returns the reviewed source case (or undefined) used for blocker checks
//   checkInput(key, value, ctx)    per input field, after the generic field/type/length checks
//   workflow(c, ctx) -> boolean    after the base-template check; return true when it handled the case (validateCase then returns c)
//   afterWorkflow(c, ctx)          only when workflow() did not handle the case; before the generic search handling
// updateTargetLabel (string, optional): label for the Update action's target text check; default 'Target record or dependency token'.

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const ADAPTER_REQUIRED = { id: 'string', name: 'string', spec: 'string', fields: 'object', actions: 'object', outcomes: 'array', variants: 'array' };
const ADAPTER_OPTIONAL_STRINGS = ['variantLabel', 'targetLabel', 'targetPlaceholder', 'prefix'];
const HOOK_FUNCTIONS = ['seed'];
const HOOK_OBJECTS = ['ai', 'agent'];
const VALIDATE_HOOKS = ['afterOutcome', 'blockedSource', 'checkInput', 'workflow', 'afterWorkflow'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function assertPlugin(p) {
  if (!isObject(p)) throw new Error('A module plugin must be an object.');
  if (typeof p.id !== 'string' || !PLUGIN_ID.test(p.id)) throw new Error('Module plugin id must match /^[a-z][a-z0-9-]*$/.');
  const where = `Module plugin "${p.id}"`;
  if (!isObject(p.adapter)) throw new Error(`${where} needs an adapter object.`);
  for (const [key, type] of Object.entries(ADAPTER_REQUIRED)) {
    const v = p.adapter[key];
    const ok = type === 'string' ? typeof v === 'string' && v !== '' : type === 'array' ? Array.isArray(v) : isObject(v);
    if (!ok) throw new Error(`${where} adapter.${key} must be ${type === 'array' ? 'an array' : `a${type === 'object' ? 'n' : ''} ${type}`}.`);
  }
  for (const key of ADAPTER_OPTIONAL_STRINGS) {
    if (p.adapter[key] !== undefined && typeof p.adapter[key] !== 'string') throw new Error(`${where} adapter.${key} must be a string when present.`);
  }
  if (p.adapter.bases !== undefined && !isObject(p.adapter.bases) && !Array.isArray(p.adapter.bases)) throw new Error(`${where} adapter.bases must be an object or array when present.`);
  if (p.builtIn !== true) throw new Error(`${where} must set builtIn: true.`);
  for (const key of HOOK_FUNCTIONS) {
    if (p[key] !== undefined && typeof p[key] !== 'function') throw new Error(`${where} ${key} must be a function when present.`);
  }
  for (const key of HOOK_OBJECTS) {
    if (p[key] !== undefined && !isObject(p[key])) throw new Error(`${where} ${key} must be an object when present.`);
  }
  if (p.validate !== undefined) {
    if (!isObject(p.validate)) throw new Error(`${where} validate must be an object when present.`);
    for (const [key, fn] of Object.entries(p.validate)) {
      if (!VALIDATE_HOOKS.includes(key)) throw new Error(`${where} validate.${key} is not a known hook.`);
      if (typeof fn !== 'function') throw new Error(`${where} validate.${key} must be a function.`);
    }
  }
  if (p.discovery !== undefined && typeof p.discovery !== 'boolean') throw new Error(`${where} discovery must be a boolean when present.`);
  if (p.updateTargetLabel !== undefined && typeof p.updateTargetLabel !== 'string') throw new Error(`${where} updateTargetLabel must be a string when present.`);
  return p;
}
