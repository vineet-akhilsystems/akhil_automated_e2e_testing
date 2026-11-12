// Gives each real test run its own id. Workers inherit process.env from here, so per-run files
// (results written as cases finish, values one case hands to a later one) go to
// qa/modules/registration/results/runs/<REG_RUN_ID>/. Nothing is ever deleted: other processes on the
// machine (IDE extensions, the Playwright agents' MCP server) also start Playwright and previously
// wiped shared files in the middle of a run.
export default function globalSetup() {
  process.env.REG_RUN_ID ??= `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${process.pid}`;
}
