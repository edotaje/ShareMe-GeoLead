#!/usr/bin/env bash

set -u

# Colori per il terminale
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Inizializzazione ShareMe GeoLead ===${NC}"

# Spostati nella cartella dello script (la directory base del progetto)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "Directory progetto: $DIR"
ARCH="$(uname -m)"
echo "Architettura Mac rilevata: $ARCH"

# PATH standard in avvio da .command (Finder usa un ambiente ridotto)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# --- Controlla dipendenze di sistema ---

# Controlla se Homebrew è installato
if ! command -v brew &> /dev/null; then
    echo "Homebrew non trovato. Installazione in corso (potrebbe essere richiesta la password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Aggiungi Homebrew al PATH
    if [ -d "/opt/homebrew/bin" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -d "/usr/local/bin" ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

# Controlla e installa Python3
if ! command -v python3 &> /dev/null; then
    echo "Python3 non trovato. Installazione in corso..."
    brew install python
else
    echo -e "${GREEN}Python3 trovato.${NC}"
fi

# Controlla e installa Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js non trovato. Installazione in corso..."
    brew install node
else
    echo -e "${GREEN}Node.js trovato.${NC}"
fi

if [ "$ARCH" = "arm64" ]; then
    BREW_PREFIX="/opt/homebrew"
else
    BREW_PREFIX="/usr/local"
fi

if [ -x "$BREW_PREFIX/bin/brew" ]; then
    eval "$("$BREW_PREFIX/bin/brew" shellenv)"
fi

# --- Setup ambiente virtuale Python ---

# Controlla se il venv esiste e funziona, altrimenti ricrealo
if [ -d "$DIR/venv" ]; then
    # Verifica che il python nel venv sia valido
    if ! "$DIR/venv/bin/python3" --version &> /dev/null; then
        echo "Ambiente virtuale corrotto. Ricreo..."
        rm -rf "$DIR/venv"
    elif ! "$DIR/venv/bin/python3" -c "import platform; print(platform.machine())" 2>/dev/null | grep -qx "$ARCH"; then
        echo "Ambiente virtuale creato su architettura diversa. Ricreo..."
        rm -rf "$DIR/venv"
    fi
fi

if [ ! -d "$DIR/venv" ]; then
    echo "Creazione ambiente virtuale Python..."
    python3 -m venv "$DIR/venv"
fi

# Installa dipendenze Python nel venv
echo "Installazione dipendenze Python..."
"$DIR/venv/bin/pip" install --upgrade pip -q
"$DIR/venv/bin/pip" install -r "$DIR/backend/requirements.txt" -q

if [ $? -ne 0 ]; then
    echo -e "${RED}Errore nell'installazione delle dipendenze Python!${NC}"
    read -p "Premi Invio per chiudere..."
    exit 1
fi
echo -e "${GREEN}Dipendenze Python installate.${NC}"

# --- Installa dipendenze Node ---

echo "Installazione dipendenze Node.js..."
cd "$DIR/frontend"
if [ -d "node_modules" ]; then
    NEED_NODE_CLEANUP=0
    if [ "$ARCH" = "arm64" ] && [ -d "node_modules/@esbuild/darwin-x64" ] && [ ! -d "node_modules/@esbuild/darwin-arm64" ]; then
        NEED_NODE_CLEANUP=1
    fi
    if [ "$ARCH" = "x86_64" ] && [ -d "node_modules/@esbuild/darwin-arm64" ] && [ ! -d "node_modules/@esbuild/darwin-x64" ]; then
        NEED_NODE_CLEANUP=1
    fi

    if [ "$NEED_NODE_CLEANUP" -eq 1 ]; then
        echo "node_modules non compatibile con questa architettura. Pulizia..."
        rm -rf node_modules
    fi
fi

if [ -f "package-lock.json" ]; then
    npm ci --silent
else
    npm install --silent
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}Errore nell'installazione delle dipendenze Node!${NC}"
    read -p "Premi Invio per chiudere..."
    exit 1
fi
cd "$DIR"
echo -e "${GREEN}Dipendenze Node.js installate.${NC}"

echo ""
echo -e "${BLUE}=== Avvio dei servizi ===${NC}"

# --- Avvio Backend ---
echo "Avvio Backend (FastAPI)..."
"$DIR/venv/bin/python" -m uvicorn main:app --reload --app-dir "$DIR/backend" &
BACKEND_PID=$!

# Aspetta che il backend sia pronto
echo "Attesa avvio backend..."
for i in {1..20}; do
    if curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
        echo -e "${GREEN}Backend avviato con successo!${NC}"
        break
    fi
    sleep 1
done

if ! curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
    echo -e "${RED}Backend non raggiungibile su http://127.0.0.1:8000.${NC}"
fi

# --- Avvio Frontend ---
echo "Avvio Frontend (Vite)..."
cd "$DIR/frontend" && npm run dev &
FRONTEND_PID=$!
cd "$DIR"

# Aspetta che il frontend sia pronto e apri il browser
sleep 3
open http://localhost:5173

echo ""
echo -e "${GREEN}=== App avviata! ===${NC}"
echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: http://localhost:5173"
echo ""
echo "Premi Ctrl+C per fermare tutto."

# Gestione chiusura: termina entrambi i processi
cleanup() {
    echo ""
    echo "Chiusura servizi..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "Servizi terminati."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Mantieni lo script attivo
wait
