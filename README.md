# ccapi

Server HTTP Node/TypeScript che espone sessioni [Claude Code CLI](https://claude.ai/code) via API REST.

Ispirato a [OpenCode Server](https://opencode.ai). Consente di controllare conversazioni Claude da script, agenti o strumenti di terze parti.

---

## Modello chiave

Per ogni messaggio il server spawna un processo **effimero** `claude -p` (prompt via STDIN). La **continuità della conversazione** non è data da un processo persistente, ma dal transcript che Claude Code salva su disco: ogni sessione ha un UUID generato alla creazione. La **prima** invocazione usa `--session-id <uuid>` per creare il transcript; le invocazioni **successive** usano `--resume <uuid>` per riprendere il contesto (riusare `--session-id` su una sessione già esistente fallisce).

Il registro SQLite è una **vista per l'API** (prompt utente + risposta finale). Non re-inietta contesto nel prompt e non sostituisce il transcript di Claude.

---

## Prerequisiti

- Node ≥ 20
- `claude` CLI nel PATH (o impostare `CCAPI_CLAUDE_BIN`)
- I permessi dei tool Claude si configurano con `.claude/settings.local.json` nella cartella del progetto su cui si avvia il server — il server non gestisce i permessi

---

## Installazione e avvio

```bash
npm install
npm start         # avvia il server (default: 127.0.0.1:4096)
npm run dev       # avvia con watch (nodemon)
npm run build     # compila TypeScript → dist/
npm test          # esegue la test suite
```

---

## Configurazione

| Opzione | CLI flag | Env var | Default |
|---|---|---|---|
| Porta | `--port` | `CCAPI_PORT` | `4096` |
| Host bind | `--host` | `CCAPI_HOST` | `127.0.0.1` |
| Binario claude | `--claude-bin` | `CCAPI_CLAUDE_BIN` | `claude` (da PATH) |
| Path DB SQLite | `--db` | `CCAPI_DB` | `.ccapi/ccapi.db` |
| Radice cwd sessioni | `--detached-cwd [base]` | `CCAPI_DETACHED_CWD` | `(disabilitato)` |

Con `--detached-cwd <base>` le sessioni possono specificare alla creazione una working directory (campo `cwd` in `POST /sessions`) entro `base`; senza il flag tutte le sessioni usano la cwd del server.

Per lavorare su più progetti contemporaneamente è sufficiente avviare più istanze su porte diverse.

```bash
CCAPI_PORT=4097 CCAPI_DB=.ccapi/proj2.db npm start
```

---

## Endpoint

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/health` | Health check → `{ "status": "ok" }` |
| `POST` | `/sessions` | Crea sessione (body opzionale `{ title? }`) → 201 |
| `GET` | `/sessions` | Lista sessioni (con campo `status`: `idle`\|`busy`) |
| `GET` | `/sessions/:id` | Dettaglio sessione |
| `PATCH` | `/sessions/:id` | Aggiorna titolo (body `{ title }`) |
| `DELETE` | `/sessions/:id` | Rimuove la sessione dal registro → 204 |
| `POST` | `/sessions/:id/abort` | Interrompe il processo in corso e svuota la coda |
| `POST` | `/sessions/:id/messages` | Invia messaggio, risposta sincrona `{ info, parts }` |
| `GET` | `/sessions/:id/messages` | Lista messaggi della sessione |
| `GET` | `/sessions/:id/messages/:msgId` | Singolo messaggio |

La risposta di `/messages` (POST) contiene `parts`, array di union discriminata:
- `{ type: "text", text: string }`
- `{ type: "structured", data: unknown }`

**Codici di errore:** 400 (body invalido / prompt > 10 MB), 404 (sessione/messaggio inesistente), 409 (sessione in stato aborted), 502 (errore processo claude), 500 (interno).

---

## Esempi

### Creare una sessione e inviare un messaggio testuale

```bash
# Crea sessione
SESSION=$(curl -s -X POST http://localhost:4096/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title": "Sessione di test"}' | jq -r '.id')

# Invia messaggio
curl -s -X POST http://localhost:4096/sessions/$SESSION/messages \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Ciao! Spiega in una riga cos'\''è una closure JavaScript."}' | jq .
```

### Richiesta con output JSON strutturato

```bash
curl -s -X POST http://localhost:4096/sessions/$SESSION/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Elenca 3 linguaggi di programmazione con anno di creazione.",
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

## Documentazione

- **Guida d'uso** (riferimento API completo, esempi, troubleshooting): [`docs/USAGE.md`](docs/USAGE.md)
- Specifiche dettagliate: [`docs/specs/2026-06-06-ccapi-core.md`](docs/specs/2026-06-06-ccapi-core.md)
- Feature future e backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md)
