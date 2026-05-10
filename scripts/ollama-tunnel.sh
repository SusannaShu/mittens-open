#!/bin/bash
# ollama-tunnel.sh -- Cloudflare Quick Tunnel for Ollama
#
# Exposes the local Ollama API (port 11434) via a public
# *.trycloudflare.com URL so Mittens can reach it from anywhere.
#
# Usage:
#   ./ollama-tunnel.sh          # starts tunnel, prints URL
#   ./ollama-tunnel.sh --once   # prints URL and exits (for launchd)

set -euo pipefail

OLLAMA_PORT=11434
URL_FILE="$HOME/.ollama-tunnel-url"
LOG_FILE="$HOME/.ollama-tunnel.log"

# Make sure Ollama is actually running
if ! curl -s "http://localhost:$OLLAMA_PORT/" > /dev/null 2>&1; then
  echo "[!!] Ollama is not running on port $OLLAMA_PORT"
  echo "     Start it with: brew services start ollama"
  exit 1
fi

echo "[..] Starting Cloudflare Tunnel → localhost:$OLLAMA_PORT"

# Start cloudflared and capture the URL
cloudflared tunnel --url "http://localhost:$OLLAMA_PORT" 2>&1 | while IFS= read -r line; do
  echo "$line" >> "$LOG_FILE"
  
  # Parse the tunnel URL from cloudflared output
  url=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' || true)
  if [ -n "$url" ]; then
    echo "$url" > "$URL_FILE"
    echo ""
    echo "  ┌──────────────────────────────────────────────────┐"
    echo "  │  Ollama Tunnel Active                            │"
    echo "  │                                                  │"
    echo "  │  URL: $url"
    echo "  │                                                  │"
    echo "  │  Model: gemma4:e2b                               │"
    echo "  │  API:   \${URL}/v1/chat/completions               │"
    echo "  └──────────────────────────────────────────────────┘"
    echo ""
    echo "  In Mittens, set brain endpoint to:"
    echo "  $url"
    echo ""
  fi
done
