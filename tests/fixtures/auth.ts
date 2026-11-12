import { test as base, expect } from '@playwright/test';
import fs from 'fs';

const SESSION_FILE = `${process.env.AUTH_DIR ?? '.auth'}/session.json`;

// Every test context starts already logged in: the saved sessionStorage
// (token, tenant_id, selected_facility, persist:root, ...) is restored before the app boots.
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (!fs.existsSync(SESSION_FILE)) {
      throw new Error('No saved session. Run `npm run auth` once to log in.');
    }
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as Record<string, string>;
    const origin = new URL(baseURL!).origin;
    await context.addInitScript(
      ({ session, origin }) => {
        if (window.location.origin !== origin || sessionStorage.getItem('token')) return;
        for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
      },
      { session, origin },
    );
    await use(context);
  },
});

export { expect };
