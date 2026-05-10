#!/bin/bash
# run-e2b.sh -- Starts Ollama, Cloudflare tunnel, registers URL, and streams logs

echo "[..] Checking Ollama service..."
if ! brew services info ollama | grep -q "started"; then
  echo "     Starting ollama brew service..."
  brew services start ollama
fi

echo "[..] Checking Ollama Tunnel..."
if ! launchctl list | grep -q "com.mittens.ollama-tunnel"; then
  echo "     Starting tunnel LaunchAgent..."
  launchctl load ~/Library/LaunchAgents/com.mittens.ollama-tunnel.plist
fi

# Wait for tunnel URL
echo "[..] Waiting for Ollama tunnel URL..."
OLLAMA_URL=""
for i in {1..15}; do
  if [ -f "$HOME/.ollama-tunnel.log" ]; then
    OLLAMA_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$HOME/.ollama-tunnel.log" | tail -1)
    if [ -n "$OLLAMA_URL" ]; then
      break
    fi
  fi
  sleep 1
done

if [ -z "$OLLAMA_URL" ]; then
  echo "[!!] Failed to get Ollama tunnel URL"
  exit 1
fi
echo "[OK] Ollama Tunnel: $OLLAMA_URL"

# Get Dev Hub tunnel URL and register with Heroku
echo "[..] Waiting for Dev Hub Tunnel URL..."
DEVHUB_URL=""
for i in {1..30}; do
  # Fetch from Dev Hub local API
  RES=$(curl -s http://localhost:4000/api/tunnel-url || echo "")
  DEVHUB_URL=$(echo "$RES" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || echo "")
  
  if [ -n "$DEVHUB_URL" ]; then
    break
  fi
  sleep 1
done

if [ -n "$DEVHUB_URL" ]; then
  echo "[OK] Dev Hub Tunnel: $DEVHUB_URL"
  COMBINED_URL="${DEVHUB_URL},${DEVHUB_URL},${OLLAMA_URL}"
  echo "[..] Registering combined URL with Heroku..."
  
  SECRET=""
  if [ -f "$HOME/Documents/GitHub/dev-hub/.env" ]; then
    SECRET=$(grep DEVHUB_SECRET "$HOME/Documents/GitHub/dev-hub/.env" | cut -d '=' -f2)
  fi
  
  HEROKU_URL="https://sheyou-backend.herokuapp.com"
  curl -s -X POST "${HEROKU_URL}/api/mittens-pipeline/tunnel" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEVHUB_JWT" \
    -H "X-DevHub-Secret: $SECRET" \
    -d "{\"tunnelUrl\": \"${COMBINED_URL}\"}" >/dev/null
  echo "[OK] Registered URL with Heroku"
else
  echo "[!!] Could not get Dev Hub URL. Heroku not updated."
fi

echo ""
echo "=== E2B Model Ready ==="
echo "Model: gemma4:e2b"
echo "Public URL: $OLLAMA_URL"
echo "======================="
echo ""
echo "Streaming tunnel logs..."
tail -f "$HOME/.ollama-tunnel.log"
