import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';

// Generic, READ-ONLY discovery of any EMR module page. Parameterised by environment:
//   MODULE_ID        required, /^[a-z][a-z0-9-]*$/          e.g. billing
//   MODULE_URL       required, app path starting with "/"    e.g. /billing
//   MODULE_VARIANTS  optional, comma list of tab/type labels to click and re-scan
// Output (qa/modules/<MODULE_ID>/discovery/):
//   fields-default.json, fields-<variant>.json   same shape as registration's fields-<type>.json
//   layout-<variant>.json                        cards, buttons (names only) and table headers
//   config/*.json                                configuration-service / lookup responses (secrets redacted)
//   discovery.md                                 human-readable table
// Safety: never saves/submits/deletes. Mutating HTTP calls are aborted, variant labels that look
// destructive are refused, and every file written is scrubbed of tokens / session values.
// Feed the result to: npm run module:scaffold -- <MODULE_ID>

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;
const MAX_OPTIONS = 300;
const MAX_CONFIG_BYTES = 5_000_000;
const DESTRUCTIVE = /\b(save|submit|delete|remove|discard|reset|confirm|approve|reject|cancel|clear|log ?out|sign ?out|pay|checkout|send|publish|archive|update|create|add)\b/i;
// Non-GET requests are allowed only when the LAST path segment STARTS with one of these read verbs
// and contains none of the write words; everything else (and any mutation-looking body) is aborted.
const READ_VERB_START = /^(search|lookup|list|get|query|find|filter)/i;
const WRITE_WORDS = /(add|create|save|update|delete|remove|submit|post|register|book|cancel|confirm)/i;
const MUTATING_BODY = /\bmutation\b|"(?:action|operation|operationName|op|method|command)"\s*:\s*"[^"]*(?:add|create|save|update|delete|remove|submit|register|book|cancel|confirm)/i;
// Ids that already have a built-in adapter/discovery notes: discovery must never overwrite them.
// Built-in = a plugin folder under portal/modules/ that has an index.mjs. No portal code imported.
const BUILTIN_MODULE_IDS = new Set(
  fs.readdirSync(path.join('portal', 'modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join('portal', 'modules', d.name, 'index.mjs')))
    .map((d) => d.name)
);

function isReadOnlyRequest(method: string, urlStr: string, body: string | null): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (method !== 'POST') return false;
  const segs = new URL(urlStr).pathname.split('/').filter(Boolean);
  const last = decodeURIComponent(segs[segs.length - 1] ?? '');
  if (!READ_VERB_START.test(last) || WRITE_WORDS.test(last)) return false;
  if (body && MUTATING_BODY.test(body)) return false;
  return true;
}

// Service workers could issue requests that bypass page.route, so they are blocked for this spec.
test.use({ serviceWorkers: 'block' });
const SECRET_KEY = /(token|password|passwd|secret|authorization|cookie|api[-_]?key|session|jwt|credential)/i;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g;

interface FieldInfo {
  card: string; label: string; required: boolean; kind: string; column: string;
  default: string; disabled: boolean; options?: string[]; optionsNote?: string;
}
interface Layout { cards: string[]; buttons: { card: string; text: string; destructive: boolean }[]; tables: { card: string; headers: string[] }[] }

// ---- secret hygiene -------------------------------------------------------------------------------

function sessionSecrets(): string[] {
  const file = `${process.env.AUTH_DIR ?? '.auth'}/session.json`;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    return Object.values(s).filter((v) => typeof v === 'string' && v.length >= 16);
  } catch { return []; }
}
const SECRETS = sessionSecrets();

function scrub(text: string): string {
  let out = text.replace(JWT, '[REDACTED]').replace(/Bearer\s+[\w.~+/=-]{8,}/gi, 'Bearer [REDACTED]');
  for (const s of SECRETS) out = out.split(s).join('[REDACTED]');
  return out;
}

function redactJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactJson);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) && x !== null && typeof x !== 'object' ? '[REDACTED]' : redactJson(x)]));
  }
  return v;
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, scrub(content));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---- test -----------------------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test('discover module fields, options and backend config (read-only)', async ({ page }) => {
  test.setTimeout(20 * 60_000);

  const moduleId = process.env.MODULE_ID ?? '';
  const moduleUrl = process.env.MODULE_URL ?? '';
  test.skip(!moduleId, 'MODULE_ID is not set; module discovery runs only via `MODULE_ID=<id> MODULE_URL=/<path> npm run module:discover`.');
  if (BUILTIN_MODULE_IDS.has(moduleId)) throw new Error(`MODULE_ID "${moduleId}" has a built-in adapter and its own discovery (npm run reg:discover); refusing to overwrite its notes.`);
  if (!MODULE_ID_RE.test(moduleId)) throw new Error(`MODULE_ID must match ${MODULE_ID_RE} (got "${moduleId}"). Example: MODULE_ID=billing`);
  if (!/^\/(?![/\\])[^\s\\]*$/.test(moduleUrl)) throw new Error(`MODULE_URL must be an app path starting with a single "/" (got "${moduleUrl}"). Example: MODULE_URL=/billing`);
  const variants = (process.env.MODULE_VARIANTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const refused = variants.filter((v) => DESTRUCTIVE.test(v));
  if (refused.length) throw new Error(`Refusing destructive-looking MODULE_VARIANTS (discovery is read-only): ${refused.join(', ')}`);

  const OUT = path.join('qa', 'modules', moduleId, 'discovery');
  fs.mkdirSync(path.join(OUT, 'config'), { recursive: true });

  // Read-only guard: abort anything that could change data.
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const req = route.request();
    const m = req.method();
    let safe = false;
    try { safe = isReadOnlyRequest(m, req.url(), req.postData()); } catch { safe = false; }
    if (safe) return route.continue();
    blocked.push(`${m} ${new URL(req.url()).pathname}`);
    return route.abort('blockedbyclient');
  });

  // Capture configuration-service and lookup JSON (response body only; headers/cookies are never read).
  const seen = new Set<string>();
  const configFiles: string[] = [];
  page.on('response', async (r) => {
    try {
      const u = new URL(r.url());
      if (r.request().method() !== 'GET' || !/configuration-service\/|lookup/i.test(u.pathname)) return;
      if (!/json/i.test(r.headers()['content-type'] ?? '')) return;
      const text = await r.text();
      if (text.length > MAX_CONFIG_BYTES) return;
      const body = JSON.stringify(redactJson(JSON.parse(text)), null, 2);
      const tag = (u.pathname.replace(/^.*configuration-service\//, '') + '__' + [...u.searchParams.entries()].filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => `${k}-${v}`).join('_'))
        .replace(/[^\w.-]+/g, '_').slice(0, 90);
      const name = `${tag}__${crypto.createHash('sha1').update(u.pathname + u.search).digest('hex').slice(0, 6)}.json`;
      if (seen.has(name)) return;
      seen.add(name);
      configFiles.push(name);
      write(path.join(OUT, 'config', name), body);
    } catch { /* non-JSON or aborted response: ignore */ }
  });

  await page.goto(moduleUrl);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  if (/\/(login|signin)\b/i.test(new URL(page.url()).pathname)) throw new Error('Redirected to login: saved session expired. Run `npm run auth`.');
  await page.locator('.form-group, table, [class*="card"]').filter({ visible: true }).first().waitFor({ timeout: 30_000 }).catch(() => undefined);

  const all: Record<string, FieldInfo[]> = {};
  const layouts: Record<string, Layout> = {};
  const missing: string[] = [];

  const scan = async (name: string) => {
    const { fields, layout } = await collect(page);
    for (const f of fields) {
      if (f.kind !== 'select' || f.disabled) continue;
      const opts = await readOptions(page, (f as FieldInfo & { _id: string })._id, f.default);
      if (Array.isArray(opts)) f.options = opts; else f.optionsNote = opts;
    }
    const clean = fields.map(({ _id, ...rest }: any) => rest as FieldInfo);
    all[name] = clean;
    layouts[name] = layout;
    write(path.join(OUT, `fields-${name}.json`), JSON.stringify(clean, null, 2));
    write(path.join(OUT, `layout-${name}.json`), JSON.stringify(layout, null, 2));
  };

  await test.step('default', () => scan('default'));
  for (const v of variants) {
    await test.step(v, async () => {
      if (!(await clickVariant(page, v))) { missing.push(v); return; }
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      let name = slug(v) || 'variant';
      if (name === 'default' || all[name]) name += '-variant';
      await scan(name);
    });
  }

  write(path.join(OUT, 'discovery.md'), toMarkdown(moduleId, moduleUrl, all, layouts, configFiles, blocked, missing));
  expect.soft(missing, 'variants whose tab/label could not be found').toEqual([]);
  expect(all.default.length, 'no .form-group fields found on the page').toBeGreaterThan(0);
});

// ---- page scraping --------------------------------------------------------------------------------

async function collect(page: Page): Promise<{ fields: any[]; layout: Layout }> {
  return page.evaluate((destructiveSrc) => {
    const destructive = new RegExp(destructiveSrc, 'i');
    const visible = (e: Element) => !!(e as HTMLElement).getBoundingClientRect().width;
    document.querySelectorAll('[data-disc-id]').forEach((e) => e.removeAttribute('data-disc-id'));
    let cards = [...document.querySelectorAll('.registration-card')];
    if (!cards.length) cards = [...document.querySelectorAll('.card, fieldset, section')].filter((c) => !c.parentElement?.closest('.card, fieldset, section'));
    const roots: { el: Element; title: string }[] = cards.length ? cards.map((c) => ({
      el: c,
      title: (c.querySelector('.registration-card-title, .card-title, .card-header, legend, h1, h2, h3, h4') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    })) : [{ el: document.body, title: '' }];

    const fields: any[] = [];
    const layout: any = { cards: [], buttons: [], tables: [] };
    let n = 0;
    for (const { el: card, title } of roots) {
      if (!visible(card)) continue;
      layout.cards.push(title);
      card.querySelectorAll('button, [role=button], a.btn').forEach((b) => {
        const t = (b as HTMLElement).innerText?.replace(/\s+/g, ' ').trim().slice(0, 60);
        if (t && visible(b)) layout.buttons.push({ card: title, text: t, destructive: destructive.test(t) });
      });
      card.querySelectorAll('table').forEach((t) => {
        if (!visible(t)) return;
        const headers = [...t.querySelectorAll('th, [role=columnheader]')].map((h) => (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
        layout.tables.push({ card: title, headers });
      });
      card.querySelectorAll('.form-group').forEach((g) => {
        if (!visible(g)) return;
        const labelEl = g.querySelector('label') as HTMLElement | null;
        const rawLabel = labelEl?.innerText.replace(/\s+/g, ' ').trim() ?? '';
        if (!rawLabel) return;
        const isSelect = !!g.querySelector('input[id^="react-select"]');
        const textarea = g.querySelector('textarea') as HTMLTextAreaElement | null;
        const vis = g.querySelector('input:not([type=hidden]), select') as HTMLInputElement | null;
        const hidden = g.querySelector('input[type=hidden]') as HTMLInputElement | null;
        const single = g.querySelector('[class*="singleValue"]') as HTMLElement | null;
        const kind = isSelect ? 'select' : textarea ? 'textarea' : vis?.name === 'sabyaDate' ? 'date' : vis?.type === 'datetime-local' ? 'datetime' : vis?.tagName === 'SELECT' ? 'select' : vis?.type ?? 'unknown';
        const id = `d${n++}`;
        (g as HTMLElement).setAttribute('data-disc-id', id);
        // Never record the value of password-like inputs.
        const secretInput = vis?.type === 'password';
        fields.push({
          _id: id,
          card: title,
          label: rawLabel.replace(/\*$/, '').trim(),
          required: /\*$/.test(rawLabel),
          kind,
          column: (isSelect ? hidden?.name : textarea?.name || vis?.name) || '',
          default: secretInput ? '' : isSelect ? single?.innerText.trim() ?? '' : (textarea?.value ?? vis?.value ?? ''),
          disabled: !!(vis?.disabled || g.querySelector('[class*="--is-disabled"]')),
        });
      });
    }
    return { fields, layout };
  }, DESTRUCTIVE.source);
}

/** Open a dropdown, read its options, close it without choosing anything. */
async function readOptions(page: Page, id: string, current: string): Promise<string[] | string> {
  const group = page.locator(`[data-disc-id="${id}"]`).filter({ visible: true }).first();
  try {
    await group.scrollIntoViewIfNeeded();
    let empty = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await group.locator('[class*="-control"]').first().click({ timeout: 5_000 });
      const menu = page.locator('[class*="-menu"]').filter({ visible: true }).last();
      await menu.waitFor({ timeout: 8_000 });
      await expect(menu).not.toContainText(/^Loading/, { timeout: 15_000 }).catch(() => undefined);
      const opts = await menu.evaluate((m) =>
        [...m.querySelectorAll('[id*="-option-"]')]
          .filter((o) => /-option-\d+$/.test(o.id))
          .map((o) => (o as HTMLElement).innerText.trim())
          .filter(Boolean),
      );
      empty = (await menu.innerText().catch(() => '')).trim();
      await page.keyboard.press('Escape');
      if (opts.length) return [...new Set([current, ...opts].filter((o) => o && !/^Select$/.test(o)))].slice(0, MAX_OPTIONS);
      await page.waitForTimeout(1_500);
    }
    return empty || 'no options';
  } catch (e: any) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return `could not open: ${String(e.message).split('\n')[0]}`;
  }
}

/** Click a tab/type selector by its visible label. Only tabs, buttons or plain text; never a destructive label. */
async function clickVariant(page: Page, label: string): Promise<boolean> {
  if (DESTRUCTIVE.test(label)) return false;
  const candidates = [
    page.getByRole('tab', { name: label, exact: true }),
    page.getByRole('button', { name: label, exact: true }),
    page.getByText(label, { exact: true }),
  ];
  for (const c of candidates) {
    const el = c.filter({ visible: true }).first();
    if (await el.count()) {
      await el.click({ timeout: 10_000 });
      return true;
    }
  }
  return false;
}

function toMarkdown(id: string, url: string, all: Record<string, FieldInfo[]>, layouts: Record<string, Layout>, config: string[], blocked: string[], missing: string[]): string {
  const lines = [`# ${id} page discovery`, '', `Captured ${new Date().toISOString()} from ${url} (read-only; nothing saved).`, ''];
  for (const [name, fields] of Object.entries(all)) {
    lines.push(`## ${name}`, '', '| Card | Field | Req | Kind | Column | Default | Options |', '|---|---|---|---|---|---|---|');
    for (const f of fields) {
      const opts = f.options ? `${f.options.length}: ${f.options.slice(0, 12).join(', ')}${f.options.length > 12 ? ', ...' : ''}` : f.optionsNote ?? '';
      lines.push(`| ${f.card} | ${f.label} | ${f.required ? '*' : ''} | ${f.kind}${f.disabled ? ' (disabled)' : ''} | ${f.column} | ${f.default} | ${opts.replace(/\|/g, '/')} |`);
    }
    const l = layouts[name];
    if (l.buttons.length) lines.push('', `Buttons (not clicked): ${[...new Set(l.buttons.map((b) => b.destructive ? `${b.text} [destructive]` : b.text))].join(', ')}`);
    for (const t of l.tables) lines.push('', `Table in "${t.card}": ${t.headers.join(' | ')}`);
    lines.push('');
  }
  lines.push('## Backend config captured', '', ...(config.length ? config.map((c) => `- config/${c}`) : ['- none']), '');
  if (blocked.length) lines.push('## Mutating requests blocked by the read-only guard', '', ...[...new Set(blocked)].map((b) => `- ${b}`), '');
  if (missing.length) lines.push('## Variants not found', '', ...missing.map((m) => `- ${m}`), '');
  return lines.join('\n');
}
