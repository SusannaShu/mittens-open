# Mittens Pendant Integration & STT Fallback

**Date:** May 10, 2026

We've successfully completed the end-to-end integration of the Mittens wearable pendant, hardware sensors, and the local inference pipeline!

## Hardware Improvements
The XIAO ESP32S3 Sense has been enclosed in a custom leather panda face housing, with all peripherals successfully mapped and wired. The pendant now features:
- **LSM6DS3 IMU**: Provides automatic, background motion detection (wake-on-shake) to capture photos seamlessly.
- **Push-to-Talk Button (D1)**: Allows the user to hold and record up to 10 seconds of 16kHz PCM audio, which triggers a capture + photo event on release.
- **Capture Indicator LED (D6)**: Provides instant visual feedback when the pendant is recording or capturing photos.

![Leather Pendant Housing](/Users/susanna/.gemini/antigravity/brain/4fd8191e-71e3-4625-a293-b7f398cbce52/media__1778462629992.jpg)
![Electronics & Wiring](/Users/susanna/.gemini/antigravity/brain/4fd8191e-71e3-4625-a293-b7f398cbce52/media__1778462629998.jpg)

## On-Device STT Fallback Pipeline
Previously, the pendant bridge crashed when attempting to process audio with a non-multimodal brain (like self-hosted Gemma 26B via Ollama). Since standard Ollama instances do not process raw PCM audio streams the way our custom `gemma-e2b` local model does, we built a robust fallback mechanism.

When the active brain lacks native audio support (`brain.supportsAudio === false`):
1. **Header Conversion**: The app reads the raw 16kHz `.pcm` audio stream and dynamically generates a 44-byte `.wav` header.
2. **Local Transcription**: The `.wav` file is passed to `expo-speech-recognition`, utilizing the iPhone's native iOS Speech framework to transcribe the audio into text *locally on-device*.
3. **Prompt Injection**: The resulting transcript is injected into the text prompt.
4. **Cloud Inference**: The transcribed text (and captured photo) are sent to the Self-Hosted Ollama instance using `brain.vision`.

This entire fallback pipeline is completely invisible to the user and ensures the pendant remains fully functional even when using a remote brain.

## Successful End-to-End Tests
The terminal logs confirm that the BLE chunked transfer protocol successfully transmitted the audio and image payloads. The STT fallback instantly transcribed the user's speech, sent it to Gemma 26B, and returned a contextual response.

![Terminal Logs - STT Transcription](/Users/susanna/.gemini/antigravity/brain/4fd8191e-71e3-4625-a293-b7f398cbce52/media__1778462630024.jpg)

The UI perfectly captures these events as `Voice Capture` and `Vision Capture` nodes in the Profile tab:

````carousel
![Voice Capture with STT](/Users/susanna/.gemini/antigravity/brain/4fd8191e-71e3-4625-a293-b7f398cbce52/media__1778462629978.png)
<!-- slide -->
![Vision Capture (Motion Only)](/Users/susanna/.gemini/antigravity/brain/4fd8191e-71e3-4625-a293-b7f398cbce52/media__1778462629997.png)
````
