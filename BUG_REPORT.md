# Bug Report - ShareMe GeoLead

> Analisi completa eseguita il 27/02/2026
> Ultimo aggiornamento: 27/03/2026 — V4.0.3

**Legenda:** ✅ Risolto | ⬜ Aperto

---

## Frontend (`src/App.jsx`)

### Critici

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| F1 | ✅ | SSE stream non cancellabile, nessun `AbortController` | Memory leak su unmount, scrape multipli concorrenti che corrompono i risultati |
| F2 | ✅ | `isScraping` resta `true` se lo stream chiude senza evento "done" | UI bloccata permanentemente su "Estrazione in corso...", bisogna ricaricare la pagina |

### Alti

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| F3 | ✅ | Righe tabella con `key={index}` invece di `key={Place_ID}` | Dopo riordinamento/filtro, React riusa i nodi DOM sbagliati: le note possono essere salvate sulla riga sbagliata |
| F4 | ✅ | Double-click su "Avvia Estrazione" avvia 2 scrape concorrenti | Due SSE stream in parallelo scrivono sullo stesso stato, risultati e progress corrotti |
| F5 | ✅ | `saveNote` su `onBlur` dopo riordino righe | Combinato con F3, una nota viene salvata sul `Place_ID` sbagliato |

### Medi

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| F6 | ✅ | `selectedList` non URL-encoded nei path API | Liste con spazi o caratteri speciali (`#`, `?`, `%`) non funzionano |
| F7 | ⬜ | Nessuna validazione su `radius`/`gridStep` prima dell'invio API | `NaN` inviato al backend se l'utente svuota il campo |
| F8 | ⬜ | `displayedResults` e `uniqueKeywords` ricalcolati ad ogni render senza `useMemo` | Rallentamento con dataset grandi, ogni keystroke ricalcola tutto |
| F9 | ⬜ | Race condition su geocode con click rapidi | Una richiesta più lenta sovrascrive una più recente, la mappa mostra la posizione sbagliata |
| F10 | ⬜ | Dati vecchi visibili durante cambio lista, nessun loading state | L'utente può eseguire azioni (nascondi, chiama, nota) sulla lista sbagliata |
| F11 | ⬜ | Array `logs` cresce senza limite | Memory leak durante sessioni lunghe con scrape multipli |
| F12 | ✅ | Stale closure in `MapClickHandler` | `onPick` potrebbe usare riferimenti obsoleti se referenzia altro stato |
| F13 | ✅ | Enter nell'input "Crea Nuova Lista" invia il form di scraping | L'input è dentro il `<form onSubmit={handleScrape}>`, Enter avvia l'estrazione invece di creare la lista |
| F14 | ⬜ | `toggleRowAction` con click rapidi causa desync ottimistico | Stato UI e stato server divergono per Call/Interested/Hide |
| F15 | ⬜ | `fetchListData` non pulisce i risultati se il fetch fallisce | L'utente vede dati della lista precedente pensando siano della nuova |

### Bassi

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| F16 | ⬜ | Anchor element non rimosso in `downloadExcel` | Ogni download crea un elemento `<a>` orfano nel DOM |
| F17 | ⬜ | `parseInt` senza parametro radix | Input come `"0x10"` verrebbero interpretati come esadecimale |
| F18 | ⬜ | `useEffect` dependencies mancanti per `fetchLists`, `fetchListData`, `fetchSearchHistory` | Violazione regole hooks, stale closures potenziali |
| F19 | ⬜ | `getBoundingClientRect` chiamato durante il render per il dropdown suggerimenti | Layout thrashing, dropdown disallineato dopo scroll |
| F20 | ⬜ | SSE parser non gestisce campi `data:` multi-linea per la specifica SSE | Se il backend invia JSON su più righe `data:`, il parsing fallisce silenziosamente |
| F21 | ⬜ | Regex coordinate accetta valori invalidi (es. `999, 999`) | Leaflet potrebbe mostrare una mappa vuota/rotta |
| F22 | ⬜ | `Math.cos(lat)` = 0 ai poli causa divisione per zero in `generateGridPoints` | Grid points con longitudine `Infinity` |
| F23 | ⬜ | URL API hardcoded a `http://localhost:8000` | App inutilizzabile in qualsiasi ambiente diverso da sviluppo locale |
| F24 | ⬜ | Nessun timeout sulle fetch API | Richieste bloccate indefinitamente se il server non risponde |

---

## Backend (Python)

### Critici

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| B1 | ✅ | `time.sleep()` e I/O sincrono bloccano l'event loop asyncio | **Tutto il server si blocca** durante uno scrape. Health check, altre richieste, tutto fermo |
| B2 | ✅ | Path traversal su TUTTI gli endpoint con `filename` in `lists.py` | Un attaccante può leggere, modificare o cancellare file arbitrari sul server (es. `../../etc/passwd`) |
| B3 | ✅ | Nessuna sanitizzazione del filename in `create_list` | Creazione file arbitrari fuori dalla directory `data/lists/` via path traversal |

### Alti

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| B4 | ✅ | CORS con `"*"` + `allow_credentials=True` | Violazione specifica CORS: browser bloccano le richieste. Qualsiasi sito può fare chiamate API al backend |
| B5 | ✅ | Nessun limite superiore su `radius`, `grid_step`, `keywords` in `/api/scrape` | DoS: una singola richiesta può esaurire CPU, memoria e quota API Google Maps |
| B6 | ✅ | Nessun error handling/retry su `places_nearby` | Un singolo errore di rete o rate-limit uccide l'intero scrape |
| B7 | ✅ | File lock mantenuto durante `yield` nel generatore SSE | Il lock resta acquisito tra un yield e l'altro, bloccando tutte le altre operazioni sullo stesso file |
| B8 | ✅ | Exception handler irraggiungibile per il generatore SSE | Il `try/except` in `main.py` non cattura errori dentro `run_scraping()` perché il generatore è lazy |
| B9 | ✅ | `/api/download` accetta body senza validazione né limite dimensione | DoS via memory exhaustion con POST di dati enormi |

### Medi

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| B10 | ⬜ | Divisione per zero se `grid_step=0` | `ZeroDivisionError`, crash del server con errore 500 |
| B11 | ⬜ | `delete_list` non acquisisce il file lock | Race condition: cancellare un file durante uno scrape o update causa `FileNotFoundError` |
| B12 | ⬜ | Nessun error handling su `gmaps.geocode()` | Errori di rete o API non gestiti, crash 500 con stack trace esposto |
| B13 | ⬜ | `places_data` cresce senza limite in memoria | OOM crash per scrape con raggio grande e molte keyword |
| B14 | ⬜ | Definizione duplicata di `LISTS_DIR` in `scraper_service.py` e `lists.py` | Se uno dei file viene spostato, scraper e API puntano a directory diverse |
| B15 | ⬜ | Import circolare: `scraper_service.py` importa da `routers/lists.py` | Accoppiamento service→router, rischio import circolare futuro |
| B16 | ⬜ | Nessun error handling su `gmaps.geocode()` nello scraper | L'intero scrape fallisce per un errore transiente di geocoding |

### Bassi

| # | Stato | Bug | Cosa succede |
|---|-------|-----|-------------|
| B17 | ⬜ | `googlemaps.Client` istanziato per ogni richiesta in `/api/geocode` | Nessun connection pooling, spreco di risorse |
| B18 | ⬜ | Divisione per zero ai poli (`cos(lat) = 0`) nello scraper | Crash con input a latitudini estreme |
| B19 | ⬜ | Divisione per zero se `total_grid_steps = 0` nel calcolo progresso | Crash se keywords o grid_points sono vuoti |
| B20 | ⬜ | `shutil.move()` non atomico tra filesystem diversi | Rischio (minimo) di perdita dati se source e dest sono su filesystem diversi |
| B21 | ⬜ | TOCTOU race condition in `create_list` (check esistenza → scrivi) | Due richieste simultanee con lo stesso nome: una sovrascrive l'altra |
| B22 | ⬜ | TOCTOU in `scraper_service` (check esistenza file → lettura) | Race condition con delete, finestra molto stretta |
| B23 | ⬜ | `_file_locks` defaultdict cresce senza limite | Memory leak lento: entry mai rimosse per file cancellati |
| B24 | ⬜ | `get_list_content` non acquisisce file lock | Possibile lettura di file parzialmente scritto (mitigato dal pattern atomic write) |

---

## Tool e Workflow Consigliati per Prevenire i Bug

### 1. Linting & Type Checking

| Tool | Dove | Cosa previene |
|------|------|---------------|
| **ESLint** (già presente) | Frontend | Attivare `react-hooks/exhaustive-deps` per catturare dependency mancanti nei hooks |
| **TypeScript** | Frontend | Migrare gradualmente da `.jsx` a `.tsx`. Previene ~30% dei bug (NaN, undefined, tipi sbagliati) |
| **Ruff** | Backend | Linter Python velocissimo: cattura import circolari, variabili inutilizzate, pattern insicuri |
| **mypy** | Backend | Type checking statico per Python, cattura errori di tipo prima del runtime |

### 2. Testing

| Tool | Dove | Cosa previene |
|------|------|---------------|
| **Vitest** | Frontend | Unit test integrato con Vite, zero configurazione. Testare funzioni critiche come `generateGridPoints` |
| **React Testing Library** | Frontend | Test dei componenti React (rendering, interazioni utente) |
| **Pytest** | Backend | Unit test per servizi, router, validazione input |
| **Playwright** o **Cypress** | E2E | Test end-to-end: avrebbe catturato il bug del freeze della griglia |

### 3. Sicurezza

| Tool | Dove | Cosa previene |
|------|------|---------------|
| **Bandit** | Backend | Security linter Python: avrebbe trovato subito il path traversal |
| **npm audit** | Frontend | Controlla vulnerabilità nelle dipendenze npm |
| **Safety** | Backend | Controlla vulnerabilità nelle dipendenze Python |
| **CORS review** | Backend | Mai usare `"*"` con credentials. Elencare esplicitamente gli origin consentiti |

### 4. Pre-commit Hooks

Installare `pre-commit` per eseguire automaticamente prima di ogni commit:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    hooks:
      - id: ruff          # lint Python
      - id: ruff-format   # format Python
  - repo: https://github.com/PyCQA/bandit
    hooks:
      - id: bandit         # security scan Python
  - repo: local
    hooks:
      - id: eslint
        entry: npx eslint  # lint JavaScript/React
      - id: vitest
        entry: npx vitest run  # run test prima del commit
```

### 5. Error Monitoring in Produzione

| Tool | Dove | Cosa fa |
|------|------|---------|
| **Sentry** (free tier) | Frontend + Backend | Cattura errori in produzione con stack trace, context, breadcrumbs |
| **logging** (stdlib Python) | Backend | Log strutturati invece di `print()`, con livelli (INFO, WARNING, ERROR) |

### 6. CI/CD con GitHub Actions

Creare `.github/workflows/ci.yml`:

```
Push/PR → Lint → Type Check → Test → Security Scan → Build → Deploy
```

Ogni step blocca il merge se fallisce. Questo previene la maggior parte dei bug prima che arrivino in produzione.

### 7. Validazione Input

- **Pydantic models** (già disponibile con FastAPI) per validare TUTTI i body delle richieste
- **Limiti espliciti**: `radius` max 50km, `grid_step` min 50m, `keywords` max 10
- **Sanitizzazione filename**: usare `secure_filename()` da Werkzeug o equivalente

### 8. Architettura

- **Variabili d'ambiente** per gli URL API (non hardcodare `localhost:8000`)
- **Centralizzare** `LISTS_DIR` in un modulo config condiviso
- **Separare** le responsabilità: i servizi non devono importare dai router
