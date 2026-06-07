# Guida d'uso di ccapi

Guida operativa per chi deve **usare** ccapi: avvio, riferimento completo delle API, flussi tipici, gestione degli errori e note operative. Per la panoramica veloce vedi il [README](../README.md); per le scelte di design vedi la [spec](specs/2026-06-06-ccapi-core.md).

---

## Indice

1. [Cos'è e come funziona](#1-cosè-e-come-funziona)
2. [Avvio rapido](#2-avvio-rapido)
3. [Configurazione](#3-configurazione)
4. [Concetti](#4-concetti)
5. [Riferimento API](#5-riferimento-api)
6. [Flussi d'uso](#6-flussi-duso)
7. [Gestione degli errori](#7-gestione-degli-errori)
8. [Note operative e limiti](#8-note-operative-e-limiti)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Cos'è e come funziona

ccapi è un server HTTP che espone sessioni **Claude Code CLI** tramite API REST. Permette di pilotare conversazioni con Claude da script, agenti o applicazioni, senza usare il terminale interattivo.

**Modello mentale.** Per ogni messaggio il server avvia un processo **effimero** `claude -p` (il prompt viene passato via STDIN). Il processo elabora la richiesta, restituisce la risposta e termina: non resta alcun processo vivo tra un messaggio e l'altro.

La **continuità della conversazione** è garantita dal transcript che Claude Code salva su disco, identificato da un UUID generato dal server alla creazione della sessione:

- La **prima** invocazione di una sessione usa `claude -p --session-id <uuid>` → crea il transcript.
- Le invocazioni **successive** usano `claude -p --resume <uuid>` → riprendono il contesto.

Il registro **SQLite** del server è una *vista per l'API* (memorizza prompt utente + risposta finale, per esporli via `GET`). Non è la memoria del modello e non re-inietta contesto nel prompt: la memoria conversazionale vive nel transcript di Claude.

---

## 2. Avvio rapido

```bash
npm install
npm start            # avvia su http://127.0.0.1:4096
```

Verifica che risponda:

```bash
curl -s http://localhost:4096/health
# {"status":"ok"}
```

Altri comandi:

```bash
npm run dev          # avvio con watch (ricarica al cambio dei file)
npm run build        # compila TypeScript in dist/
npm test             # esegue la suite di test
```

**Prerequisiti:**
- Node ≥ 20
- Il binario `claude` nel `PATH` (oppure indicalo con `CCAPI_CLAUDE_BIN`)
- I permessi dei tool di Claude vanno configurati in `.claude/settings.local.json` nella cartella su cui avvii il server (vedi §8) — il server **non** gestisce i permessi

---

## 3. Configurazione

Ogni opzione si imposta con un flag CLI o una variabile d'ambiente. Precedenza: **flag CLI > variabile d'ambiente > default**.

| Opzione | Flag CLI | Variabile d'ambiente | Default |
|---|---|---|---|
| Porta di ascolto | `--port` | `CCAPI_PORT` | `4096` |
| Indirizzo di bind | `--host` | `CCAPI_HOST` | `127.0.0.1` |
| Binario claude | `--claude-bin` | `CCAPI_CLAUDE_BIN` | `claude` (dal PATH) |
| Path del DB SQLite | `--db` | `CCAPI_DB` | `.ccapi/ccapi.db` |
| Radice cwd sessioni | `--detached-cwd [base]` | `CCAPI_DETACHED_CWD` | `(disabilitato)` |

La radice cwd (`--detached-cwd`) è un valore **opzionale**: con un path abilita la feature usando quel path come radice consentita; senza valore usa la cwd del server come radice. La radice `/` è **rifiutata** (svuoterebbe la sandbox). Se la radice non esiste o non è una directory il server **non si avvia** (fail-fast).

Esempi:

```bash
# Via variabili d'ambiente
CCAPI_PORT=4097 CCAPI_DB=.ccapi/progetto-b.db npm start

# Via flag CLI (in produzione, con il binario compilato)
node dist/index.js --port 4097 --host 0.0.0.0
```

**Working directory.** Tutte le sessioni di un'istanza lavorano nella cartella da cui hai avviato il server: è lì che `claude` legge i file e applica le modifiche. Per lavorare su progetti diversi, avvia **un'istanza per cartella** su porte diverse (vedi §8).

---

## 4. Concetti

**Sessione.** Una conversazione. Ha un `id` (UUID), un `title` opzionale e uno `status` runtime:
- `idle` — nessun messaggio in elaborazione;
- `busy` — un messaggio è in elaborazione **oppure** in coda.

Lo `status` è volatile (non persistito): dopo un riavvio del server tutte le sessioni ripartono `idle`, ma restano riprendibili.

**Messaggio.** Un turno della conversazione. Ogni invio produce **due** record: il messaggio `user` (il prompt) e il messaggio `assistant` (la risposta). Un messaggio assistant ha uno `status`: `completed`, `failed` o `aborted`.

**Parts.** Il contenuto di un messaggio è un array `parts`, un'unione discriminata sul campo `type`:
- `{ "type": "text", "text": "..." }` — risposta testuale;
- `{ "type": "structured", "data": { ... } }` — output JSON conforme a uno schema (vedi §6).

**Coda FIFO per sessione.** I messaggi diretti alla **stessa** sessione vengono **serializzati** (uno alla volta, in ordine di arrivo); sessioni **diverse** procedono in parallelo. Questo evita di corrompere il transcript di Claude (vedi §8).

---

## 5. Riferimento API

Base URL negli esempi: `http://localhost:4096`. Tutte le richieste con body usano `Content-Type: application/json`. Tutte le risposte sono JSON.

### Sessioni

#### `POST /sessions` — crea una sessione

Body (opzionale):
```json
{ "title": "La mia sessione", "cwd": "/percorso/opzionale" }
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `title` | string | no | Titolo della sessione. |
| `cwd` | string | no | Working directory della sessione (relativa a `base` o assoluta). Richiede `--detached-cwd` attivo; ignorata se omessa (vedi §6). |

Risposta `201`:
```json
{
  "id": "0ec54bc9-4967-45bf-931b-a4177fee13bc",
  "title": "La mia sessione",
  "status": "idle",
  "cwd": "/home/user/progetti/mio-progetto",
  "createdAt": 1780752193000,
  "updatedAt": 1780752193000
}
```
Il campo `cwd` contiene il path assoluto risolto della sessione (o `null` per sessioni create prima della feature detached-cwd). Non avvia alcun processo: crea solo il record e l'UUID.

#### `GET /sessions` — lista le sessioni

Risposta `200`: array di sessioni (le più recenti prima), ciascuna con lo `status` runtime calcolato al momento.

#### `GET /sessions/:id` — dettaglio

Risposta `200`: la sessione. `404` se non esiste.

#### `PATCH /sessions/:id` — aggiorna il titolo

Body:
```json
{ "title": "Nuovo titolo" }
```
(`title` può essere `null` per rimuoverlo.) Risposta `200`: la sessione aggiornata. `404` se non esiste.

#### `DELETE /sessions/:id` — elimina dal registro

Risposta `204`. Rimuove la sessione e i suoi messaggi dal registro SQLite. **Non** tocca il transcript `.jsonl` di Claude su disco (che resta riprendibile). `404` se non esiste.

#### `POST /sessions/:id/abort` — interrompi

Termina il processo `claude -p` eventualmente in corso per la sessione e svuota la coda dei messaggi pendenti. Risposta `200`:
```json
{ "id": "0ec54bc9-...", "status": "idle" }
```
Le richieste `POST /messages` pendenti per quella sessione si risolvono con `409` (vedi §7). `404` se la sessione non esiste.

### Messaggi

#### `POST /sessions/:id/messages` — invia un messaggio (sincrono)

La richiesta **blocca** fino al termine dell'elaborazione. Se la sessione è occupata, il messaggio viene accodato e la risposta arriva quando è il suo turno.

Body:

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `prompt` | string | sì | Il prompt, passato a Claude via STDIN. Max 10 MB. |
| `model` | string | no | Alias (`opus`, `sonnet`, `haiku`) o nome completo. Default: quello di Claude. |
| `effort` | string | no | `low` \| `medium` \| `high` \| `xhigh` \| `max`. |
| `outputFormat` | string | no | `text` (default) o `json`. |
| `jsonSchema` | object | no | JSON Schema per l'output strutturato. Valido **solo** con `outputFormat: "json"`. |

Esempio:
```json
{ "prompt": "Spiega in una riga cos'è una closure.", "model": "haiku" }
```
Risposta `200`:
```json
{
  "info": {
    "id": "8a1d4a14-8edf-4941-a8eb-c259b65ce3f8",
    "sessionId": "0ec54bc9-4967-45bf-931b-a4177fee13bc",
    "role": "assistant",
    "status": "completed",
    "model": null,
    "costUsd": null,
    "usage": null,
    "error": null,
    "createdAt": 1780752193356
  },
  "parts": [
    { "type": "text", "text": "Una closure è una funzione che cattura le variabili del proprio scope di definizione." }
  ]
}
```

> **Nota sui metadati.** In *text mode* i campi `model`, `costUsd` e `usage` sono `null`: Claude non emette metadati senza output JSON. Con `outputFormat: "json"`, `costUsd` e `usage` vengono popolati (vedi §6). Il campo `model` può restare `null` anche in JSON mode su alcune versioni della CLI — vedi nota V3 nel [BACKLOG](BACKLOG.md).

#### `GET /sessions/:id/messages` — lista i messaggi

Risposta `200`: array di `{ info, parts }` in ordine cronologico (user e assistant alternati). `404` se la sessione non esiste.

#### `GET /sessions/:id/messages/:msgId` — singolo messaggio

Risposta `200`: `{ info, parts }`. `404` se il messaggio non esiste o non appartiene a quella sessione.

### Servizio

#### `GET /health`

Risposta `200`: `{ "status": "ok" }`. Utile per readiness check; non richiede il binario `claude`.

---

## 6. Flussi d'uso

### Conversazione multi-turno (continuità di contesto)

Il contesto è automatico: basta inviare più messaggi alla **stessa** sessione.

```bash
SID=$(curl -s -X POST http://localhost:4096/sessions \
  -H 'Content-Type: application/json' -d '{"title":"demo"}' | jq -r .id)

# Turno 1
curl -s -X POST http://localhost:4096/sessions/$SID/messages \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Ricorda il numero 42. Rispondi solo OK.","model":"haiku"}' \
  | jq -r '.parts[0].text'        # → OK

# Turno 2 (ricorda il turno precedente)
curl -s -X POST http://localhost:4096/sessions/$SID/messages \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Che numero ti ho chiesto di ricordare?","model":"haiku"}' \
  | jq -r '.parts[0].text'        # → 42
```

### Output JSON strutturato

Imposta `outputFormat: "json"` e fornisci un `jsonSchema`. La risposta conterrà una part `structured` con i dati conformi allo schema.

```bash
curl -s -X POST http://localhost:4096/sessions/$SID/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Qual è la capitale della Francia?",
    "model": "haiku",
    "outputFormat": "json",
    "jsonSchema": {
      "type": "object",
      "properties": { "capital": { "type": "string" } },
      "required": ["capital"]
    }
  }' | jq '.parts[0]'
```
```json
{ "type": "structured", "data": { "capital": "Parigi" } }
```
In questa modalità `info.usage` e `info.costUsd` sono valorizzati (es. `{ "inputTokens": 28, "outputTokens": 398 }`).

### Scegliere modello ed effort

```bash
curl -s -X POST http://localhost:4096/sessions/$SID/messages \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Analizza questo problema...","model":"opus","effort":"high"}'
```

### Interrompere un messaggio lungo

Da un altro terminale, mentre una richiesta è in corso:

```bash
curl -s -X POST http://localhost:4096/sessions/$SID/abort
```
La richiesta `POST /messages` interrotta restituisce `409` con `{ "error": { "code": "aborted", ... } }`; i messaggi in coda per quella sessione vengono anch'essi annullati con `409`.

### Rileggere la history

```bash
curl -s http://localhost:4096/sessions/$SID/messages \
  | jq '[.[] | {role: .info.role, status: .info.status, text: (.parts[0].text // .parts[0].data)}]'
```

### Working directory per-sessione

Con il flag `--detached-cwd <base>` è possibile assegnare a ogni sessione una working directory diversa, entro la radice consentita (`base`). Utile per un'unica istanza ccapi che gestisce più progetti.

**Abilitazione:**

```bash
# Avvia il server con radice consentita /home/user/progetti
node dist/index.js --detached-cwd /home/user/progetti

# oppure via variabile d'ambiente
CCAPI_DETACHED_CWD=/home/user/progetti npm start

# Senza path esplicito: usa la cwd del server come radice
node dist/index.js --detached-cwd
```

**Creazione sessione con cwd:**

```bash
# cwd relativa a base (/home/user/progetti/mio-progetto)
curl -s -X POST http://localhost:4096/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title": "Progetto A", "cwd": "mio-progetto"}' | jq .

# cwd assoluta (deve essere dentro base)
curl -s -X POST http://localhost:4096/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title": "Progetto B", "cwd": "/home/user/progetti/altro-progetto"}' | jq .
```

La risposta include il campo `cwd` con il path assoluto risolto. Tutti i messaggi di quella sessione gireranno in quella cartella.

**Errori di validazione:**

| Codice | Causa |
|---|---|
| `detached_cwd_disabled` | `cwd` nel body ma `--detached-cwd` non attivo. |
| `invalid_cwd` | Il path non esiste o non è una directory. |
| `cwd_outside_base` | Il path (anche via `..` o symlink) è fuori dalla radice consentita. |

**Nota di sicurezza.** La sandbox è un guard-rail contro errori e un confine ragionevole nel modello locale/fidato: non è un jail forte. La validazione avviene alla creazione; symlink creati successivamente non sono ricontrollati. Il server non si avvia se la radice indicata non esiste, non è una directory, o è `/` (quest'ultimo caso svuoterebbe la sandbox).

---

## 7. Gestione degli errori

In caso di errore la risposta ha la forma:
```json
{ "error": { "code": "<codice>", "message": "<descrizione>" } }
```

| Stato HTTP | `code` | Quando |
|---|---|---|
| `400` | `invalid_body` | Body non valido (es. `jsonSchema` senza `outputFormat: "json"`). |
| `400` | `prompt_too_large` | Prompt oltre il limite di 10 MB. |
| `400` | `detached_cwd_disabled` | Campo `cwd` nel body di `POST /sessions` ma `--detached-cwd` non è attivo. |
| `400` | `invalid_cwd` | La `cwd` richiesta non esiste o non è una directory. |
| `400` | `cwd_outside_base` | La `cwd` richiesta (anche via `..` o symlink) è fuori dalla radice consentita. |
| `404` | `not_found` | Sessione o messaggio inesistente. |
| `409` | `aborted` | Il messaggio è stato interrotto da un `abort`. |
| `502` | `process_error` | Il processo `claude` è terminato con errore (exit ≠ 0); `message` include lo stderr. |
| `500` | — | Errore interno inatteso del server. |

Sui rami `failed` (502) e `aborted` (409) il messaggio assistant viene comunque **persistito** con il relativo `status` e il campo `error` valorizzato, così la history resta consultabile.

Esempio di errore del processo (es. tool che richiede un permesso non concesso):
```json
{ "error": { "code": "process_error",
  "message": "claude terminato con exit code 1: Error: ..." } }
```

---

## 8. Note operative e limiti

**Un'istanza per progetto.** Tutte le sessioni di un'istanza condividono la working directory del server. Per lavorare su più progetti, avvia più istanze su porte (e DB) diversi:

```bash
# terminale 1 — progetto A
cd ~/progetti/A && CCAPI_PORT=4096 npm --prefix ~/ccapi start
# terminale 2 — progetto B
cd ~/progetti/B && CCAPI_PORT=4097 npm --prefix ~/ccapi start
```

**Concorrenza.** I messaggi sulla **stessa** sessione sono serializzati (coda FIFO): inviarne due in parallelo è sicuro, il secondo attende il primo. Sessioni diverse girano in parallelo.

**Permessi dei tool.** In modalità headless, se Claude prova a usare un tool non pre-approvato il processo fallisce (→ `502`). Configura i permessi nel file `.claude/settings.local.json` della cartella su cui avvii il server, ad esempio:
```json
{ "permissions": { "allow": ["Bash(npm run *)", "Read", "Edit"] } }
```

**Limite del prompt.** Il prompt non può superare **10 MB** (limite di STDIN della CLI): oltre, la richiesta è respinta con `400` prima di avviare il processo.

**Terminazione del server.** Il server gestisce uno shutdown pulito su `SIGINT`/`SIGTERM` (termina i processi figli, chiude il DB). Fermalo con `Ctrl-C`. Se lo avvii in background, assicurati di terminare il processo `tsx`/`node` corretto: un `kill` del solo wrapper può lasciare il processo figlio in ascolto sulla porta.

**Persistenza.** Sessioni e messaggi sono in SQLite (`.ccapi/ccapi.db` per default): sopravvivono ai riavvii. La cartella `.ccapi/` è esclusa dal versionamento.

**Metadati del modello.** Vedi la nota V3 nel [BACKLOG](BACKLOG.md): su alcune versioni della CLI, `info.model` può restare `null` in JSON mode (mentre `usage` e `costUsd` funzionano).

---

## 9. Troubleshooting

**`502 process_error: "... is already in use"`** — non dovrebbe più accadere: il server usa `--session-id` solo alla creazione e `--resume` per le riprese. Se compare, indica che il transcript della sessione è in uno stato inatteso; crea una nuova sessione.

**`502 process_error` con menzione di un permesso/tool** — Claude ha tentato un'azione non permessa in headless. Aggiungi il tool a `.claude/settings.local.json` (vedi §8).

**La porta è occupata (`EADDRINUSE`)** — c'è già un'istanza (o un processo orfano) sulla porta. Trova e termina il processo, oppure usa un'altra porta:
```bash
ss -ltnp | grep 4096        # individua il PID in ascolto
```

**Risposte lente** — ogni messaggio invoca realmente il modello: la latenza è quella di Claude. Per prove rapide usa `"model": "haiku"`.

**Health OK ma i messaggi falliscono** — `/health` non richiede il binario `claude`. Verifica che `claude` sia nel PATH (o `CCAPI_CLAUDE_BIN`) e funzioni: `echo "ciao" | claude -p`.

---

## Riferimenti

- [README](../README.md) — panoramica
- [Specifica tecnica](specs/2026-06-06-ccapi-core.md) — design e decisioni
- [BACKLOG](BACKLOG.md) — feature future e follow-up noti
