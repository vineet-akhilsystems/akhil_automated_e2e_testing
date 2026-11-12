#!/usr/bin/env node
// PreToolUse (Bash|PowerShell) for the Augastam E2E testing repo.
// The demo MongoDB is shared with the product team, so Claude may only READ it, and only
// through qa/tools/mongo-read.js (which whitelists read operations and masks PII).
//   - mongosh / mongo / mongoimport / mongorestore / mongodump / mongoexport -> deny
//   - inline connection strings (mongodb:// or mongodb+srv://)                -> deny
//   - inline driver code with write methods (node -e / ts-node / python)      -> deny
//   - any command touching .env / .env.* / login.txt / .auth/                  -> deny
//   - qa/tools/mongo-read.js with a write-looking verb                        -> deny

const SHELLS = /(^|[\s;&|(])(mongosh|mongo|mongoimport|mongorestore|mongodump|mongoexport|mongofiles)(\.exe)?(?=$|[\s;&|)])/i;
const CONN_STRING = /mongodb(\+srv)?:\/\//i;
const WRITE_METHODS = /\b(insert(One|Many)?|update(One|Many)?|replaceOne|delete(One|Many)?|remove|drop(Database|Indexes|Index)?|findOneAnd(Update|Replace|Delete)|bulkWrite|createIndex(es)?|createCollection|renameCollection)\b|\$(out|merge)\b/;
const INLINE_CODE = /\b(node\s+(-e|--eval|-p)|ts-node|tsx\s+-e|python[\d.]*\s+-c|deno\s+eval)\b/i;
const SECRET_FILES = /(^|[\s'"`/\\=<>|;(])(\.env(\.[\w.-]+)?|login\.txt|\.auth[/\\])(?=$|[\s'"`|;)>&/\\])/;
const READ_TOOL = /qa[/\\]tools[/\\]mongo-read\.js\s+(\S+)/;
const READ_VERBS = new Set(['dbs', 'collections', 'find', 'count', 'distinct', 'aggregate', 'sample', 'schema', 'help']);

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const cmd = String(input?.tool_input?.command || '');
  if (!cmd) process.exit(0);

  const deny = (reason) => {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    process.exit(0);
  };

  if (SHELLS.test(cmd)) deny('Mongo shells are blocked here. Use `node qa/tools/mongo-read.js <verb> ...` (read-only, PII-masked).');
  if (CONN_STRING.test(cmd)) deny('Do not put MongoDB connection strings on the command line. The read tool loads AUGASTAM_MONGO_URL from .env.');
  if (INLINE_CODE.test(cmd) && /mongo/i.test(cmd)) deny('Inline scripts that talk to MongoDB are blocked. Use qa/tools/mongo-read.js.');
  if (/mongo/i.test(cmd) && WRITE_METHODS.test(cmd)) deny('This command looks like a MongoDB write. The demo database is read-only for Claude.');
  if (SECRET_FILES.test(cmd)) deny('.env, login.txt and .auth/ hold credentials or session tokens and are not read or printed through Claude.');

  const tool = cmd.match(READ_TOOL);
  if (tool && !READ_VERBS.has(tool[1].replace(/['"]/g, ''))) {
    deny(`mongo-read.js only supports read verbs: ${[...READ_VERBS].join(', ')}.`);
  }
  process.exit(0);
});
