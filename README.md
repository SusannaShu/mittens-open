# Mittens

Susanna's bot — brain, eyes, ears, and voice, in one project.

Mittens runs on your phone. It tracks your nutrition, track your location to log your activities, reflects on your day through Stanford Life Design, helps you learn languages, reads your emails, watches the web for you, and talks to you about all of it. It sees what you eat, hears what you say, and remembers what matters to you.

Local model on your phone. Host your own model and port it in, or bring your own API keys. Your data stays on-device or syncs to the cloud. You decide.

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

**Talk to Mittens.** The chat is the primary interface. Mittens classifies what you say or photograph and routes to the right pipeline — food, activity, sleep, pantry, email, or web lookup. It reads your calendar, searches past conversations, remembers your habits and preferences, and updates its memory as your life changes. Voice input and TTS output.

**Email.** "Find my depop dress." "Check my emails with Olivia — did she say Sunday or Monday?" "Send an email to Gretchen saying I'm late." Mittens searches Gmail, reads and filters emails, extracts order confirmations into structured wardrobe items (for SUSU Closet), pulls calendar events out of messages, composes and sends emails. Drafts always shown for confirmation before sending. Gmail OAuth, separate from calendar.

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
         +-->  email      (Gmail agent: search, read, compose, send)
         +-->  watch      (web + social: fetch, filter, extract, cards)
```

Pendant frames and audio enter the same pipelines as manual input. Motion frames auto-triage to food/activity/pantry based on what the brain sees. Double-tap audio goes through the chat pipeline. No separate pendant pipeline -- same code path, different input source.

### Brain (pick one)

| Brain | Context | Cost | Where it runs |
|-------|---------|------|---------------|
| Gemma 4 E2B | ~150 tokens | Free | On your phone (LiteRT) |
| Gemma 4 26B | 8K tokens | Free | Self-hosted (Ollama) |
| Gemini Flash | 1M tokens | Free tier | Google Cloud |
| Claude Sonnet/Opus | 200K tokens | Paid | Anthropic API |

Brains are dumb text-in/text-out wrappers. Pipelines own all intelligence: prompt construction, response parsing, phase sequencing. Every phase checks `brain.contextWindow` and adapts -- compact format (short JSON keys) for E2B, verbose for large models. Swap brains in Profile without changing any pipeline code.

The pendant works with any brain. On-device Gemma processes audio natively (no transcription step). Cloud brains (Gemini, Claude) receive transcribed text + image. Self-hosted Ollama receives the same. No pendant-specific code in any brain implementation.

### Data (pick one)

| Mode | Where | Backup |
|------|-------|--------|
| Local | SQLite on device | None (your phone) |
| Cloud | SQLite + Strapi sync | Strapi backend |

Default hybrid: Gemma for private inference + Cloud for backed-up data. Toggle each independently in Profile.

### Stack

Expo dev client (React Native + TypeScript). Redux Toolkit. SQLite local-first. Strapi backend (optional). LiteRT-LM native module (iOS Swift + Android Kotlin) for on-device Gemma. Google Calendar OAuth. Gmail OAuth. Cloudinary for photo storage.

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

### Backend Configuration

Update `lib/api.ts` with your Strapi URL. Default is `http://localhost:1337`.

To run fully offline: select a local brain model in Profile and use local-only storage. No backend needed.

To run with Strapi backend:
```bash
cd ~/Documents/GitHub/strapi-backend
npm install
npm run develop     # starts on :1337
```

### Android Setup (Optional)

```bash
# Ensure ANDROID_HOME is set
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools

# Build and run
npx expo run:android
```

## Test Account

Create a test account against your local Strapi backend:

```bash
curl -X POST http://localhost:1337/api/auth/local/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"<your_username>","email":"<your_email>","password":"<your_password>"}'
```

## Related Repos

| Repo | Port | Purpose |
|------|------|---------|
| [strapi-backend](../strapi-backend) | :1337 | API backend -- auth, nutrition, activity, calendar, dev tasks |
| [dev-hub](../dev-hub) | :4000 | Remote dev dashboard -- simulator stream, notes pipeline |
| [susu-map](../susu-map) | :5173 | Community map -- free food, events, marketplace |
| [building-fashion-future](../building-fashion-future) | :3001-3003 | Creative economy monorepo |

See [DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md) for full ecosystem setup.

## Working with AI Agents

Mittens development is designed for AI-assisted workflows:

1. **Write notes** in the Dev Hub notepad (http://localhost:4000) describing bugs, features, or questions
2. Notes get auto-parsed, triaged by project and priority, and stored as `dev-task` entries in Strapi
3. The Dev Notes screen in Mittens (`app/dev-notes.tsx`) shows all tasks with approve/reject/retry actions
4. Tasks include auto-generated AI prompts optimized for the assigned model tier

RTK Query patterns:
- All API slices live in `lib/services/`
- Base API defined in `lib/services/baseApi.ts` (baseUrl: `http://localhost:1337`)
- All Strapi v5 endpoints need `/api/` prefix in the URL path
- Cache invalidation via tag types defined in baseApi

## Mittens Pendant

A wearable XIAO ESP32S3 Sense pendant with camera, mic, and IMU. Firmware flashed and running.

**How it works:**
- App auto-discovers pendant via BLE (scans for service UUID on launch)
- User enters WiFi credentials in app -> pushed to pendant via BLE -> stored in NVS flash
- Motion wake: captures VGA 640x480 JPEG, WiFi POSTs to phone
- Double-tap: records 5s PDM audio + captures frame, WiFi POSTs to phone
- App receives frames and audio, displays in Pendant Feed screen (Profile tab)
- Works with any brain mode (local E2B, self-hosted Ollama, cloud Gemini/Claude)
- No hardcoded WiFi credentials in firmware -- all provisioned from app

**Next steps:**
- Tune tap thresholds for leather enclosure
- Wire pendant captures into existing pipelines (food, activity, pantry auto-triage)
- Rebuild dev client and test full BLE scan/connect/provision flow
- Solder 400mAh LiPo battery and MOSFET power-gating for camera

See [mittens_pendant/MITTENS_PENDANT.md](mittens_pendant/MITTENS_PENDANT.md) for hardware details and protocol docs.

## The Vision

**Wrist band.** IMU for human activity recognition (eating vs typing), skin temp, PPG. Unlocks sleep staging, HRV, menstrual cycle tracking.

**SUSU Closet integration.** Fashion order items extracted from email flow into SUSU Closet's wardrobe. Mittens → Strapi → SUSU Closet. Later: SUSU Closet gets its own email import with server-side inference for web users.

**Trading map.** Items marked "want to trade" flow from SUSU Closet to SUSU Map for local peer-to-peer trading.

**Self-hosted brain.** M4 MacBook Pro running Gemma 4 26B via Ollama as the always-available home server brain. Phone connects over local network. Same pipeline code, just a different brain endpoint. Cloud brains (Gemini free tier, Claude) available as fallback when away from home.

## Cost

$0/month. Gemma on-device + Gemini free tier + your own Strapi. Bring your own API keys for premium models if you want them.
