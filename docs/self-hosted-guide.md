# Self-Hosted Mittens Brain: Ollama Setup Guide

Run a powerful AI model on your MacBook and let Mittens use it from your phone over the local network.

## Why Self-Host?

- **Better quality**: Run Gemma 4 27B (much smarter than the 2B on-device version)
- **Private**: All data stays on your hardware
- **Free**: No API costs

## Hardware Requirements

| Model | Type | RAM Needed | Speed | Quality | Best For |
|-------|------|-----------|-------|---------|----------|
| `gemma4:e4b` | Dense 4B | ~3 GB | Fastest | OK | Quick replies, simple queries |
| `gemma4:e2b` | **MoE 26B** | **~14 GB** | **Fast** | **Great** | **Mittens (recommended)** |
| `gemma4:31b` | Dense 31B | ~18 GB | Slower | Best | Maximum quality, not worth the speed cost |

Your **M5 Pro 24GB** can comfortably run `gemma4:e2b` (~14GB) with 22GB left for macOS.

**Why 26B MoE?** It has 26B total parameters but only activates ~8B per token (Mixture-of-Experts). This means it runs nearly as fast as a small model but reasons like a large one -- critical for Mittens' nutrient estimation and multi-food photo parsing.

## Quick Start

### 1. Install Ollama

```bash
brew install ollama
```

Or download from [ollama.com/download](https://ollama.com/download).

### 2. Pull the Recommended Model

```bash
# Recommended: MoE architecture, fast + smart
ollama pull gemma4:e2b

# Or for fastest responses (lower quality):
ollama pull gemma4:e4b
```

### 3. Enable Network Access

By default, Ollama only listens on localhost. To allow your phone to connect:

```bash
export OLLAMA_HOST=0.0.0.0
ollama serve
```

To make this permanent, add to your `~/.zshrc`:
```bash
echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.zshrc
```

### 4. Connect Your Phone

**Your phone can't use `localhost` -- it needs the MacBook's real IP.**

Two options depending on whether your devices are on the same WiFi:

#### Option A: Same WiFi (simplest)

Find your MacBook's local IP:
```bash
ipconfig getifaddr en0
```
This prints something like `192.168.1.100`.

In Mittens, enter: `http://192.168.1.100:11434`

> This only works when both devices are on the same WiFi network.

#### Option B: Tailscale (works anywhere)

Tailscale creates a private VPN mesh -- your phone can reach the MacBook from any network (home, office, coffee shop, cellular).

1. Install Tailscale on both MacBook and iPhone:
   - Mac: `brew install tailscale` or [tailscale.com/download](https://tailscale.com/download)
   - iPhone: App Store > Tailscale
2. Sign in with the same account on both
3. Find your MacBook's Tailscale IP:
   ```bash
   tailscale ip -4
   ```
   This prints something like `100.64.x.x` -- this IP is stable and works anywhere.
4. In Mittens, enter: `http://100.64.x.x:11434`

> Tailscale is free for personal use (up to 100 devices). The connection is encrypted end-to-end.

### 5. Configure Mittens

1. Open Mittens on your phone
2. Go to **Profile > Integrations > Mittens' Brain**
3. Tap **Self-Hosted** in the PRIVATE row
4. Enter the URL from step 4 (local IP or Tailscale IP + `:11434`)
5. Set model name: `gemma4:27b-q4` (or whichever you pulled)
6. Tap **Test Connection** -- should show green "Connected"

## Task Queue (Offline Mode)

Your MacBook won't always be on. When the self-hosted server is unreachable:

1. Mittens will show **"Use Flash instead"** / **"Queue it"**
2. If you tap **Queue it**, the message is saved locally
3. When your MacBook is back on, tap **Process Queue** to run all queued messages
4. Replies will appear in the chat where the queued messages were

## Troubleshooting

**Can't connect from phone:**
- Make sure phone and MacBook are on the same WiFi network
- Check that `OLLAMA_HOST=0.0.0.0` is set
- Check macOS firewall: System Settings > Network > Firewall (allow Ollama)

**Model too slow:**
- Try a smaller model: `ollama pull gemma4:12b`
- Close other memory-heavy apps on the MacBook

**Out of memory:**
- The 27B model needs ~18GB. If you're running other apps, try `gemma4:12b` instead
- Check memory pressure: Activity Monitor > Memory tab

## BYOK (Bring Your Own Key)

You can also use any OpenAI-compatible API:
- OpenAI (gpt-4o, etc.)
- Anthropic (via proxy)
- Together AI
- Groq
- Any OpenAI-compatible self-hosted server

In Mittens: select **BYOK** > enter API base URL + API key + model name.
