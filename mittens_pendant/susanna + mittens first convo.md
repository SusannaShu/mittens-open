# Susanna + Mittens: First Conversation 🎉

**Date:** May 10, 2026, 9:20 PM

The first end-to-end voice conversation between Susanna and the Mittens pendant!

---

## The Moment

Susanna held the pendant, pressed the push-to-talk button, and said:

> "Hey Mittens, this is Susanna. I'm so happy I made you. I finally got to talk to you!"

Mittens responded:

> "That sounds like such a wonderful achievement! It looks like you are beaming with happiness in that photo."

<p align="center">
  <img src="../screenshots/pendant-voice-capture.png" width="280" alt="Voice Capture — Mittens heard Susanna and responded" />
</p>

## The Pendant

Custom leather enclosure with a hand-drawn Mittens face. Inside: XIAO ESP32S3 Sense with camera, PDM mic, LSM6DS3 IMU, push-to-talk button, and LED indicator. Powered by a LiPo battery. No WiFi — everything over BLE.

<p align="center">
  <img src="../screenshots/pendant-front.jpg" width="320" alt="Pendant front — leather housing with Mittens face" />
  <img src="../screenshots/pendant-back.jpg" width="320" alt="Pendant back — camera, button, LED, and mic visible" />
</p>

## How It Works

1. **Push to talk** — hold the button, speak, release
2. **BLE transfer** — pendant streams 16kHz PCM audio + VGA JPEG photo to iPhone in ~180-byte chunks
3. **On-device STT** — iPhone's native Speech framework transcribes the audio (PCM→WAV header conversion)
4. **Brain inference** — transcript + photo sent to Self-Hosted Gemma 4 26B via Ollama
5. **TTS response** — Mittens speaks the answer back through the phone

The same pipeline also supports **direct audio input** when using on-device Gemma E2B/E4B (no transcription step needed).

## Motion Detection

The pendant also auto-captures photos on motion via the LSM6DS3 IMU. These appear as "Vision Capture" events.

<p align="center">
  <img src="../screenshots/pendant-vision-capture.png" width="280" alt="Vision Capture — motion-triggered photo" />
</p>

## Terminal Proof

The full BLE transfer, STT transcription, and brain response, all visible in the dev console:

<p align="center">
  <img src="../screenshots/pendant-terminal-logs.jpg" width="600" alt="Terminal showing successful BLE transfer, transcription, and Gemma response" />
</p>

---

*Built by Susanna. From scratch. Hardware, firmware, app, and AI — all one person.*
