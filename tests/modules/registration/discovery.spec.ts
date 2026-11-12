import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures/auth';
import { RegistrationPage } from './registration.page';

// Read-only walk of the Registration page: never clicks Save.
// Output: qa/modules/registration/discovery/
//   fields-<type>.json   every visible field with card, label, column, required, kind, default, options
//   config/*.json        raw workflow / webpart / lookup responses the page loaded from the backend
//   discovery.md         human-readable field + options table
const OUT = 'qa/modules/registration/discovery';
const TYPES = (process.env.REG_TYPES ?? 'New Registration,New Born Registration,International Registration,Outside Registration,Staff Registration,Diagnostic Registration')
  .split(',').map((s) => s.trim());
const MAX_OPTIONS = 300;

interface FieldInfo {
  card: string; label: string; required: boolean; kind: string; column: string;
  default: string; disabled: boolean; options?: string[]; optionsNote?: string;
}

test.describe.configure({ mode: 'serial' });

test('discover registration fields, options and backend config', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  fs.mkdirSync(path.join(OUT, 'config'), { recursive: true });

  // Keep the configuration the page pulls from MongoDB (via configuration-service).
  page.on('response', async (r) => {
    const u = r.url();
    const m = u.match(/configuration-service\/(workflow\/get-workflow|webpart\/latest-version|form-schema\/latest-version|reference-lookup\/(latest-version|parent-lookup|pincode-lookup))/);
    if (!m || r.request().method() !== 'GET') return;
    const q = new URL(u).searchParams;
    const tag = (q.get('webpart_id') || q.get('lookup_id') || q.get('prefix') || q.get('parent_lookup_name') || q.get('pin') || u.split('/').pop()!.split('?')[0]).replace(/[^\w.-]+/g, '_').slice(0, 80);
    const body = await r.text().catch(() => '');
    fs.writeFileSync(path.join(OUT, 'config', `${m[1].replace(/\W+/g, '_')}__${tag}.json`), body);
  });

  const reg = new RegistrationPage(page);
  await reg.open();
  const all: Record<string, FieldInfo[]> = {};

  for (const type of TYPES) {
    await test.step(type, async () => {
      await reg.selectRegistrationType(type);
      const fields = await collectFields(page);
      for (const f of fields) {
        if (f.kind !== 'select' || f.disabled) continue;
        const opts = await readOptions(page, f);
        if (Array.isArray(opts)) f.options = opts;
        else f.optionsNote = opts;
      }
      all[type] = fields;
      fs.writeFileSync(path.join(OUT, `fields-${type.replace(/\W+/g, '-').toLowerCase()}.json`), JSON.stringify(fields, null, 2));
    });
  }

  fs.writeFileSync(path.join(OUT, 'discovery.md'), toMarkdown(all));
  expect(Object.keys(all).length).toBe(TYPES.length);
});

async function collectFields(page: import('@playwright/test').Page): Promise<FieldInfo[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll('.registration-card').forEach((card) => {
      const cardTitle = (card.querySelector('.registration-card-title') as HTMLElement | null)?.innerText.trim() ?? '';
      card.querySelectorAll('.form-group').forEach((g) => {
        const el = g as HTMLElement;
        if (!el.getBoundingClientRect().width) return; // hidden tab (e.g. permanent address)
        const labelEl = g.querySelector('label') as HTMLElement | null;
        const rawLabel = labelEl?.innerText.replace(/\s+/g, ' ').trim() ?? '';
        if (!rawLabel) return;
        const isSelect = !!g.querySelector('input[id^="react-select"]');
        const textarea = g.querySelector('textarea') as HTMLTextAreaElement | null;
        const vis = g.querySelector('input:not([type=hidden])') as HTMLInputElement | null;
        const hidden = g.querySelector('input[type=hidden]') as HTMLInputElement | null;
        const single = g.querySelector('[class*="singleValue"]') as HTMLElement | null;
        const kind = isSelect ? 'select' : textarea ? 'textarea' : vis?.name === 'sabyaDate' ? 'date' : vis?.type ?? 'unknown';
        out.push({
          card: cardTitle,
          label: rawLabel.replace(/\*$/, '').trim(),
          required: /\*$/.test(rawLabel),
          kind,
          column: (isSelect ? hidden?.name : textarea?.name || vis?.name) || '',
          default: isSelect ? single?.innerText.trim() ?? '' : (textarea?.value ?? vis?.value ?? ''),
          disabled: !!(vis?.disabled || g.querySelector('[class*="--is-disabled"]')),
        });
      });
    });
    return out;
  });
}

/** Open a dropdown, read its options, close it without choosing anything. */
async function readOptions(page: import('@playwright/test').Page, f: FieldInfo): Promise<string[] | string> {
  const group = page
    .locator('.registration-card')
    .filter({ has: page.locator('.registration-card-title', { hasText: f.card }) })
    .first()
    .locator('.form-group')
    .filter({ has: page.locator('label', { hasText: new RegExp(`^\\s*${f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?\\s*$`) }) })
    .filter({ visible: true })
    .first();
  try {
    await group.scrollIntoViewIfNeeded();
    let empty = '';
    // Lookup options are read from an IndexedDB cache by a web worker; on first open the menu can say
    // "No options" before the worker answers, and a cache hit makes no network request to wait on.
    for (let attempt = 0; attempt < 3; attempt++) {
      await group.locator('[class*="-control"]').first().click({ timeout: 5_000 });
      const menu = page.locator('[class*="-menu"]').filter({ visible: true }).last();
      await menu.waitFor({ timeout: 8_000 });
      await expect(menu).not.toContainText(/^Loading/, { timeout: 15_000 }).catch(() => undefined);
      // Only the option rows themselves (id ends in -option-N); inner spans would double every entry.
      const opts = await menu.evaluate((m) =>
        [...m.querySelectorAll('[id*="-option-"]')]
          .filter((o) => /-option-\d+$/.test(o.id))
          .map((o) => (o as HTMLElement).innerText.trim())
          .filter(Boolean),
      );
      empty = (await menu.innerText().catch(() => '')).trim();
      await page.keyboard.press('Escape');
      if (opts.length) {
        // react-select hides the selected option, so put the current value back at the front.
        return [...new Set([f.default, ...opts].filter((o) => o && !/^(Select|State|District|City|Area)$/.test(o)))].slice(0, MAX_OPTIONS);
      }
      await page.waitForTimeout(1_500);
    }
    return empty || 'no options';
  } catch (e: any) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return `could not open: ${String(e.message).split('\n')[0]}`;
  }
}

function toMarkdown(all: Record<string, FieldInfo[]>): string {
  const lines = ['# Registration page discovery', '', `Captured ${new Date().toISOString()} from the live demo (read-only).`, ''];
  for (const [type, fields] of Object.entries(all)) {
    lines.push(`## ${type}`, '', '| Card | Field | Req | Kind | Column | Default | Options |', '|---|---|---|---|---|---|---|');
    for (const f of fields) {
      const opts = f.options ? `${f.options.length}: ${f.options.slice(0, 12).join(', ')}${f.options.length > 12 ? ', …' : ''}` : f.optionsNote ?? '';
      lines.push(`| ${f.card} | ${f.label} | ${f.required ? '*' : ''} | ${f.kind}${f.disabled ? ' (disabled)' : ''} | ${f.column} | ${f.default} | ${opts.replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
