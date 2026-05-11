# Mittens

Susanna's bot — brain, eyes, ears, and voice, in one project.

Mittens runs on your phone. It tracks your nutrition, track your location to log your activities, reflects on your day through Stanford Life Design, helps you learn languages, watches the web for you, and talks to you about all of it. It sees what you eat, hears what you say, and remembers what matters to you.

Local model on your phone. Host your own model and port it in, or bring your own API keys. Your data stays on-device.

<p align="center">
  <img src="screenshots/today-dashboard.png" width="180" alt="Today dashboard" />
  <img src="screenshots/today-activity-log.png" width="180" alt="Activity log" />
  <img src="screenshots/mittens-chat.png" width="180" alt="Chat with Mittens" />
  <img src="screenshots/reflect-calendar.png" width="180" alt="Calendar reflection" />
  <img src="screenshots/places-map.png" width="180" alt="Places map" />
</p>

## What Mittens does

**Nutrition.** Photograph your meal and Mittens identifies every item, estimates 19 nutrients, tracks your gaps against RDA, and plans your next meal to close them. Two-phase AI: vision identifies the food, a separate knowledge call estimates nutrients. No cognitive overload, dramatically better accuracy. Bioavailability-aware (vitamin C enhances iron, calcium blocks it), source-aware (plant vs animal vitamin A), hydration from food water content. Meal planning uses a MILP solver to optimize nutrients across the day.

**Activity logging.** Photo, text, or manual — all inputs flow through the same pipeline. Every activity gets AEIOU tags (Activities, Environments, Interactions, Objects, Users), weighted life categories (work/health/play/love), engagement and energy ratings. Health impact computed deterministically with peer-reviewed citations. Movement trails from location tracking. Geofenced known places.

**Life Design.** Stanford Life Design philosophy, practiced daily. Lifeview and workview reflections. Nightly check-in that starts with your most important unreflected activity. Life balance gauges that break health into 7 research-backed pillars: nutrition, movement, sleep, gut health, nature exposure, circadian hygiene, and brain hygiene. Every metric is explainable — tap any gauge to see which logs affected it, by how much, and why, with tappable DOI-linked research citations.

**Sleep.** Tracks quantity, quality, sleep debt, and environmental factors (room temp, light, noise, screen time, caffeine timing). All backed by NIH, Harvard, CDC, and Sleep Foundation research.

**Smart pantry.** Photograph your fridge and Mittens inventories what's inside with freshness estimates. Meals auto-deduct from pantry. Grocery lists generated from meal plans cross-referenced against what you already have.

**Talk to Mittens.** The chat is the primary interface. Mittens classifies what you say or photograph and routes to the right pipeline — food, activity, sleep, pantry, or web lookup. It reads your calendar, searches past conversations, remembers your habits and preferences, and updates its memory as your life changes. Voice input and TTS output.

**Web + social lookup.** "Any free food from nycforfree today?" "Anything on HackerNews?" "New soft robotics papers — humanoid only, not marine." Mittens fetches the content (RSS, API, HTML scrape, or Instagram stories via server-side Instaloader), runs vision or text filtering through the brain, extracts structured details, and shows you cards. No polling — on-demand when you ask. Uses your lifeview/workview as implicit interest filters.

**Places.** Location intelligence with movement trails, known places with geofencing, auto-conversion of location logs into activity maps.

**Calendar.** Google Calendar OAuth sync. Events tracked with actual timing and location from location logs. Focus timer synchronized with calendar events for deep work sessions. Dynamic departure alarms with travel time estimation.

## Architecture

```
You ask Mittens something       Pendant captures something
         |                              |
         v                              v
      triage -->  which pipeline(s)?  <-- auto-triage by event type
         |                              |
         +-->  food       (photo/text -> nutrients)
         +-->  activity   (movement -> AEIOU + life categories)
         +-->  pantry     (fridge photo -> inventory)
         +-->  sleep      (sleep mention -> sleep log)
         +-->  chat       (conversation -> reply + side effects)
         +-->  watch      (web + social: fetch, filter, extract, cards)
```

Pendant frames and audio enter the same pipelines as manual input. Motion frames auto-triage to food/activity/pantry based on what the brain sees. Double-tap audio goes through the chat pipeline. No separate pendant pipeline -- same code path, different input source.

### Brain (pick one)

| Brain | Context | Cost | Where it runs |
|-------|---------|------|---------------|
| Gemma 4 E2B | ~150 tokens | Free | On your phone (LiteRT) |
| Gemma 4 26B | 8K tokens | Free | Self-hosted (Ollama) |

Brains are dumb text-in/text-out wrappers. Pipelines own all intelligence: prompt construction, response parsing, phase sequencing. Every phase checks `brain.contextWindow` and adapts -- compact format (short JSON keys) for E2B, verbose for large models. Swap brains in Profile without changing any pipeline code.

The pendant works with any brain. On-device Gemma E2B/E4B processes audio natively (no transcription step). For self-hosted Ollama, pendant audio is automatically transcribed via the iPhone's native Speech framework, then sent as text alongside the photo. No pendant-specific code in any brain implementation.

### Data

| Mode | Where | Backup |
|------|-------|--------|
| Local | SQLite on device | None (your phone) |

Default local: Gemma for private inference. 

### Stack

Expo dev client (React Native + TypeScript). Redux Toolkit. SQLite local-first. LiteRT-LM native module (iOS Swift + Android Kotlin) for on-device Gemma. Google Calendar OAuth. 

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20.x LTS | `nvm install 20` or `brew install node@20` |
| npm | 10.x | Comes with Node 20 |
| Xcode | 26+ | Mac App Store |
| CocoaPods | 1.16+ | `sudo gem install cocoapods` |
| Java | OpenJDK 17 | `brew install openjdk@17` (Android only) |
| Expo CLI | 6.x | No global install needed (`npx expo`) |

## Setup

```bash
# Install dependencies
npm install

# Build native iOS project (first time or after native module changes)
npx expo prebuild --platform ios --clean

# Run on physical device
npx expo run:ios --device

# Run on simulator
npx expo run:ios
```

This app requires an Expo dev client (not Expo Go) because it uses native modules: LiteRT for on-device inference, BLE for pendant communication, and Motion Activity for HAR.

### Android Setup (Optional)

```bash
# Ensure ANDROID_HOME is set
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools

# Build and run
npx expo run:android
```

### Self-Hosted Brain (Ollama Tunnel)

To use the self-hosted Gemma 26B brain from outside your local network (e.g. testing on cellular, sharing with someone):

```bash
# Prerequisites (one-time)
brew install ollama cloudflared
ollama pull gemma4:e2b

# Start tunnel — shows public URL and streams logs
./scripts/tunnel.sh
# or
npm run tunnel
```

The script:
1. Ensures Ollama is running and configured for tunnel access (`OLLAMA_ORIGINS=*`, `OLLAMA_HOST=0.0.0.0`)
2. Stops any competing LaunchAgent tunnels
3. Starts a Cloudflare Quick Tunnel to `localhost:11434`
4. Prints the public URL (e.g. `https://abc-xyz.trycloudflare.com`)
5. Streams tunnel logs until you `Ctrl-C`

**When does the URL change?** Only when `cloudflared` restarts — i.e., when you re-run `tunnel.sh` or the process is killed. The URL stays stable as long as the tunnel process is running.

**To configure in the app:** go to Profile → Integrations → Brain → Self-Hosted, paste the tunnel URL, and tap Test Connection.

## Mittens Pendant

A wearable XIAO ESP32S3 Sense pendant with camera, mic, IMU, and push-to-talk button. Leather-enclosed with a hand-drawn Mittens face. Firmware flashed and running.

<p align="center">
  <img src="screenshots/pendant-front.jpg" width="280" alt="Pendant front — leather housing with Mittens face" />
  <img src="screenshots/pendant-back.jpg" width="280" alt="Pendant back — camera, button, LED, and mic visible" />
</p>

<p align="center">
  <img src="screenshots/pendant-workbench.jpg" width="380" alt="Pendant workbench with leather enclosure and electronics" />
  <img src="screenshots/pendant-wiring.jpg" width="380" alt="XIAO ESP32S3 wired to LSM6DS3 IMU, LED, push-to-talk button, and LiPo battery" />
</p>

**First conversation (May 10, 2026):** Susanna said "Hey Mittens, I'm so happy I made you!" and Mittens replied "That sounds like such a wonderful achievement! It looks like you are beaming with happiness in that photo."

<p align="center">
  <img src="screenshots/pendant-voice-capture.png" width="260" alt="Voice capture — Mittens heard Susanna and responded" />
  <img src="screenshots/pendant-vision-capture.png" width="260" alt="Vision capture — motion-triggered photo" />
  <img src="screenshots/pendant-terminal-logs.jpg" width="340" alt="Terminal showing BLE transfer, STT transcription, and brain response" />
</p>

**Hardware wiring:**

| XIAO Pin | GPIO | Connection |
|----------|------|------------|
| D1 | GPIO2 | Push-to-talk button → GND (internal pullup) |
| D2 | GPIO3 | LSM6DS3 INT1 (motion wake, deep sleep wake source) |
| D3 | GPIO4 | LSM6DS3 INT2 (reserved) |
| D4 | GPIO5 | LSM6DS3 SDA |
| D5 | GPIO6 | LSM6DS3 SCL |
| D6 | -- | LED anode (active high, capture indicator) |
| 3V3 | -- | LSM6DS3 VCC |
| GND | -- | LSM6DS3 GND, LED cathode (via resistor), button |

LSM6DS3 SA0 tied to VCC (I2C address 0x6B).

**How it works:**
- **Push-to-talk button** (D1): hold to record audio, release to capture photo and send. Variable-length recording up to 10s. 16kHz PCM mono.
- **Motion detection** (IMU): LSM6DS3 triggers on movement, pendant captures a VGA JPEG and streams to phone. 3s cooldown between events.
- **Smart sleep**: stays awake while BLE is connected or there's been activity in the last 5 min. Enters deep sleep after 5 min idle. Wakes on button press or motion.
- **BLE transfer**: chunked notification protocol (180-byte chunks, 12ms pacing with periodic flush). App pulls data via PULL/DONE handshake. Concurrent pull protection prevents data corruption.
- **On-device STT fallback**: when the active brain doesn't support native audio (e.g. self-hosted Ollama), pendant audio is converted from raw PCM to WAV and transcribed locally using iOS Speech framework. The transcript is then sent as text to the brain alongside the photo.
- **iOS background reconnect**: `restoreStateIdentifier` enables iOS to maintain BLE scanning even when the app is backgrounded or killed. Phone auto-reconnects when pendant wakes.
- **No WiFi required** — entirely Bluetooth Low Energy data transfer.
- Works with any brain mode (local E2B, self-hosted Ollama).

See [mittens_pendant/firmware/pendant_main/SETUP.md](mittens_pendant/firmware/pendant_main/SETUP.md) for hardware setup and flashing guide.

## The Vision

**Wrist band.** IMU for human activity recognition (eating vs typing), skin temp, PPG. Unlocks sleep staging, HRV, menstrual cycle tracking.

**Wardrobe & Object Tracking.** Using local vision models to recognize clothing and personal items, integrating seamlessly into a broader personal inventory system with AR visualization.

**Trading map.** Items marked "want to trade" flow from SUSU Closet to SUSU Map for local peer-to-peer trading.

**Self-hosted brain.** M4 MacBook Pro running Gemma 4 26B via Ollama as the always-available home server brain. Phone connects over local network. Same pipeline code, just a different brain endpoint. 

## Cost

$0/month. Gemma on-device. Bring your own self-hosted brain if you want.
