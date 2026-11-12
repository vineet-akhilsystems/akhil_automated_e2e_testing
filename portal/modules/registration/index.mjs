// Registration module plugin. Must not import portal/registry.mjs (avoids import cycles).
import { registerPlugin } from '../index.mjs';
import { assertPlugin } from '../contract.mjs';
import { registrationAdapter } from './adapter.mjs';
import { registrationValidate } from './validate.mjs';
import { seed } from './seed.mjs';
import { registrationAi } from './ai.mjs';
import { registrationAgent } from './agent.mjs';

const plugin = { id: 'registration', builtIn: true, adapter: registrationAdapter, validate: registrationValidate, seed, ai: registrationAi, agent: registrationAgent, discovery: true, updateTargetLabel: 'Patient ID or dependency token' };
assertPlugin(plugin);
registerPlugin(plugin);
export default plugin;
