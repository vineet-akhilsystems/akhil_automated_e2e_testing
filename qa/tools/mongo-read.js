#!/usr/bin/env node
// Read-only, PII-masked view of the Augastam demo MongoDB.
//
//   node qa/tools/mongo-read.js dbs
//   node qa/tools/mongo-read.js collections [--db <name>]
//   node qa/tools/mongo-read.js find <collection> '<filter json>' [--project '<json>'] [--sort '<json>'] [--limit 20] [--db <name>]
//   node qa/tools/mongo-read.js count <collection> '<filter json>'
//   node qa/tools/mongo-read.js distinct <collection> <field> '<filter json>'
//   node qa/tools/mongo-read.js aggregate <collection> '<pipeline json>'
//   node qa/tools/mongo-read.js sample <collection> [n]
//   node qa/tools/mongo-read.js schema <collection> '<filter json>'   (field paths + types from up to 200 docs)
//
// Guardrails (in addition to .claude/hooks/db-readonly-guard.js):
//   - only the verbs above exist; there is no code path that calls a write method
//   - aggregate pipelines containing $out / $merge / $function / $accumulator / $where are rejected
//   - results are capped (50 docs) and phone / email / ID numbers are masked unless --unmask-test-data
//     is given AND every returned doc is an "Agent Testing" record created by this suite
//   - use a read-only MongoDB user in AUGASTAM_MONGO_URL; this tool is a second line of defence, not the first

require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');

const MAX_DOCS = 50;
const FORBIDDEN_STAGES = ['$out', '$merge', '$function', '$accumulator', '$where'];
const PII_KEY = /(phone|mobile|whatsapp|alternate|email|aadhaar|aadhar|identity_no|id_number|pan|passport|abha)/i;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[key] = true;
      else { opt[key] = next; i++; }
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

const json = (s, fallback) => (s === undefined ? fallback : JSON.parse(s));

function assertSafePipeline(node) {
  if (Array.isArray(node)) return node.forEach(assertSafePipeline);
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_STAGES.includes(k)) throw new Error(`Stage/operator ${k} is not allowed (read-only tool).`);
      assertSafePipeline(v);
    }
  }
}
function assertSafeFilter(filter) {
  assertSafePipeline(filter);
}

function maskValue(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return v;
  const s = String(v);
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}
function mask(doc) {
  if (Array.isArray(doc)) return doc.map(mask);
  if (doc && typeof doc === 'object' && !(doc instanceof Date) && doc._bsontype === undefined) {
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      out[k] = PII_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') ? maskValue(v) : mask(v);
    }
    return out;
  }
  return doc;
}
const isAgentTestDoc = (d) => /agent\s*testing/i.test(JSON.stringify(d?.properties ?? d ?? {}));

function schemaOf(docs) {
  const types = {};
  const walk = (v, path) => {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof Date ? 'date' : v?._bsontype ?? typeof v;
    (types[path] ??= {})[t] = (types[path][t] ?? 0) + 1;
    if (t === 'object') for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k);
    if (t === 'array' && v.length && typeof v[0] === 'object') walk(v[0], `${path}[]`);
  };
  docs.forEach((d) => walk(d, ''));
  delete types[''];
  return types;
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [verb, coll, ...rest] = pos;
  if (!verb || verb === 'help') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n'));
    return;
  }
  const url = process.env.AUGASTAM_MONGO_URL;
  if (!url) throw new Error('AUGASTAM_MONGO_URL is not set in .env (ideally a read-only MongoDB user).');

  const client = new MongoClient(url, { readPreference: 'secondaryPreferred', appName: 'augastam-e2e-readonly', maxPoolSize: 2 });
  await client.connect();
  try {
    const db = client.db(opt.db || process.env.AUGASTAM_MONGO_DB || undefined);
    const limit = Math.min(Number(opt.limit ?? 20), MAX_DOCS);
    let result;
    switch (verb) {
      case 'dbs':
        result = (await client.db().admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name);
        break;
      case 'collections':
        result = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
        break;
      case 'find': {
        const filter = json(rest[0], {});
        assertSafeFilter(filter);
        result = await db.collection(coll).find(filter, { projection: json(opt.project, undefined), sort: json(opt.sort, undefined), limit }).toArray();
        break;
      }
      case 'count': {
        const filter = json(rest[0], {});
        assertSafeFilter(filter);
        result = await db.collection(coll).countDocuments(filter, { limit: 100000 });
        break;
      }
      case 'distinct': {
        const filter = json(rest[1], {});
        assertSafeFilter(filter);
        result = (await db.collection(coll).distinct(rest[0], filter)).slice(0, 500);
        break;
      }
      case 'aggregate': {
        const pipeline = json(rest[0], []);
        assertSafePipeline(pipeline);
        result = await db.collection(coll).aggregate([...pipeline, { $limit: MAX_DOCS }]).toArray();
        break;
      }
      case 'sample':
        result = await db.collection(coll).aggregate([{ $sample: { size: Math.min(Number(rest[0] ?? 5), MAX_DOCS) } }]).toArray();
        break;
      case 'schema': {
        const filter = json(rest[0], {});
        assertSafeFilter(filter);
        result = schemaOf(await db.collection(coll).find(filter, { limit: 200 }).toArray());
        break;
      }
      default:
        throw new Error(`Unknown verb "${verb}". Read verbs only: dbs, collections, find, count, distinct, aggregate, sample, schema.`);
    }
    const unmask = opt['unmask-test-data'] && Array.isArray(result) && result.every(isAgentTestDoc);
    console.log(JSON.stringify(unmask ? result : mask(result), null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(`mongo-read: ${e.message}`);
  process.exit(1);
});
