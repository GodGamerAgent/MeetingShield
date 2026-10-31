#!/usr/bin/env bash
# Quorum — starts the FastAPI backend (port 8000) and the Next.js dashboard (port 3001).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Optional local settings (see .env.example)
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

echo "Quorum — private meeting notes"
echo

if [ ! -d "backend/venv" ]; then
    echo "[setup] Creating Python virtual environment..."
    python3 -m venv backend/venv
    backend/venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -d "web/node_modules" ]; then
    echo "[setup] Installing dashboard dependencies..."
    (cd web && npm install)
fi

LM_URL="${LM_STUDIO_BASE_URL:-http://localhost:1234/v1}"
if curl -s "$LM_URL/models" > /dev/null 2>&1; then
    echo "[ok]   LM Studio reachable at $LM_URL"
else
    echo "[warn] LM Studio not reachable at $LM_URL."
    echo "       Recording and transcription still work; summaries wait until LM Studio serves Gemma 4."
fi

echo "[run]  Backend   -> http://localhost:8000  (API docs at /docs)"
backend/venv/bin/uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

echo "[run]  Dashboard -> http://localhost:3001"
(cd web && npm run dev) &
FRONTEND_PID=$!

cleanup() {
    echo
    echo "Stopping Quorum..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo
echo "Chrome extension: chrome://extensions -> Developer mode -> Load unpacked -> ./extension"
echo "Press Ctrl+C to stop."
wait
