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

The pendant works with any brain. On-device Gemma processes audio natively (no transcription step). Self-hosted Ollama receives the same. No pendant-specific code in any brain implementation.

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

## Mittens Pendant

A wearable XIAO ESP32S3 Sense pendant with camera, mic, and IMU. Firmware flashed and running.

**Hardware wiring:**

| XIAO Pin | GPIO | Connection |
|----------|------|------------|
| D2 | GPIO3 | LSM6DS3 INT1 (wake-up motion, deep sleep wake source) |
| D3 | GPIO4 | LSM6DS3 INT2 (double-tap detection) |
| D4 | GPIO5 | LSM6DS3 SDA |
| D5 | GPIO6 | LSM6DS3 SCL |
| D6 | -- | LED anode (active high, capture indicator) |
| 3V3 | -- | LSM6DS3 VCC |
| GND | -- | LSM6DS3 GND, LED cathode (via resistor) |

LSM6DS3 SA0 tied to VCC (I2C address 0x6B).

**How it works:**
- App auto-discovers pendant via BLE (scans for service UUID on launch)
- LSM6DS3 IMU uses dual-interrupt architecture: INT1 for motion wake, INT2 for double-tap
- Deep sleep wakes on INT1 (motion). After wake, firmware checks INT2 to classify the event
- Motion wake: LED on, captures VGA 640x480 JPEG, streams to phone via BLE, LED off
- Double-tap: LED on, records 5s PDM audio + captures frame, streams to phone via BLE, LED off
- App receives frames and audio, displays in Pendant Feed screen (Profile tab)
- Works with any brain mode (local E2B, self-hosted Ollama)
- No WiFi required -- entirely Bluetooth Low Energy data transfer

**Next steps:**
- Tune tap thresholds for leather enclosure
- Wire pendant captures into existing pipelines (food, activity, pantry auto-triage)
- Rebuild dev client and test full BLE scan/connect/provision flow
- Solder 400mAh LiPo battery and MOSFET power-gating for camera

See [mittens_pendant/MITTENS_PENDANT.md](mittens_pendant/MITTENS_PENDANT.md) for hardware details and protocol docs.

## The Vision

**Wrist band.** IMU for human activity recognition (eating vs typing), skin temp, PPG. Unlocks sleep staging, HRV, menstrual cycle tracking.

**Wardrobe & Object Tracking.** Using local vision models to recognize clothing and personal items, integrating seamlessly into a broader personal inventory system with AR visualization.

**Trading map.** Items marked "want to trade" flow from SUSU Closet to SUSU Map for local peer-to-peer trading.

**Self-hosted brain.** M4 MacBook Pro running Gemma 4 26B via Ollama as the always-available home server brain. Phone connects over local network. Same pipeline code, just a different brain endpoint. 

## Cost

$0/month. Gemma on-device. Bring your own self-hosted brain if you want.
