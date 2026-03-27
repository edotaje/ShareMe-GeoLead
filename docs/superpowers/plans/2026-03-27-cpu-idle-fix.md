# CPU Idle Fix — Frontend Build + FastAPI Static

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate idle CPU usage on Intel Mac by replacing the Vite dev server with a pre-built frontend served directly by FastAPI, and removing uvicorn's `--reload` file watcher.

**Architecture:** `npm run build` compiles the React app to `frontend/dist/` once at startup. FastAPI serves those static files via a catch-all route. One process, one port (8000), no file watching.

**Tech Stack:** FastAPI `FileResponse`, Vite build, bash script.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `backend/requirements.txt` | Modify | Add `aiofiles` (required by FastAPI's async `FileResponse`) |
| `backend/main.py` | Modify | Add SPA catch-all route that serves `frontend/dist/index.html` and static assets |
| `avvia_app.command` | Modify | Add `npm run build`, remove `--reload`, remove Vite dev server block, fix URL and cleanup |

---

## Task 1: Add `aiofiles` to Python dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add `aiofiles` to requirements**

Edit `backend/requirements.txt` — add one line at the end:

```
fastapi
uvicorn
pydantic
googlemaps
pandas
openpyxl
python-dotenv
sse-starlette
python-multipart
aiofiles
```

- [ ] **Step 2: Install and verify**

```bash
venv/bin/pip install aiofiles -q
venv/bin/python -c "import aiofiles; print('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add aiofiles dependency for async static file serving"
```

---

## Task 2: Add SPA static file serving to FastAPI

**Files:**
- Modify: `backend/main.py` (add after all existing routes, at the very end of the file)

- [ ] **Step 1: Add the catch-all route**

Open `backend/main.py`. At the very end of the file (after the `/health` endpoint), add:

```python
# --- Static frontend serving ---
_DIST_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist')

@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    file_path = os.path.join(_DIST_DIR, full_path)
    if full_path and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(_DIST_DIR, 'index.html'))
```

Note: `FileResponse` is already imported on line 11. `os` is already imported on line 7. No new imports needed.

- [ ] **Step 2: Verify the route works manually**

The `frontend/dist/` directory already exists from a previous build. Start uvicorn manually and test:

```bash
cd backend
../venv/bin/python -m uvicorn main:app --app-dir .
```

In a second terminal:

```bash
# Should return HTML (the React app)
curl -s http://127.0.0.1:8000/ | head -5

# Should return the JS asset file (not HTML)
curl -s -o /dev/null -w "%{content_type}" http://127.0.0.1:8000/assets/$(ls ../frontend/dist/assets/*.js | head -1 | xargs basename)

# API should still work
curl -s http://127.0.0.1:8000/health
```

Expected:
- First curl: `<!doctype html>` or `<html`
- Second curl: `text/javascript` or `application/javascript`
- Third curl: `{"status":"ok"}`

Stop uvicorn with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: serve pre-built React frontend via FastAPI catch-all route"
```

---

## Task 3: Update `avvia_app.command`

**Files:**
- Modify: `avvia_app.command`

This task rewrites the bottom half of the script (lines ~181–238). Replace the section from `echo ""` / `=== Avvio dei servizi ===` to the end of the file with the version below.

- [ ] **Step 1: Add frontend build step after node deps install**

After line 181 (`echo -e "${GREEN}Dipendenze Node.js installate.${NC}"`), add the build block. Then replace the services section through end of file.

The complete new ending of the file (from line 181 onward) must be:

```bash
echo -e "${GREEN}Dipendenze Node.js installate.${NC}"

# --- Build del frontend ---
echo "Build del frontend in corso..."
cd "$DIR/frontend" && npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Errore nel build del frontend!${NC}"
    read -p "Premi Invio per chiudere..."
    exit 1
fi
cd "$DIR"
echo -e "${GREEN}Frontend compilato.${NC}"

echo ""
echo -e "${BLUE}=== Avvio dei servizi ===${NC}"

# --- Avvio Backend (serve anche il frontend) ---
echo "Avvio app..."
"$DIR/venv/bin/python" -m uvicorn main:app --app-dir "$DIR/backend" &
BACKEND_PID=$!

# Aspetta che il backend sia pronto
echo "Attesa avvio..."
for i in {1..20}; do
    if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}App avviata con successo!${NC}"
        break
    fi
    sleep 1
done

if ! curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo -e "${RED}App non raggiungibile su http://127.0.0.1:8000.${NC}"
fi

open http://localhost:8000

echo ""
echo -e "${GREEN}=== App avviata! ===${NC}"
echo "URL: http://localhost:8000"
echo ""
echo "Premi Ctrl+C per fermare tutto."

# Gestione chiusura
cleanup() {
    echo ""
    echo "Chiusura servizi..."
    kill $BACKEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    echo "Servizi terminati."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Mantieni lo script attivo
wait
```

- [ ] **Step 2: Verify the full script end-to-end**

Run the script from Finder (double-click `avvia_app.command`) or from terminal:

```bash
bash "/Users/edoardo/Desktop/ShareMe GeoLead/avvia_app.command"
```

Expected sequence in the terminal output:
1. `Build del frontend in corso...` → `Frontend compilato.`
2. `Avvio app...` → `App avviata con successo!`
3. Browser opens automatically at `http://localhost:8000`
4. App UI loads and works normally (map visible, lists accessible)

Verify CPU is no longer pegging in Activity Monitor while the app is idle.

- [ ] **Step 3: Commit**

```bash
git add avvia_app.command
git commit -m "fix: remove uvicorn --reload and Vite dev server to fix idle CPU on Intel Mac"
```

---

## Self-Review

**Spec coverage:**
- ✅ Remove `--reload` → Task 3 removes it
- ✅ Remove Vite dev server → Task 3 removes the `npm run dev` block and `FRONTEND_PID`
- ✅ Add `npm run build` → Task 3 adds it before uvicorn starts
- ✅ FastAPI serves `frontend/dist/` → Task 2 adds the catch-all
- ✅ `aiofiles` dependency → Task 1 adds it
- ✅ Port changes from 5173 to 8000 → Task 3 fixes the `open` command and status messages
- ✅ First-time migration note → documented in spec (manual step for user, not in plan)
- ✅ CORS kept untouched → no task modifies it

**Placeholder scan:** None found.

**Type consistency:** Only one shared symbol — `_DIST_DIR` defined and used within Task 2 only. No cross-task type references.
