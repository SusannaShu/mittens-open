#pragma once
/**
 * BLE Chunked Data Transfer -- sends captured JPEG + audio to phone over BLE.
 *
 * Protocol:
 *   1. Pendant captures data, stores in PSRAM
 *   2. Pendant calls bleTransferInit() which sets up data characteristics
 *   3. Pendant signals DATA_READY via event characteristic
 *   4. Phone reads DATA_INFO to learn sizes: "{type}:{jpegLen}:{audioLen}"
 *   5. Phone writes "PULL" to DATA_ACK to start transfer
 *   6. Pendant streams chunks via DATA_STREAM notifications
 *   7. Phone writes "DONE" to DATA_ACK when complete
 *
 * Data format: JPEG bytes first, then audio bytes (concatenated).
 * Phone uses sizes from DATA_INFO to split them.
 */

#include "config.h"
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// ─── Transfer State ───

uint8_t *g_transferData = nullptr; // Combined JPEG + audio in PSRAM
static size_t g_transferTotal = 0;
static size_t g_jpegLen = 0;
static size_t g_audioTransferLen = 0;
static String g_transferType = ""; // "MOTION" or "BUTTON_PRESS"

// Characteristic pointers (created in bleInit in ble_signal.h)
BLECharacteristic *g_dataInfoChar = nullptr;
BLECharacteristic *g_dataStreamChar = nullptr;
BLECharacteristic *g_dataAckChar = nullptr;

volatile bool g_pullRequested = false;
static volatile bool g_transferDone = false;

// ─── ACK Callback ───
// Phone writes "PULL" to start streaming, "DONE" when finished.

class DataAckCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue().c_str();
    Serial.printf("[BLE-TX] ACK received: %s\n", value.c_str());

    if (value == "PULL") {
      g_pullRequested = true;
    } else if (value == "DONE") {
      g_transferDone = true;
    }
  }
};

void bleTransferAttachCallback() {
  if (g_dataAckChar) {
    g_dataAckChar->setCallbacks(new DataAckCallback());
  }
}

// bleTransferSetup() is no longer needed -- characteristics are created in
// bleInit()

// ─── Stage Data ───
// Copies JPEG + audio into a single PSRAM buffer for streaming.

bool bleTransferStage(const char *eventType, uint8_t *jpegBuf, size_t jpegSize,
                      uint8_t *audioBuf, size_t audioSize) {
  // Free any previous transfer
  if (g_transferData) {
    free(g_transferData);
    g_transferData = nullptr;
  }

  g_transferTotal = jpegSize + audioSize;
  if (g_transferTotal == 0) {
    Serial.println("[BLE-TX] No data to stage");
    return false;
  }

  // Allocate in PSRAM for large buffers
  g_transferData = (uint8_t *)ps_malloc(g_transferTotal);
  if (!g_transferData) {
    Serial.println("[BLE-TX] PSRAM alloc failed");
    return false;
  }

  // Copy JPEG first, then audio
  if (jpegBuf && jpegSize > 0) {
    memcpy(g_transferData, jpegBuf, jpegSize);
  }
  if (audioBuf && audioSize > 0) {
    memcpy(g_transferData + jpegSize, audioBuf, audioSize);
  }

  g_jpegLen = jpegSize;
  g_audioTransferLen = audioSize;
  g_transferType = eventType;

  // Update DATA_INFO so phone can read sizes
  String info =
      String(eventType) + ":" + String(jpegSize) + ":" + String(audioSize);
  g_dataInfoChar->setValue(info.c_str());

  g_pullRequested = false;
  g_transferDone = false;

  Serial.printf("[BLE-TX] Staged %s: jpeg=%d audio=%d total=%d\n", eventType,
                jpegSize, audioSize, g_transferTotal);
  return true;
}

// ─── Stream Data ───
// Blocks until phone pulls all data or timeout. Call after
// bleSignalEvent("DATA_READY").

bool bleTransferStream() {
  if (!g_transferData || g_transferTotal == 0) {
    Serial.println("[BLE-TX] No data staged");
    return false;
  }

  Serial.println("[BLE-TX] Waiting for phone to send PULL...");

  // Wait for PULL command from phone
  unsigned long startWait = millis();
  while (!g_pullRequested && millis() - startWait < BLE_TRANSFER_TIMEOUT_MS) {
    delay(50);
  }

  if (!g_pullRequested) {
    Serial.println("[BLE-TX] Timeout waiting for PULL");
    return false;
  }

  Serial.printf("[BLE-TX] Streaming %d bytes in %d-byte chunks...\n",
                g_transferTotal, BLE_CHUNK_SIZE);

  // Stream data as notifications
  size_t offset = 0;
  int chunkNum = 0;
  while (offset < g_transferTotal) {
    size_t remaining = g_transferTotal - offset;
    size_t chunkSize = remaining < BLE_CHUNK_SIZE ? remaining : BLE_CHUNK_SIZE;

    g_dataStreamChar->setValue(g_transferData + offset, chunkSize);
    g_dataStreamChar->notify();

    offset += chunkSize;
    chunkNum++;

    // Pacing: 12ms between chunks + 50ms flush every 20 chunks.
    // The ESP32 BLE stack can queue ~5 notifications; if we send faster
    // than the radio transmits, the tail gets silently dropped.
    if (chunkNum % 20 == 0) {
      delay(50); // Let BLE stack flush
    } else {
      delay(12);
    }

    // Log progress every 50 chunks (~9KB)
    if (chunkNum % 50 == 0) {
      Serial.printf("[BLE-TX] Sent %d/%d bytes (%d%%)\n", offset,
                    g_transferTotal, (int)(100.0f * offset / g_transferTotal));
    }
  }

  // Give BLE stack time to flush the last few queued notifications
  // before we consider the transfer done
  delay(1000);

  Serial.printf("[BLE-TX] All %d chunks sent, waiting for DONE...\n", chunkNum);

  // Wait for DONE acknowledgment
  unsigned long doneStart = millis();
  while (!g_transferDone && millis() - doneStart < 5000) {
    delay(50);
  }

  if (g_transferDone) {
    Serial.println("[BLE-TX] Transfer complete (ACK received)");
  } else {
    Serial.println("[BLE-TX] Transfer complete (no ACK, assuming OK)");
  }

  return true;
}

// ─── Cleanup ───

void bleTransferCleanup() {
  if (g_transferData) {
    free(g_transferData);
    g_transferData = nullptr;
  }
  g_transferTotal = 0;
  g_jpegLen = 0;
  g_audioTransferLen = 0;
  g_pullRequested = false;
  g_transferDone = false;
}
