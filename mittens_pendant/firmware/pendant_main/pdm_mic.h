#pragma once
/**
 * PDM Microphone -- record audio into PSRAM buffer.
 *
 * Uses the built-in PDM mic on the XIAO ESP32S3 Sense board.
 * Records PCM16 mono at 16kHz. Uses ESP_I2S.h (ESP32 Core v3+).
 *
 * The pendant sends raw PCM16 bytes (no WAV header) to save time.
 * The phone app handles format conversion if needed.
 */

#include <ESP_I2S.h>
#include "config.h"

// Audio buffer in PSRAM (allocated on first use)
static int16_t *g_audioBuffer = nullptr;
static I2SClass I2S;

bool micInit() {
  I2S.setPinsPdmRx(PDM_CLK_PIN, PDM_DATA_PIN);
  
  if (!I2S.begin(I2S_MODE_PDM_RX, AUDIO_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO)) {
    Serial.println("[MIC] I2S init failed");
    return false;
  }

  Serial.printf("[MIC] Initialized (PDM %dHz mono)\n", AUDIO_SAMPLE_RATE);
  return true;
}

/**
 * Record audio into PSRAM buffer.
 * If stopCheck is provided, it's called periodically during recording.
 * When stopCheck returns true, recording stops early (push-to-talk release).
 * Returns number of bytes recorded (0 on failure).
 */
typedef bool (*StopCheckFn)();

size_t micRecord(StopCheckFn stopCheck = nullptr) {
  if (!g_audioBuffer) {
    g_audioBuffer = (int16_t *)ps_malloc(AUDIO_BUFFER_BYTES);
    if (!g_audioBuffer) {
      Serial.println("[MIC] PSRAM alloc failed");
      return 0;
    }
  }

  Serial.printf("[MIC] Recording (max %ds, release button to stop)...\n", AUDIO_DURATION_SEC);

  size_t totalRead = 0;

  while (totalRead < AUDIO_BUFFER_BYTES) {
    // Check if we should stop early (button released)
    if (stopCheck && stopCheck()) {
      Serial.println("[MIC] Stop requested (button released)");
      break;
    }

    // Read in small chunks so stopCheck is responsive
    size_t toRead = 1024;
    size_t remaining = AUDIO_BUFFER_BYTES - totalRead;
    if (toRead > remaining) toRead = remaining;

    size_t bytesRead = I2S.readBytes((char *)((uint8_t *)g_audioBuffer + totalRead), toRead);
    
    if (bytesRead == 0) {
      Serial.println("[MIC] I2S read error or timeout");
      break;
    }
    totalRead += bytesRead;
  }

  float seconds = (float)totalRead / (AUDIO_SAMPLE_RATE * 2);
  Serial.printf("[MIC] Recorded %d bytes (%.1fs)\n", totalRead, seconds);
  return totalRead;
}

/** Get pointer to the audio buffer (valid after micRecord). */
uint8_t* micGetBuffer() {
  return (uint8_t *)g_audioBuffer;
}

/** Free audio buffer memory. */
void micFreeBuffer() {
  if (g_audioBuffer) {
    free(g_audioBuffer);
    g_audioBuffer = nullptr;
  }
}

void micDeinit() {
  I2S.end();
}
