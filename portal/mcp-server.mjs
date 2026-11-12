#!/usr/bin/env node
// MCP server (stdio) that lets your assistant (Claude, ChatGPT, etc.) work with Test Studio:
// read a module's uploaded files, write back insights + draft test cases, and read run results.
// No extra dependencies. Configure with env vars:
//   PORTAL_URL            default http://127.0.0.1:4173
//   PORTAL_MCP_USER / PORTAL_MCP_PASSWORD   a portal account with a "ba" or "tester" membership on the modules it should work on (it only sees modules it is a member of; drafts always need human approval)
//   PORTAL_MCP_TOKEN      only if the portal runs in old single-access-key mode
const BASE = (process.env.PORTAL_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
let cookie = '';

async function login() {
  const body = process.env.PORTAL_MCP_USER
    ? { username: process.env.PORTAL_MCP_USER, password: process.env.PORTAL_MCP_PASSWORD ?? '' }
    : { token: process.env.PORTAL_MCP_TOKEN ?? '' };
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Portal login failed (${res.status}). Check PORTAL_MCP_USER / PORTAL_MCP_PASSWORD.`);
  cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

async function api(method, path, body, retry = true) {
  if (!cookie) await login();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) { cookie = ''; return api(method, path, body, false); }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.message || `Portal returned ${res.status}`);
  return data;
}

const enc = encodeURIComponent;
const caseSchema = {
  type: 'object', required: ['title', 'steps'],
  properties: {
    title: { type: 'string' }, category: { type: 'string', description: 'Suite or feature name' }, priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
    preconditions: { type: 'string' }, requirement: { type: 'string' },
    source: { type: 'string', description: 'Which uploaded file or section this came from' },
    steps: { type: 'array', items: { type: 'object', required: ['action'], properties: { action: { type: 'string' }, expected: { type: 'string' } } } },
  },
};
const textItems = { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', required: ['text'], properties: { text: { type: 'string' }, source: { type: 'string' } } }] } };
const moduleOnly = { type: 'object', required: ['moduleId'], properties: { moduleId: { type: 'string' } } };

// No per-module schema endpoint exists, so build it from /api/bootstrap (modules + adapters).
// Modules of every product (or one), tagged with productId/productName. Module ids are unique across products.
async function allModules(product) {
  const first = await api('GET', `/api/bootstrap${product ? `?product=${enc(product)}` : ''}`);
  const boots = [first];
  if (!product) for (const p of first.products ?? []) if (p.id !== first.product?.id) boots.push(await api('GET', `/api/bootstrap?product=${enc(p.id)}`));
  return { adapters: first.adapters ?? [], modules: boots.flatMap(b => (b.modules ?? []).map(m => ({ ...m, productId: m.productId ?? b.product?.id, productName: b.product?.name }))) };
}

function moduleSchema(boot, moduleId) {
  const m = (boot.modules ?? []).find(x => x.id === moduleId);
  if (!m) throw new Error(`Module "${moduleId}" not found.`);
  const adapter = m.adapter ? (boot.adapters ?? []).find(a => a.id === m.adapter || a.name === m.adapter || a.key === m.adapter) ?? { id: m.adapter } : null;
  return { moduleId: m.id, productId: m.productId, productName: m.productName, name: m.name, prefix: m.prefix, adapter, templates: m.config?.bases ?? {}, requirements: m.config?.requirements ?? [],
    note: adapter ? 'Cases for this module may be automated; they are saved as drafts needing human approval.' : 'No adapter: manual cases only.' };
}

const TOOLS = [
  { name: 'list_modules', description: 'List modules (id, productId, productName, name, area, counts of draft/rejected cases). Pass product (e.g. "augastam" or "miracle") to list one product only; otherwise all products are listed.',
    inputSchema: { type: 'object', properties: { product: { type: 'string', description: 'Product id filter, e.g. augastam or miracle' } } },
    run: async ({ product } = {}) => (await allModules(product)).modules },
  { name: 'list_intake_files', description: 'List files the BA team uploaded for a module, with extraction status, and whether insights exist.', inputSchema: moduleOnly,
    run: ({ moduleId }) => api('GET', `/api/modules/${enc(moduleId)}/intake`) },
  { name: 'read_intake_file',
    description: 'Read the extracted text of one uploaded file (Excel/CSV/Word/PDF/text). Images have no text, and videos with only keyframes (extract "partial") have no transcript and their visuals were not interpreted; ask the BA for a transcript. Use offset to page through long files.',
    inputSchema: { type: 'object', required: ['moduleId', 'fileId'], properties: { moduleId: { type: 'string' }, fileId: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number', description: 'Max characters, default 60000' } } },
    run: ({ moduleId, fileId, offset = 0, limit = 60000 }) => api('GET', `/api/modules/${enc(moduleId)}/intake/files/${enc(fileId)}/text?offset=${Number(offset) || 0}&limit=${Number(limit) || 60000}`) },
  { name: 'list_cases', description: 'List existing test cases for a module (id, title, reviewStatus) so you do not duplicate them.', inputSchema: moduleOnly,
    run: async ({ moduleId }) => (await api('GET', `/api/modules/${enc(moduleId)}/cases`)).map(c => ({ id: c.id, title: c.title, category: c.category, priority: c.priority, reviewStatus: c.reviewStatus ?? 'approved', mode: c.mode })) },
  { name: 'get_insights', description: 'Get the latest saved insights document for a module (404 if none).', inputSchema: moduleOnly,
    run: ({ moduleId }) => api('GET', `/api/modules/${enc(moduleId)}/insights`) },
  { name: 'save_insights',
    description: 'Save your analysis of a module: summary, fields, business rules, flows, edge cases, open questions, plus proposed test cases. Cases are saved as DRAFTS; a human must approve them in the portal before any run. Cite the source file for each item.',
    inputSchema: { type: 'object', required: ['moduleId', 'summary'], properties: {
      moduleId: { type: 'string' }, summary: { type: 'string' },
      fields: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, type: { type: 'string' }, required: { type: 'boolean' }, description: { type: 'string' }, source: { type: 'string' } } } },
      rules: textItems, edgeCases: textItems, openQuestions: textItems,
      flows: { type: 'array', items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, source: { type: 'string' } } } },
      cases: { type: 'array', items: caseSchema } } },
    run: ({ moduleId, ...doc }) => api('PUT', `/api/modules/${enc(moduleId)}/insights`, doc) },
  { name: 'get_module_coverage',
    description: 'Coverage report for a module: which fields, requirements and actions have cases, and what is uncovered. Read-only; use it to decide what to propose next.',
    inputSchema: { type: 'object', required: ['moduleId'], properties: { moduleId: { type: 'string' }, environmentId: { type: 'string', description: 'Configured environment id; defaults to the portal default' } } },
    run: ({ moduleId, environmentId }) => api('GET', `/api/modules/${enc(moduleId)}/coverage${environmentId ? `?environmentId=${enc(environmentId)}` : ''}`) },
  { name: 'generate_ai_cases',
    description: 'Ask the portal\'s built-in schema-and-coverage synthesizer (rule-based, not an LLM call) for suggested case drafts. NOTHING IS SAVED: the result is a list of proposals that a human must review. To store them as draft cases in the review queue, pass them to propose_automated_cases (modules with an adapter) or save_insights. Drafts still need human approval before any run.',
    inputSchema: { type: 'object', required: ['moduleId'], properties: { moduleId: { type: 'string' }, count: { type: 'number', description: '1-20, default 5' }, prompt: { type: 'string' }, focus: { type: 'string', description: 'Focus area, default "all"' }, targetField: { type: 'string' }, targetVariant: { type: 'string' }, priority: { enum: ['P0', 'P1', 'P2', 'P3'] }, mode: { enum: ['automated', 'manual'] } } },
    run: ({ moduleId, ...options }) => api('POST', `/api/modules/${enc(moduleId)}/ai-generate`, options) },
  { name: 'get_module_schema',
    description: 'What a module can automate: its adapter (fields, actions, outcomes, variants) and its starting-data templates (bases). If adapter is null the module is manual-only. Read this before propose_automated_cases.',
    inputSchema: moduleOnly,
    run: async ({ moduleId }) => moduleSchema(await allModules(), moduleId) },
  { name: 'propose_automated_cases',
    description: 'Save structured automated test cases for a module that has an adapter. They are saved as DRAFTS in the review queue; a human must approve them in the portal before they can run. Each case needs title, category, action, input (field map) and expected ({outcome, ...}); see get_module_schema. Cases are checked by the portal and invalid ones are reported, not saved. Modules without an adapter get an explanation instead; use save_insights for manual cases.',
    inputSchema: { type: 'object', required: ['moduleId', 'cases'], properties: { moduleId: { type: 'string' }, cases: { type: 'array', items: { type: 'object', required: ['title', 'action', 'expected'], properties: {
      id: { type: 'string', description: 'Optional; assigned from the module prefix when omitted' }, title: { type: 'string' }, category: { type: 'string' }, priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
      action: { type: 'string' }, input: { type: 'object' }, expected: { type: 'object', required: ['outcome'], properties: { outcome: { type: 'string' } } },
      base: { type: 'string', description: 'Starting-data template name' }, target: { type: 'string' }, registrationType: { type: 'string' }, requirement: { type: 'string' }, preconditions: { type: 'string' }, notes: { type: 'string' } } } } } },
    run: async ({ moduleId, cases }) => {
      const schema = moduleSchema(await allModules(), moduleId);
      if (!schema.adapter) return { saved: 0, reason: `Module "${moduleId}" has no automation adapter, so structured automated cases cannot be saved. Use save_insights to propose manual cases as drafts.` };
      if (!Array.isArray(cases) || !cases.length) throw new Error('Provide at least one case.');
      const existing = await api('GET', `/api/modules/${enc(moduleId)}/cases`);
      const taken = new Set(existing.map(c => c.id)), prefix = schema.prefix || 'TC';
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
      let n = existing.reduce((m, c) => Math.max(m, Number(re.exec(c.id)?.[1] ?? 0)), 0);
      const nextId = () => { let id; do id = `${prefix}-${String(++n).padStart(3, '0')}`; while (taken.has(id)); taken.add(id); return id; };
      const saved = [], failed = [];
      for (const c of cases.slice(0, 50)) {
        const { aiRationale, ...rest } = c ?? {};
        // An AI-written update may only point at a case-created record ({{name@CASE-ID}}), never at a literal patient id.
        if (rest.target !== undefined && !/^\{\{[\w-]+@[\w-]+\}\}$/.test(String(rest.target).trim())) { failed.push({ title: c?.title, error: 'target must be a {{name@CASE-ID}} reference to a record another case creates; literal ids are not accepted from assistants.' }); continue; }
        const body = { ...rest, id: rest.id || nextId(), mode: 'automated', category: rest.category || 'General', reviewStatus: 'draft', enabled: true, steps: rest.steps ?? [], notes: [rest.notes, aiRationale && `AI Rationale: ${aiRationale}`, 'Proposed by an assistant over MCP. Needs human review before it can be run.'].filter(Boolean).join('\n') };
        try { const r = await api('POST', `/api/modules/${enc(moduleId)}/cases`, body); saved.push({ id: r.id, title: r.title, reviewStatus: r.reviewStatus }); }
        catch (e) { failed.push({ title: c?.title, error: String(e.message ?? e) }); }
      }
      return { saved: saved.length, failed: failed.length, cases: saved, errors: failed, note: 'Saved as drafts; a human must approve them in the portal before any run.' };
    } },
  { name: 'list_runs', description: 'List recent test runs with status and counts.', inputSchema: { type: 'object', properties: {} },
    run: async () => { const b = await api('GET', '/api/runs'); return Array.isArray(b) ? b.slice(0, 30) : b; } },
  { name: 'get_run', description: 'Get one run with per-case expected vs actual results.', inputSchema: { type: 'object', required: ['runId'], properties: { runId: { type: 'string' } } },
    run: ({ runId }) => api('GET', `/api/runs/${enc(runId)}`) },
];

const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ id, result: {
      protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'augastam-test-studio', version: '0.1.0' },
      instructions: 'Workflow: list_modules -> list_intake_files -> read_intake_file for each file -> save_insights with a summary and proposed cases. Cases stay drafts until a human approves them in the portal.' } });
  }
  if (method?.startsWith('notifications/')) return;
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    try {
      const out = await tool.run(params.arguments ?? {});
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
    } catch (e) {
      return send({ id, result: { isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] } });
    }
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)).catch(e => process.stderr.write(String(e) + '\n')); } catch { /* ignore a malformed line */ }
  }
});
