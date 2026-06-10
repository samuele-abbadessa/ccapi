# ccapi

HTTP server (Node/TypeScript) that exposes [Claude Code CLI](https://claude.ai/code) sessions via a REST API.

Inspired by [OpenCode Server](https://opencode.ai). Lets you control Claude conversations from scripts, agents, or third-party tools.

---

## Key model

For each message the server spawns an **ephemeral** `claude -p` process (prompt passed via STDIN). **Conversation continuity** is not maintained by a persistent process but by the transcript that Claude Code saves to disk: each session has a UUID generated at creation. The **first** invocation uses `--session-id <uuid>` to create the transcript; **subsequent** invocations use `--resume <uuid>` to resume the context (reusing `--session-id` on an existing session fails).

The SQLite registry is an **API view** (user prompt + final response). It does not re-inject context into the prompt and does not replace the Claude transcript.

---

## Prerequisites

- Node ≥ 20
- `claude` CLI in PATH (or set `CCAPI_CLAUDE_BIN`)
- Claude tool permissions are configured via `.claude/settings.local.json` in the project folder where the server is started — the server does not manage permissions

---

## Installation and startup

```bash
npm install
npm start         # start the server (default: 127.0.0.1:4096)
npm run dev       # start with watch (nodemon)
npm run build     # compile TypeScript → dist/
npm test          # run the test suite
```

---

## Configuration

| Option | CLI flag | Env var | Default |
|---|---|---|---|
| Port | `--port` | `CCAPI_PORT` | `4096` |
| Bind host | `--host` | `CCAPI_HOST` | `127.0.0.1` |
| Claude binary | `--claude-bin` | `CCAPI_CLAUDE_BIN` | `claude` (from PATH) |
| SQLite DB path | `--db` | `CCAPI_DB` | `.ccapi/ccapi.db` |
| Session cwd root | `--detached-cwd [base]` | `CCAPI_DETACHED_CWD` | `(disabled)` |

With `--detached-cwd <base>` sessions can specify a working directory at creation time (the `cwd` field in `POST /sessions`) within `base`; without the flag all sessions use the server's cwd.

To work on multiple projects simultaneously, start multiple instances on different ports.

```bash
CCAPI_PORT=4097 CCAPI_DB=.ccapi/proj2.db npm start
```

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check → `{ "status": "ok" }` |
| `POST` | `/sessions` | Create session (optional body `{ title?, cwd?, envVars? }`) → 201 |
| `GET` | `/sessions` | List sessions (with runtime `status`: `idle`\|`busy`) |
| `GET` | `/sessions/:id` | Session detail |
| `PATCH` | `/sessions/:id` | Update title (body `{ title }`) |
| `DELETE` | `/sessions/:id` | Remove session from registry → 204 |
| `POST` | `/sessions/:id/abort` | Abort running process and clear queue |
| `POST` | `/sessions/:id/messages` | Send message, synchronous response `{ info, parts }` |
| `GET` | `/sessions/:id/messages` | List session messages |
| `GET` | `/sessions/:id/messages/:msgId` | Single message |

The `/messages` (POST) response contains `parts`, a discriminated union array:
- `{ type: "text", text: string }`
- `{ type: "structured", data: unknown }`

**Error codes:** 400 (invalid body / prompt > 10 MB), 404 (session/message not found), 409 (session in aborted state), 502 (claude process error), 500 (internal).

---

## Examples

### Create a session and send a text message

```bash
# Create session
SESSION=$(curl -s -X POST http://localhost:4096/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title": "Test session"}' | jq -r '.id')

# Send message
curl -s -X POST http://localhost:4096/sessions/$SESSION/messages \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Hello! Explain in one line what a JavaScript closure is."}' | jq .
```

### Request with structured JSON output

```bash
curl -s -X POST http://localhost:4096/sessions/$SESSION/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "List 3 programming languages with their year of creation.",
    "outputFormat": "json",
    "jsonSchema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "year": { "type": "integer" }
        }
      }
    }
  }' | jq '.parts[] | select(.type == "structured") | .data'
```

---

## Documentation

- **User guide** (full API reference, examples, troubleshooting):
  - [docs/USAGE.md](docs/USAGE.md) — English
  - [docs/USAGE-it.md](docs/USAGE-it.md) — Italian

---

## License

Released under the [MIT License](LICENSE).
