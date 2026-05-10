#!/bin/bash
# get-tunnel-url.sh -- prints the current Ollama tunnel URL
# Useful for grabbing the URL to paste into the Mittens app

LOG_FILE="$HOME/.ollama-tunnel.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "No tunnel log found. Is the tunnel running?"
  echo "Start with: launchctl load ~/Library/LaunchAgents/com.mittens.ollama-tunnel.plist"
  exit 1
fi

URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | tail -1)

if [ -n "$URL" ]; then
  echo "$URL"
  echo ""
  echo "Mittens endpoint: $URL/v1/chat/completions"
else
  echo "No tunnel URL found yet. The tunnel may still be starting."
  exit 1
fi
