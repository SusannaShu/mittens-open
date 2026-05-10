/**
 * Mittens Pendant -- Main Firmware
 *
 * Hardware: XIAO ESP32S3 Sense + LSM6DS3 IMU (I2C @ 0x6B) + LED on D6
 *
 * Deep sleep with IMU wake-on-motion. On wake, samples accelerometer
 * to classify the event via software tap detection:
 *   DOUBLE_TAP -> record 5s PDM audio + capture JPEG -> BLE transfer
 *   SINGLE_TAP -> BLE notify only
 *   MOTION     -> capture JPEG -> BLE transfer
 *
 * DATA TRANSFER:
 *   All data (photos, audio) is sent over BLE chunked transfer.
 *   No WiFi required for normal operation. The phone pulls data
 *   after receiving a DATA_READY BLE notification.
 *
 * PROVISIONING (WiFi still used for initial pairing only):
 *   If no WiFi credentials are stored and the pendant has never
 *   been paired, it enters provisioning mode. Once paired via BLE,
 *   the pendant no longer needs WiFi for data transfer.
 *
 * Arduino IDE settings:
 *   Board:            XIAO_ESP32S3
 *   PSRAM:            OPI PSRAM
 *   Partition Scheme: Maximum APP (7.9MB APP No OTA/No FS)
 */

#include "driver/rtc_io.h"
#include "esp_sleep.h"
#include <Wire.h>

#include "config.h"
#include "lsm6ds3.h"
#include "camera.h"
#include "pdm_mic.h"
#include "ble_signal.h"
#include "ble_transfer.h"
#include "wifi_post.h"

// --- Persistent State (survives deep sleep) ---
RTC_DATA_ATTR int wakeCount = 0;

// --- LED ---
void ledOn()  { digitalWrite(LED_PIN, HIGH); }  // Active high (external LED on D6)
void ledOff() { digitalWrite(LED_PIN, LOW);  }

// --- BLE Data Transfer Flow ---
// Replaces WiFi POST. Captures data, stages it, and waits for phone to pull.

/**
 * Stage data and wait for phone to pull it over BLE.
 * Returns true if phone successfully pulled the data.
 */
bool bleTransferAndWait(
  const char *eventType,
  uint8_t *jpegBuf, size_t jpegLen,
  uint8_t *audioBuf, size_t audioLen
) {
  // Stage the data in PSRAM
  if (!bleTransferStage(eventType, jpegBuf, jpegLen, audioBuf, audioLen)) {
    return false;
  }

  // Signal the phone that data is ready
  bleSignalEvent("DATA_READY");

  // Wait for phone to connect and pull the data
  bool ok = bleTransferStream();

  // Cleanup
  bleTransferCleanup();

  return ok;
}

// --- Event Handlers ---

bool handleDoubleTap() {
  Serial.println("[FLOW] === DOUBLE TAP ===");
  ledOn();

  // 1. Record 5s audio
  bool micOk = micInit();
  size_t audioLen = 0;
  if (micOk) {
    audioLen = micRecord();
    micDeinit();
  }

  // 2. Capture frame
  bool camOk = cameraInit();
  camera_fb_t *fb = nullptr;
  if (camOk) {
    fb = captureFrame();
  }

  // 3. Init BLE (includes data transfer characteristics)
  bleInit();
  bleTransferAttachCallback();

  // 4. Signal the tap type first (for BLE-connected phones)
  bleSignalEvent("DOUBLE_TAP");
  delay(200);

  // 5. Transfer data over BLE
  bool ok = bleTransferAndWait(
    "DOUBLE_TAP",
    fb ? fb->buf : nullptr, fb ? fb->len : 0,
    audioLen > 0 ? micGetBuffer() : nullptr, audioLen
  );

  // 6. Cleanup
  if (fb) esp_camera_fb_return(fb);
  micFreeBuffer();
  bleDeinit();
  ledOff();

  return ok;
}

bool handleSingleTap() {
  Serial.println("[FLOW] === SINGLE TAP ===");

  bleInit();
  bleSignalEvent("SINGLE_TAP");
  delay(500);
  bleDeinit();

  return true;  // No data to transfer
}

bool handleMotion() {
  Serial.println("[FLOW] === MOTION ===");
  ledOn();

  // Capture frame only (no audio for passive observation)
  bool camOk = cameraInit();
  camera_fb_t *fb = nullptr;
  if (camOk) {
    fb = captureFrame();
  }

  if (!fb) {
    Serial.println("[FLOW] No frame captured, skipping");
    ledOff();
    return true;
  }

  // Init BLE (includes data transfer characteristics)
  bleInit();
  bleTransferAttachCallback();

  // Transfer frame over BLE
  bool ok = bleTransferAndWait(
    "MOTION",
    fb->buf, fb->len,
    nullptr, 0
  );

  // Cleanup
  esp_camera_fb_return(fb);
  bleDeinit();
  ledOff();

  return ok;
}

// --- Deep Sleep ---

void enterDeepSleep() {
  Serial.println("[SLEEP] Entering deep sleep...");
  Serial.flush();

  // Re-arm IMU motion interrupt
  lsmConfigureWake();

  // Configure GPIO3 (INT) as wake source (active high)
  pinMode(IMU_INT_PIN, INPUT);
  
  // Wait for INT pin to go low (force clear any lingering interrupt)
  int retries = 50;
  while (digitalRead(IMU_INT_PIN) == HIGH && retries > 0) {
    lsmRead(LSM6DS3_TAP_SRC);
    lsmRead(LSM6DS3_WAKE_UP_SRC);
    delay(10);
    retries--;
  }
  
  if (digitalRead(IMU_INT_PIN) == HIGH) {
    Serial.println("[SLEEP] WARNING: INT pin stuck HIGH! Deep sleep will immediately wake.");
  } else {
    Serial.println("[SLEEP] INT pin is LOW, safe to sleep.");
  }

  esp_sleep_enable_ext0_wakeup((gpio_num_t)IMU_INT_PIN, 1);
  rtc_gpio_pullup_dis((gpio_num_t)IMU_INT_PIN);
  rtc_gpio_pulldown_en((gpio_num_t)IMU_INT_PIN);

  esp_deep_sleep_start();
}

// --- Provisioning Mode (WiFi -- only for initial setup) ---
// Kept for backwards compatibility. Once paired via BLE,
// the pendant no longer needs WiFi for normal data transfer.

void enterProvisioningMode() {
  Serial.println("[PROV] Entering provisioning mode -- waiting for valid WiFi");

  bleInit();
  bleSignalEvent("WIFI_FAIL");

  unsigned long startTime = millis();
  bool provisioned = false;

  while (!provisioned) {
    // Blink LED: 2 quick blinks + pause = "needs setup"
    ledOn();  delay(100);
    ledOff(); delay(100);
    ledOn();  delay(100);
    ledOff(); delay(800);

    // Check if new WiFi credentials were received via BLE
    wifiLoadConfig();
    if (g_userSSID.length() > 0) {
      Serial.printf("[PROV] Trying WiFi: %s\n", g_userSSID.c_str());

      if (wifiConnect()) {
        Serial.println("[PROV] WiFi connected! Provisioning complete.");
        wifiDisconnect();
        provisioned = true;
      } else {
        Serial.println("[PROV] WiFi failed -- sending WIFI_FAIL, waiting...");
        bleSignalEvent("WIFI_FAIL");
      }
    }

    // Log BLE status every ~10s
    if ((millis() - startTime) % 10000 < 1200) {
      Serial.printf("[PROV] BLE %s, waiting... (%lus)\n",
                    bleIsConnected() ? "CONNECTED" : "advertising",
                    (millis() - startTime) / 1000);
    }
  }

  ledOn();
  bleSignalEvent("PROVISIONED");
  delay(1000);
  ledOff();
  Serial.println("[PROV] Rebooting into normal mode...");
  Serial.flush();
  ESP.restart();
}

// --- Arduino Entry Points ---

void setup() {
  Serial.begin(115200);
  delay(100);

  wakeCount++;
  Serial.printf("\n[BOOT] Mittens Pendant wake #%d\n", wakeCount);

  // LED setup
  pinMode(LED_PIN, OUTPUT);
  ledOff();

  // Init I2C for IMU
  Wire.begin(IMU_SDA_PIN, IMU_SCL_PIN);
  delay(50);

  // Check if IMU is present
  if (!lsmInit()) {
    Serial.println("[BOOT] IMU not found -- entering test mode");
    bleInit();
    bleTransferAttachCallback();
    return;
  }

  // Classify what woke us
  WakeReason reason = classifyWake();

  bool transferOk = true;
  switch (reason) {
    case WAKE_DOUBLE_TAP:
      transferOk = handleDoubleTap();
      break;
    case WAKE_SINGLE_TAP:
      transferOk = handleSingleTap();
      break;
    case WAKE_MOTION:
      transferOk = handleMotion();
      break;
    default:
      Serial.println("[FLOW] Unknown wake, ignoring");
      break;
  }

  // If BLE transfer failed (phone not nearby or not connected),
  // that's OK -- just go back to sleep. The photo is lost but
  // we don't block on it. The pendant is ephemeral by design.
  if (!transferOk) {
    Serial.println("[FLOW] BLE transfer failed (phone not nearby?) -- sleeping");
  }

  enterDeepSleep();
}

void loop() {
  // Only runs in test mode (when IMU not found)
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'd' || c == 'D') {
      Serial.println("[TEST] Simulating double-tap...");
      handleDoubleTap();
    } else if (c == 'm' || c == 'M') {
      Serial.println("[TEST] Simulating motion...");
      handleMotion();
    }
  }
  delay(10);
}
