import { ROOT, check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { buildMatrix } from '../version-matrix.mjs';
import { fingerprintAutomation, registerAutomationVersion, annotateAutomationVersion } from '../automation-versions.mjs';
import { loadTree, assignCases, rollupTree } from '../tree.mjs';

const FINISHED = new Set(['passed', 'failed', 'error', 'blocked']);
const COUNTED_PASS = 'PASS', COUNTED_FAIL = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const NOTE_MAX = 300;
const finishedAutomated = r => r.kind === 'tests' && r.mode === 'automated' && FINISHED.has(r.status);

function cleanNote(value) {
  if (value === undefined || value === null) return '';
  check(typeof value === 'string', 'The note must be text.');
  const note = value.trim();
  check(note.length <= NOTE_MAX, `The note can be at most ${NOTE_MAX} characters.`);
  return note;
}

// Version records as the API shows them: no internal flags and no full file list.
const publicVersion = ({ pendingGit, files, moduleId, ...rest }) => ({ ...rest, fileCount: Array.isArray(files) ? files.length : 0 });

function statsFor(runs) {
  const by = new Map();
  for (const run of runs) {
    const n = run.automationVersion?.number;
    if (!Number.isInteger(n)) continue;
    const s = by.get(n) ?? { runs: 0, pass: 0, counted: 0 };
    s.runs++;
    for (const r of run.results ?? []) {
      if (r.status === COUNTED_PASS) { s.pass++; s.counted++; } else if (COUNTED_FAIL.has(r.status)) s.counted++;
    }
    by.set(n, s);
  }
  return by;
}

// Automation versions, the version matrix and the module tree. Permissions come from services/access.mjs (GET: module.view, others: module.settings).
export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const m = /^\/api\/modules\/([\w-]+)\/(automation-versions(?:\/(\d+))?|version-matrix|tree)$/.exec(route);
  if (!m) return false;
  const { store } = ctx, { inModule } = ctx.membership;
  const module = store.module(m[1]);
  check(module, 'Module not found.', 404);
  const root = ctx.options.automationRoot ?? ROOT, fingerprint = ctx.options.automationFingerprint ?? fingerprintAutomation;
  const dir = module.adapter ?? module.id; // the folder name the module's automation files live under
  const moduleRuns = () => store.runs().filter(r => r.module?.id === module.id);
  const url = new URL(req.url, 'http://x');

  if (m[2] === 'version-matrix' && req.method === 'GET') {
    const only = ['1', 'true', 'yes'].includes(url.searchParams.get('onlyDifferences') ?? '');
    return json(res, 200, buildMatrix(moduleRuns().filter(r => ctx.helpers.visibleRun(rc.acc, r)), { onlyDifferences: only }));
  }

  if (m[2] === 'tree' && req.method === 'GET') {
    let tree;
    try { tree = loadTree(root, module.id); } catch (e) { check(false, e.message, 422); }
    check(tree, 'No tree defined for this module.', 404);
    const { byNode, unassigned } = assignCases(tree, store.cases(module.id));
    const which = url.searchParams.get('run');
    let run = null;
    if (which === 'latest') {
      run = moduleRuns().filter(r => finishedAutomated(r) && (r.results ?? []).length > 0 && ctx.helpers.visibleRun(rc.acc, r))
        .sort((a, b) => String(b.finishedAt ?? b.createdAt ?? '').localeCompare(String(a.finishedAt ?? a.createdAt ?? '')))[0] ?? null;
    } else if (which) {
      run = store.run(which);
      check(run && run.kind === 'tests' && run.module?.id === module.id && ctx.helpers.visibleRun(rc.acc, run), 'Run not found.', 404);
    }
    return json(res, 200, { tree, assigned: byNode, unassigned, rollup: rollupTree(tree, byNode, run?.results ?? []),
      run: run ? { id: run.id, name: run.name, at: run.finishedAt ?? run.createdAt, status: run.status } : null });
  }

  if (m[2].startsWith('automation-versions')) {
    if (!m[3] && req.method === 'GET') {
      let current = null;
      try { current = fingerprint(root, dir).hash; } catch (e) { ctx.logger?.(`Could not fingerprint automation: ${e.message}`, 'stderr'); }
      const list = store.automationVersions(module.id).slice().sort((a, b) => b.number - a.number);
      const stats = statsFor(moduleRuns().filter(r => finishedAutomated(r) && ctx.helpers.visibleRun(rc.acc, r)));
      const versions = list.map((v, i) => {
        const s = stats.get(v.number);
        return { ...publicVersion(v), current: current !== null && v.hash === current, changedFilesSince: list[i + 1]?.number ?? null,
          runs: s?.runs ?? 0, passRate: s && s.counted ? Math.round((s.pass / s.counted) * 1000) / 10 : null };
      });
      const match = current === null ? undefined : list.find(v => v.hash === current);
      return json(res, 200, { current: { hash: current, number: match?.number ?? null, registered: Boolean(match) }, versions });
    }
    if (!m[3] && req.method === 'POST') {
      const body = await readJson(req);
      const note = cleanNote(body?.note);
      let before, record;
      try {
        before = store.automationVersionByHash(module.id, fingerprint(root, dir).hash);
        if (!before) record = registerAutomationVersion({ store, root, moduleId: module.id, dir, by: rc.user.username, trigger: 'manual', note, fingerprint });
      } catch (e) {
        ctx.logger?.(`Could not fingerprint automation: ${e.message}`, 'stderr');
        check(false, 'The automation files could not be read, so the current version cannot be registered. Check the server log.', 409);
      }
      if (before) return json(res, 200, { ...publicVersion(before), existing: true });
      if (record.pendingGit) annotateAutomationVersion({ store, root, moduleId: module.id, number: record.number, git: ctx.options.automationGit }).catch(e => ctx.logger?.(`Automation version git details failed: ${e.message}`, 'stderr'));
      inModule(rc.user, 'automation.version.register', module.id, { number: record.number });
      return json(res, 201, publicVersion(record));
    }
    if (m[3] && req.method === 'PUT') {
      const body = await readJson(req);
      check(typeof body?.note === 'string', 'Send the note as text.');
      const note = cleanNote(body.note), number = Number(m[3]);
      check(store.automationVersionByNumber(module.id, number), 'Automation version not found.', 404);
      const updated = store.updateAutomationVersion(module.id, number, { note });
      inModule(rc.user, 'automation.version.note', module.id, { number });
      return json(res, 200, publicVersion(updated));
    }
  }
  return false;
}
