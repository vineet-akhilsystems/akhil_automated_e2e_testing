# Using your assistant (Claude / ChatGPT) with Test Studio over MCP

Instead of the portal calling an AI service itself, your assistant connects to the portal through an MCP server (`portal/mcp-server.mjs`). The assistant reads what the BA team uploaded, writes the summary ("insights") and proposed test cases back, and can read run results. A person still approves every case before it can run.

## 1. Create an account for the assistant

In the portal, sign in as admin, open **Users** and add an account, for example `assistant` with role **ba**. A BA account can read uploads and save insights, but every case it saves is a draft. Use role **tester** only if the assistant should also read and manage runs.

## 2. Connect the assistant

Claude Code (`.mcp.json`) or Claude Desktop (`claude_desktop_config.json`), under `mcpServers`:

```json
"augastam-test-studio": {
  "command": "node",
  "args": ["C:/Users/HP/Desktop/akhil_system/Company Enhancement Projects/augastam_e2e_testing/portal/mcp-server.mjs"],
  "env": {
    "PORTAL_URL": "http://127.0.0.1:4173",
    "PORTAL_MCP_USER": "assistant",
    "PORTAL_MCP_PASSWORD": "the-assistant-account-password"
  }
}
```

The file holds a password. Keep it out of source control. For a portal deployed on a server, set `PORTAL_URL` to its address (the server must be reachable from the machine running the assistant).

ChatGPT or another client: any client that can launch a local stdio MCP server can use the same command and environment. A client that only accepts a remote HTTPS MCP URL cannot use this version.

## 3. The workflow

1. A BA uploads files in the module's **Intake** tab.
2. Ask the assistant: "Read the Billing module's uploaded files and save insights and draft test cases."
3. The assistant calls `list_modules`, `list_intake_files`, `read_intake_file` (one per file), `list_cases` (to avoid duplicates), then `save_insights`.
4. The insights appear on the Intake tab, labelled "Written by your assistant". The cases appear in the **Review queue** as drafts.
5. A tester approves or rejects them, then runs the approved cases.

## Tools

| Tool | Purpose |
|---|---|
| `list_modules` | Modules and draft counts |
| `list_intake_files` | Uploaded files and extraction status |
| `read_intake_file` | Extracted text of one file (paged with `offset` and `limit`) |
| `list_cases` | Existing cases and review status |
| `get_insights`, `save_insights` | Read or write the module insights and draft cases |
| `get_module_coverage` | Coverage report (read-only): fields, requirements and actions with or without cases |
| `get_module_schema` | The module's adapter (fields, actions, outcomes, variants) and starting-data templates; `adapter: null` means manual-only |
| `generate_ai_cases` | Suggested case drafts from the portal's rule-based synthesizer (not an LLM). Nothing is saved; a human reviews the suggestions |
| `propose_automated_cases` | Saves structured automated cases as **drafts** (modules with an adapter only; others get an explanation). A human must approve them in the portal before they can run |
| `list_runs`, `get_run` | Run results with expected versus actual |

The repo's `.mcp.json` registers this server for Claude Code using `${PORTAL_MCP_USER}`, `${PORTAL_MCP_PASSWORD}` and `${PORTAL_URL:-http://127.0.0.1:4173}` from your environment, so no password is stored in the file. Set those variables before starting Claude Code.

## Limits

- Videos and images are stored but have no text. The assistant is told to ask for a transcript or notes. Add a transcript as a text file in the Intake tab.
- Excel, Word and PDF text extraction is best effort. Scanned PDFs yield little or nothing.
- The assistant sees whatever the account's role can see, including uploaded files. Do not upload secrets.
