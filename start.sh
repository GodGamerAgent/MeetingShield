#!/usr/bin/env bash

# AURA-MEET Start Script (macOS / Apple Silicon)
# Starts FastAPI Backend on port 8000 & Next.js Web Dashboard on port 3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "   🎙️  AURA-MEET: On-Device Smart Meeting Intelligence   "
echo "      & Behavioral Copilot powered by Gemma 4            "
echo "=========================================================="

# Check Python virtualenv
if [ ! -d "backend/venv" ]; then
    echo "[!] Setting up Python virtual environment..."
    python3 -m venv backend/venv
    backend/venv/bin/pip install -r backend/requirements.txt
fi

# Check Web node_modules
if [ ! -d "web/node_modules" ]; then
    echo "[!] Installing Web frontend dependencies..."
    cd web && npm install && cd ..
fi

echo ""
echo "[1/3] Checking LM Studio status at http://localhost:1234/v1..."
if curl -s http://localhost:1234/v1/models > /dev/null 2>&1; then
    echo "  -> [OK] LM Studio local server detected!"
else
    echo "  -> [INFO] LM Studio not currently running on port 1234."
    echo "     (AURA-MEET will run in Fallback Intelligence Mode until LM Studio starts.)"
fi

echo ""
echo "[2/3] Launching FastAPI Backend on http://localhost:8000..."
backend/venv/bin/uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo ""
echo "[3/3] Launching Next.js Web Dashboard on http://localhost:3000..."
cd web
npm run dev &
FRONTEND_PID=$!
cd ..

# Trap signals to shut down cleanly
cleanup() {
    echo ""
    echo "Shutting down AURA-MEET..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo ""
echo "=========================================================="
echo "  🚀 AURA-MEET is LIVE!"
echo "  - Web Dashboard:     http://localhost:3000"
echo "  - FastAPI Engine:    http://localhost:8000"
echo "  - API Documentation: http://localhost:8000/docs"
echo "  - Chrome Extension:  Load directory /extension in chrome://extensions"
echo "=========================================================="
echo "Press Ctrl+C to stop all servers."

# Wait for processes
wait
