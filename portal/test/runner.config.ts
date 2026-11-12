import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: ['runner-checks.spec.ts', 'workflow-checks.spec.ts'], workers: 1, reporter: 'line', outputDir: '../test-output/runner-checks' });
