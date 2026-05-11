#!/bin/bash
# tunnel.sh — Expose local Ollama (E2B) via Cloudflare Quick Tunnel
#
# Run from mittens-open:
#   ./scripts/tunnel.sh
#
# What it does:
#   1. Ensures Ollama is running (starts it if not)
#   2. Kills any previous tunnel so you get a fresh URL
#   3. Starts a Cloudflare Quick Tunnel to localhost:11434
#   4. Prints the public URL
#   5. Streams tunnel logs until you Ctrl-C
#
# The public URL changes every time cloudflared restarts (Quick Tunnels
# use ephemeral subdomains). Copy it into Mittens Profile → Brain Endpoint.

set -euo pipefail

OLLAMA_PORT=11434
LOG_FILE="$HOME/.ollama-tunnel.log"
URL_FILE="$HOME/.ollama-tunnel-url"
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

cleanup() {
  echo ""
  echo -e "${DIM}Shutting down tunnel...${RESET}"
  # Kill the cloudflared process we started
  if [ -n "${CF_PID:-}" ] && kill -0 "$CF_PID" 2>/dev/null; then
    kill "$CF_PID" 2>/dev/null
    wait "$CF_PID" 2>/dev/null || true
  fi
  echo -e "${GREEN}✓ Tunnel stopped${RESET}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── 1. Ollama ─────────────────────────────────────────────
echo -e "${CYAN}▸${RESET} Checking Ollama..."
if ! curl -s "http://localhost:$OLLAMA_PORT/" > /dev/null 2>&1; then
  echo -e "  ${YELLOW}Ollama not running — starting via brew services${RESET}"
  brew services start ollama
  # Wait for it
  for i in {1..10}; do
    sleep 1
    if curl -s "http://localhost:$OLLAMA_PORT/" > /dev/null 2>&1; then break; fi
    if [ "$i" -eq 10 ]; then
      echo -e "  ${RED}✗ Ollama didn't start after 10s${RESET}"
      exit 1
    fi
  done
fi
echo -e "  ${GREEN}✓ Ollama running on :${OLLAMA_PORT}${RESET}"

# ── 2. Kill old tunnel ───────────────────────────────────
if pgrep -f "cloudflared tunnel.*localhost:$OLLAMA_PORT" > /dev/null 2>&1; then
  echo -e "${CYAN}▸${RESET} Killing previous tunnel..."
  pkill -f "cloudflared tunnel.*localhost:$OLLAMA_PORT" 2>/dev/null || true
  sleep 1
fi

# ── 3. Start Cloudflare Quick Tunnel ─────────────────────
echo -e "${CYAN}▸${RESET} Starting Cloudflare tunnel → localhost:${OLLAMA_PORT}"
> "$LOG_FILE"  # clear old log

cloudflared tunnel --url "http://localhost:$OLLAMA_PORT" >> "$LOG_FILE" 2>&1 &
CF_PID=$!

# Wait for the URL to appear
echo -ne "  ${DIM}Waiting for URL"
TUNNEL_URL=""
for i in {1..20}; do
  echo -n "."
  sleep 1
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  # Check if cloudflared died
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo ""
    echo -e "  ${RED}✗ cloudflared exited unexpectedly${RESET}"
    cat "$LOG_FILE"
    exit 1
  fi
done
echo -e "${RESET}"

if [ -z "$TUNNEL_URL" ]; then
  echo -e "  ${RED}✗ Timed out waiting for tunnel URL${RESET}"
  echo -e "  ${DIM}Log:${RESET}"
  cat "$LOG_FILE"
  exit 1
fi

echo "$TUNNEL_URL" > "$URL_FILE"

# ── 4. Print status ─────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}  ╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}  ║  ${CYAN}🐱 Mittens E2B Tunnel Active${GREEN}                        ║${RESET}"
echo -e "${BOLD}${GREEN}  ╠══════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}${GREEN}  ║${RESET}                                                      ${BOLD}${GREEN}║${RESET}"
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}URL:${RESET}   ${CYAN}${TUNNEL_URL}${RESET}"
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}API:${RESET}   ${TUNNEL_URL}/v1/chat/completions"
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Model:${RESET} gemma4:e2b"
echo -e "${BOLD}${GREEN}  ║${RESET}                                                      ${BOLD}${GREEN}║${RESET}"
echo -e "${BOLD}${GREEN}  ╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${DIM}  Paste the URL into Mittens Profile → Brain Endpoint${RESET}"
echo -e "${DIM}  Press Ctrl-C to stop the tunnel${RESET}"
echo ""

# ── 5. Stream logs ───────────────────────────────────────
echo -e "${CYAN}▸${RESET} Streaming tunnel logs..."
echo -e "${DIM}─────────────────────────────────────────────────────${RESET}"
tail -f "$LOG_FILE"
