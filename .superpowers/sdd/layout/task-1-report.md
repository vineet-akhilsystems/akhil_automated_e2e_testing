# Task 1 report: module layout resolver

Added tests/shared/module-layout.mjs (+ .d.mts) with moduleFolder, productFolder, listProductFolders; portal/module-layout.mjs re-exports.
tests/shared/module-paths.ts: moduleDir(kind, product, id) delegates to the resolver; temporary legacyModuleDir(kind, id) keeps the old flat path.
Callers (playwright.config.ts, tests/modules/registration/case-runner.ts, cases.spec.ts) point at legacyModuleDir with TODO(task-2).
Tests: portal/test/module-layout.test.mjs (7). Suite 525/525 pass (518 + 7); tsc --noEmit clean.
Reserved product names are the union across kinds (knowledge, tools, shared, fixtures, discovery, smoke); listProductFolders also skips names that are not valid ids and returns [] for a missing directory.
