# Design: Fix CPU Idle Usage — Frontend Build + FastAPI Static

**Date:** 2026-03-27
**Status:** Approved

## Problem

On Intel Mac, the app causes high CPU usage and fan spin-up even when idle/in standby. Two root causes:

1. **`uvicorn --reload`** — watches the entire project directory (including `venv/` with thousands of files) for changes. Constant filesystem polling even at rest.
2. **`npm run dev` (Vite)** — development server with HMR file watching and a persistent websocket to the browser. Not designed for end-user production use.

## Solution

Replace the two-process architecture (Vite dev + uvicorn) with a single process: uvicorn serves both the API and the pre-built frontend static files.

```
Before:  [Browser] → [Vite dev :5173] → [FastAPI :8000]
After:   [Browser] → [FastAPI :8000]  (single process)
```

## Changes

### 1. `backend/main.py`

- Mount `frontend/dist/` as a static directory on the root path using FastAPI's `StaticFiles`.
- Add a catch-all GET route that returns `frontend/dist/index.html` for any path not matched by the API, enabling React client-side routing to work correctly.
- The static mount must come **after** all API routes to avoid shadowing them.

### 2. `avvia_app.command`

- Add `npm run build` step (inside `frontend/`) after node dependencies are installed and before starting uvicorn.
- Remove `--reload` from the uvicorn command.
- Remove the entire frontend dev server block (`npm run dev &`, `FRONTEND_PID`, etc.).
- Remove `FRONTEND_PID` from the `cleanup()` function.
- Change `open http://localhost:5173` to `open http://localhost:8000`.
- Remove the frontend-readiness `sleep 3` (the build is synchronous; by the time uvicorn starts, the static files are ready).

### 3. `frontend/vite.config.js`

No changes needed. Vite's default `npm run build` outputs to `frontend/dist/`, which is exactly what FastAPI will serve.

## Update flow

`avvia_app.command` already runs `git pull` at startup. Because `npm run build` is added after the pull and before uvicorn starts, any frontend changes pulled from GitHub are automatically compiled on each app launch — no manual steps for the end user.

**First-time migration:** the user must replace `avvia_app.command` manually once (the old script will pull the new file via git but may not execute it reliably mid-run). From the second launch onward, updates are fully automatic.

## What stays the same

- CORS middleware is kept (no harm, and useful if the API is ever called from another origin).
- All API routes (`/api/scrape`, `/api/download`, `/api/geocode`, `/api/lists`, `/health`) are unchanged.
- The user-facing workflow is identical: double-click `avvia_app.command`, browser opens automatically.
