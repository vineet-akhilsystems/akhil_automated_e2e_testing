import { expect } from '@playwright/test';
import { test as base } from './profile';
import fs from 'fs';

const SESSION_FILE = `${process.env.AUTH_DIR ?? '.auth'}/session.json`;
const MIRACLE_FILE = `${process.env.AUTH_DIR ?? '.auth'}/miracle.json`;

// Every test context starts already logged in: for Augastam the saved sessionStorage
// (token, tenant_id, selected_facility, persist:root, ...) is restored before the app boots;
// for Miracle the saved Playwright storageState cookie session is already attached.
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (process.env.PORTAL_PRODUCT_ID === 'miracle') {
      if (!fs.existsSync(MIRACLE_FILE)) {
        throw new Error('No saved Miracle session. Run `npm run auth:miracle` (or sign in from Settings) once to log in.');
      }
      await use(context);
      return;
    }
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
