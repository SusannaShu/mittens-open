# Mittens Pendant — Project Brief

> The Mittens app, Strapi backend, AEIOU pipelines, sync logic, and Gemma 4 E2B integration already exist in the repo. This document covers **only the pendant hardware** and how it plugs into the existing Mittens system.

---

## Why a pendant

Mittens currently relies on the user manually photographing meals and chatting to log activities. The pendant adds **ambient observation** — it watches passively, captures frames + audio when something interesting happens, and feeds them into the existing pipelines. Less manual logging, richer data.

Plus, the pendant becomes the **voice interaction surface** — tap it and talk to Mittens directly without unlocking the phone.

---

## Hardware

### Pendant components
- **MCU**: Seeed XIAO ESP32S3 Sense (21×17.5mm)
  - 8MB PSRAM, OV2640 camera, PDM microphone, BLE 5.0, WiFi, U.FL antenna connector
- **IMU**: External MPU-6050 (NOYITO purple breakout)
  - I2C address `0x68` (AD0 low, default)
  - Motion detection interrupt triggers ESP32 deep sleep wake
  - Software-based tap detection (MPU-6050 has no hardware tap registers)
- **Battery**: 400mAh LiPo, 3.7V, JST-PH 2.0mm (to be soldered to BAT pads)
- **Antenna**: 2.4GHz patch (U.FL connector)
- **Future**: AO3401 P-channel MOSFET for camera power gating; MAX98357A I2S amp + speaker for urgent alarms

### Wiring (working today)
```
MPU-6050 → XIAO ESP32S3
─────────────────────
VIN  → 3V3
GND  → GND
SDA  → D4 (GPIO5)
SCL  → D5 (GPIO6)
INT1 → D2 (GPIO3)  ← wake interrupt
```

---

## Firmware: What Works Today (May 7, 2026)

Firmware has been rewritten from a single 746-line monolith into 7 modular files. All code is proven from two tested sketches (`imu_smart_wake.ino` + `xiao_camera_mic.ino`).

| File | Lines | Purpose |
|------|-------|---------|
| `pendant_main.ino` | 196 | setup/loop, event routing, deep sleep |
| `config.h` | 91 | Pin assignments, BLE UUIDs, tap tuning constants |
| `mpu6050.h` | 182 | MPU-6050 driver + software tap detection |
| `camera.h` | 70 | OV2640 VGA 640x480 capture |
| `pdm_mic.h` | 110 | PDM mic, 5s recording into PSRAM |
| `wifi_post.h` | 235 | WiFi connect (NVS first) + HTTP multipart POST |
| `ble_signal.h` | 121 | BLE GATT server for signaling + WiFi provisioning |

Tested and verified in isolation:
- IMU communication over I2C at address `0x68`
- Live accelerometer/gyro readings (verified by tilting)
- Smart wake-on-motion from deep sleep (8 successful wake cycles)
- Camera capture at VGA 640x480 (good quality for food/face analysis)
- PDM microphone recording at 16kHz mono PCM16
- WiFi connection to user-provisioned network (stored in NVS)
- Image decoded successfully (verified via base64 -> image)
- RTC_DATA_ATTR persistent counter survives deep sleep

**No hardcoded WiFi credentials in firmware.** All WiFi configuration is provisioned from the Mittens app via BLE and stored in ESP32 NVS flash. Dev-only fallback SSIDs in `config.h` are empty by default.

---

## Smart Wake Power Architecture

The pendant must last weeks on 400mAh, not hours.

**Tiered wake states:**
| State | Current draw | What's happening |
|-------|-------------|------------------|
| Deep sleep | ~65µA (target, with MOSFET) / ~3mA (current) | ESP32 off, IMU watching for motion |
| Light wake | ~5mA, 100ms | IMU triggered, ESP32 verifies it's real |
| Camera wake | ~150mA, 1-2s | Capture JPEG |
| Transmit | ~130mA, 0.5-1s | WiFi HTTP POST to phone |

**Battery math:**
| Strategy | Battery life |
|----------|-------------|
| Continuous camera + WiFi streaming | 77 minutes |
| Frame every 30s + WiFi POST (no power gating) | 3.8 days |
| Smart wake + power-gated camera (10 events/hr) | **29 days** |

**Critical gotcha**: The Sense camera daughterboard draws 3mA in idle. Without MOSFET power-gating, deep sleep is 3mA (not 65µA). The current build works without gating but needs ~weekly charging instead of monthly.

---

## How the Pendant Plugs into the Existing Mittens App

The pendant is a **data source and interaction surface**. The existing pipelines handle everything downstream -- the pendant delivers frames and audio over WiFi and lightweight event signals over BLE.

```
[Pendant]                           [Mittens App on Phone]
  | frame + audio                      |
  +-- WiFi HTTP POST ---------> pendantServer.ts -> pendantStore
  |                                    |
  | gesture signals                    v
  +-- BLE GATT notify ---------> usePendantBridge -> existing pipelines
```

No pendant-specific pipelines needed. Frames and audio enter the same food/activity/pantry/chat pipelines as manual input.

---

## Pendant Usage Vision

### Three interaction modes

**1. Ambient observation (passive)**
- IMU detects motion -> camera captures frame -> WiFi POST to phone -> app feeds frame into existing pipeline
- Throughout the day, no user action needed
- LED indicates when camera fires (consent signal)

**2. Tap-to-talk conversation (active)**
- User double-taps the pendant
- LED comes on (consent indicator)
- PDM mic records 5 seconds, camera captures one frame
- WiFi POST sends audio + frame to phone
- Existing app processes audio + image (Gemma 4 E2B handles audio natively, no separate transcription step)
- Mittens generates a text reply
- `expo-speech` reads the text aloud through whatever audio output is connected:
  - **AirPods if paired** -> reply plays in user's ear
  - **Phone speaker otherwise** -> reply plays out loud
- Text reply also appears in app chat for later reference

**3. Quick gestures (no conversation)**
- Single tap = "yes, confirm" — dismiss notifications, accept logged activities
- Triple tap = open Mittens app on phone
- Long shake = cancel current action
- Flip face down = privacy mode (camera disabled until flipped back)

The MPU-6050 does not have hardware tap registers. The firmware uses **software-based tap detection**: after any motion wake, it samples accelerometer data at 200Hz for 600ms and classifies the pattern:
- 2+ sharp peaks with quiet gaps -> DOUBLE_TAP
- 1 sharp peak then quiet -> SINGLE_TAP
- Sustained acceleration above threshold -> MOTION

Thresholds are configurable in `config.h` (`TAP_G_THRESHOLD`, `TAP_QUIET_G`, etc.).

### Why this works without a pendant speaker

iOS doesn't let third-party apps pair with AirPods over Bluetooth Classic A2DP, and the ESP32-S3 only does BLE anyway. So pendant ↔ AirPods direct connection is impossible. Going through the phone solves this:

- Phone is already paired with AirPods (system-level)
- `expo-speech` outputs to whatever iOS has currently routed (AirPods if connected, speaker otherwise)
- Mittens just generates text, lets iOS handle the audio routing

This means the pendant doesn't need its own speaker for normal conversation. Only urgent alarms (where AirPods might be off and phone might be silent) would benefit from a pendant speaker — that's a future hardware addition (MAX98357A + small speaker).

### Voice flow detail

```
User: *taps pendant twice*
  |
  v
Pendant: LED on, mic + camera capture
  |
  v
Pendant -> WiFi HTTP POST -> Phone (audio + frame via multipart)
  |
  v
Existing app: Gemma 4 E2B processes audio (native, no STT)
  |
  v
Existing app: generates text reply
  |
  v
Phone: expo-speech reads text aloud
  |
  v
iOS audio routing: -> AirPods (if paired) OR -> phone speaker
  |
  v
Text also displays in app chat
```

Mittens "talks back" by generating text and having the phone read it. Simple, works with system audio routing, no extra hardware needed in the pendant.

### Background mode

For Mittens to speak when the screen is locked:
- Audio background mode in `Info.plist`
- AVAudioSession kept active during conversation
- For passive observations, WiFi POST gives the app data to process; BLE notify wakes the app in background
- AirPods disconnected: questions queue up, deliver when reconnected ("you saw Alex earlier — want me to remember them?")

### Friend introduction flow

A nice consequence of tap-to-talk + camera + audio in one gesture:

```
User: *taps pendant twice*
User: "Hey Mittens, this is my friend Alex"
Mittens (in AirPods): "Nice to meet you, Alex! Want me to remember this?"
User: "Yes"
Mittens: "Got it — I'll recognize Alex next time."
```

Also solves the pendant-privacy problem: Alex *knows* they're being introduced and explicitly participates. Fundamentally different from secretly recording someone.

---

## Privacy

- **No raw frames persisted** — captured frame goes through pipeline → metadata → frame discarded within ~2 seconds
- **LED indicator** when camera or mic active (mandatory, not software-disable-able)
- **Audio is opt-in** — only fires on tap-to-talk, never always-listening
- **Privacy zones** — geofenced auto-disable (bathrooms, medical offices)
- **Friend introduction** as the consent model for known-faces feature

---

## Implementation Status (May 7, 2026)

### Firmware -- DONE
- [x] `pendant_main.ino` -- combined sketch split into 7 modular files
- [x] MPU-6050 driver at correct address `0x68` with motion wake config
- [x] Software tap detection (200Hz sampling, peak counting, gap analysis)
- [x] PDM microphone recording (16kHz mono PCM16, 5 seconds, PSRAM buffer)
- [x] Camera capture at VGA 640x480 for food/face analysis quality
- [x] WiFi HTTP POST to phone (multipart: audio + frame + meta)
- [x] WiFi connect priority: NVS user network -> dev fallback 1 -> dev fallback 2
- [x] BLE GATT server for signaling (EVENT_SIGNAL notify, COMMAND write)
- [x] BLE WiFi provisioning: receives SSID+password+IP, saves to NVS
- [x] No hardcoded credentials -- all WiFi config from app via BLE
- [x] Hardware tested: flashed to XIAO, firmware boots successfully
- [ ] **Tap threshold tuning**: `config.h` values may need adjustment for leather sleeve

### App -- Data Pipeline -- DONE
- [x] `pendantStore.ts` -- in-memory + AsyncStorage capture store (100 max, event emitter)
- [x] `usePendantFeed.ts` -- reactive hook for UI consumption
- [x] `usePendantBridge.ts` -- wired motion/double-tap handlers to pendantStore
- [x] Brain response saved back to store for UI display

### App -- UI -- DONE
- [x] `PendantCaptureCard.tsx` -- frame thumbnail + event badge + brain response
- [x] `PendantStatusBar.tsx` -- connection indicator + today stats
- [x] `PendantSection.tsx` -- collapsible Profile tab section
- [x] `pendant-feed.tsx` -- full feed screen with All/Vision/Voice filters
- [x] Pendant section added to Profile tab between Activities and Memory

### App -- Brain Audio Pipeline -- DONE
- [x] `Brain.audio()` interface added to types.ts
- [x] `E2BBrain.audio()` wired to `LocalInferenceService.generateWithAudio()`
- [x] `supportsAudio` flag on all brain implementations
- [x] Native Swift module `generateWithAudio` already implemented (kInputAudio/kInputAudioEnd)

### App -- Pendant Service Layer -- DONE
- [x] `pendantProtocol.ts` -- BLE UUIDs, event types, HTTP config, multipart parser
- [x] `pendantServer.ts` -- HTTP server interface for WiFi data reception, file saving
- [x] `pendantService.ts` -- orchestrates BLE + WiFi, event routing, auto-reconnect
- [x] `usePendantBridge.ts` -- pendant events -> brain.audio() -> TTS reply
- [x] `usePendantConnection.ts` -- UI hook for connection state, scan/pair flow

### App -- Integration -- DONE
- [x] `usePendantBridge` mounted in `app/_layout.tsx` (runs at app root)
- [x] Bluetooth permissions in `app.json` (NSBluetoothAlways, bluetooth-central background mode)
- [x] `react-native-ble-plx` in package.json (rebuild dev client needed)
- [x] `PendantSection` uses real BLE state (auto-scan, connect, reconnect)
- [x] `PendantWifiSettings` pushes WiFi creds to pendant via BLE COMMAND
- [ ] HTTP server library for receiving WiFi POST data on phone

---

## Next Steps

### Phase 1: Hardware Verification
1. Verify double-tap vs motion classification via Serial monitor
2. Tune tap thresholds in `config.h` for leather sleeve enclosure
3. Pair pendant from app, provision WiFi credentials via BLE
4. Verify end-to-end: tap pendant -> phone receives audio + frame

### Phase 2: App Build
5. Run `npx expo prebuild --platform ios --clean && npx expo run:ios --device`
6. Evaluate and integrate HTTP server library for WiFi POST reception
7. Test BLE scan/connect/provision flow with physical pendant

### Phase 3: Pipeline Integration
9. Wire motion frames into existing pipeline triage (brain classifies frame -> routes to food/activity/pantry)
10. Context-aware capture rate: meal prep or grocery detected -> capture every few seconds for accuracy
11. Activity motion frames -> update activity timing and AEIOU in real time
12. Deduplication: pipeline handles repeated similar frames without cooldown on the pendant

### Phase 4: Self-Hosted Brain
13. M4 MacBook Pro running Ollama with Gemma 4 26B as home server brain
14. Phone auto-discovers local brain on network (mDNS or manual IP in Profile)
15. Same pipeline code, same `OllamaProvider`, just a different `baseUrl`
16. Cloud brains (Gemini free tier, Claude) available as fallback when away from home

### Phase 5: Hardware Finalization
17. Solder 400mAh LiPo battery to BAT+/BAT- pads
18. MOSFET power-gating for camera board (drop deep sleep from 3mA to 65uA)
19. Leather sleeve enclosure

---

## Dual-Channel Wireless Architecture

The pendant uses **two wireless channels** for different purposes:

| Channel | Purpose | Transfer speed |
|---------|---------|----------------|
| **BLE** | Low-power signaling: tap events, pairing, config commands | Micro-amp, instant for tiny packets |
| **WiFi (phone hotspot)** | Data transfer: audio + camera frames | <1 second for 160KB audio |

The phone creates a personal hotspot (or pendant joins the same WiFi). WiFi credentials are provisioned from the Mittens app via BLE during initial pairing and stored in ESP32 NVS flash. No hardcoded credentials in firmware. Connection priority: NVS user network -> dev fallback 1 -> dev fallback 2.

---

## BLE Protocol (signaling only)

```
Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e

  EVENT_SIGNAL (notify) -- tiny JSON: {"type":"DOUBLE_TAP","ts":1234567890}
    UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e

  COMMAND (write)       -- phone -> pendant: wifi creds, config, capture_now
    UUID: 6e400004-b5a3-f393-e0a9-e50e24dcca9e
```

Data (audio, frames) goes over WiFi HTTP POST, not BLE.

Wake reason enum: `MOTION`, `SINGLE_TAP`, `DOUBLE_TAP`, `TRIPLE_TAP`.

---

## WiFi HTTP Protocol

```
POST http://172.20.10.1:8742/pendant/event
Content-Type: multipart/form-data

Parts:
  meta  -- JSON: { type, ts, wake, audioRate, audioChannels }
  audio -- PCM16 mono 16kHz raw bytes (filename: audio.pcm)
  frame -- JPEG bytes (filename: frame.jpg)
```

---

The pendant just delivers raw inputs to these existing systems.
