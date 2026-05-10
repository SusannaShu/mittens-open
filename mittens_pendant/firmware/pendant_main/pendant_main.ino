/**
 * Mittens Pendant -- Main Firmware
 *
 * Hardware: XIAO ESP32S3 Sense + LSM6DS3 IMU (I2C @ 0x6B) + LED on D6
 *
 * Deep sleep with IMU wake-on-motion via dual interrupts:
 *   INT1 (D2) = motion wake -- deep sleep wake source
 *   INT2 (D3) = double-tap -- checked after wake to classify event
 *
 *   DOUBLE_TAP -> record 5s PDM audio + capture JPEG -> BLE transfer
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
// BLE is always on -- no init/deinit per event.

// Stop-check for push-to-talk: returns true when button is released
bool buttonReleased() {
  return digitalRead(BUTTON_PIN) == HIGH;  // Button is active-low
}

/**
 * Push-to-talk: hold button to record, release to stop.
 * Captures photo + variable-length audio, then transfers over BLE.
 */
bool handlePushToTalk() {
  Serial.println("[FLOW] === PUSH-TO-TALK ===");
  ledOn();

  // 1. Record audio until button released (or max duration)
  bool micOk = micInit();
  size_t audioLen = 0;
  if (micOk) {
    audioLen = micRecord(buttonReleased);  // Stops when button released
    micDeinit();
  }

  // 2. Capture frame after recording
  bool camOk = cameraInit();
  camera_fb_t *fb = nullptr;
  if (camOk) {
    fb = captureFrame();
  }

  // 3. Signal and transfer
  bleSignalEvent("DOUBLE_TAP");  // Same event type as double-tap for app compatibility
  delay(200);

  bool ok = bleTransferAndWait(
    "DOUBLE_TAP",
    fb ? fb->buf : nullptr, fb ? fb->len : 0,
    audioLen > 0 ? micGetBuffer() : nullptr, audioLen
  );

  // 4. Cleanup
  if (fb) esp_camera_fb_return(fb);
  cameraDeinit();
  micFreeBuffer();
  ledOff();

  return ok;
}

bool handleDoubleTap() {
  // Double-tap now just calls push-to-talk with a fixed 3s recording
  Serial.println("[FLOW] === DOUBLE TAP ===");
  return handlePushToTalk();
}

bool handleSingleTap() {
  Serial.println("[FLOW] === SINGLE TAP ===");

  bleSignalEvent("SINGLE_TAP");
  delay(500);

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
    cameraDeinit();
    ledOff();
    return true;
  }

  // Transfer frame over BLE
  bool ok = bleTransferAndWait(
    "MOTION",
    fb->buf, fb->len,
    nullptr, 0
  );

  // Cleanup
  esp_camera_fb_return(fb);
  cameraDeinit();
  ledOff();

  return ok;
}

// --- Deep Sleep (DISABLED for debugging) ---
// Re-enable later once BLE connection is confirmed working.

// void enterDeepSleep() { ... }

// --- Provisioning Mode (WiFi -- only for initial setup) ---
// Kept for backwards compatibility. Once paired via BLE,
// the pendant no longer needs WiFi for normal data transfer.

void enterProvisioningMode() {
  Serial.println("[PROV] Entering provisioning mode -- waiting for valid WiFi");

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

// ─── Volatile flags for ISR-safe interrupt handling ───
volatile bool g_int1Fired = false;
volatile bool g_int2Fired = false;

void IRAM_ATTR onINT1() { g_int1Fired = true; }
void IRAM_ATTR onINT2() { g_int2Fired = true; }

// --- Arduino Entry Points ---

void setup() {
  Serial.begin(115200);
  // Wait for USB CDC serial to be ready (up to 3s)
  unsigned long serialWait = millis();
  while (!Serial && millis() - serialWait < 3000) delay(10);
  delay(100);

  wakeCount++;
  Serial.printf("\n[BOOT] Mittens Pendant v2 (NO DEEP SLEEP) -- boot #%d\n", wakeCount);

  // LED setup
  pinMode(LED_PIN, OUTPUT);
  ledOff();

  // Push-to-talk button (active low, internal pullup)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Init I2C for IMU
  Wire.begin(IMU_SDA_PIN, IMU_SCL_PIN);
  delay(50);

  // Start BLE immediately and keep it on
  Serial.println("[BOOT] Starting BLE...");
  bleInit();
  bleTransferAttachCallback();
  Serial.println("[BOOT] BLE advertising -- phone can connect now");

  // Check if IMU is present
  bool imuOk = lsmInit();
  if (!imuOk) {
    Serial.println("[BOOT] IMU not found -- test mode (type 'd' or 'm' in serial)");
    Serial.println("[BOOT] BLE is ON and advertising. Try connecting from phone.");
    return;
  }

  // Configure IMU for tap + motion interrupts
  lsmConfigureWake();

  // Set up hardware interrupts (polling in loop instead of deep sleep)
  pinMode(IMU_INT1_PIN, INPUT);
  pinMode(IMU_INT2_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(IMU_INT1_PIN), onINT1, RISING);
  attachInterrupt(digitalPinToInterrupt(IMU_INT2_PIN), onINT2, RISING);

  // Clear any stale interrupts
  lsmRead(LSM6DS3_TAP_SRC);
  lsmRead(LSM6DS3_WAKE_UP_SRC);
  g_int1Fired = false;
  g_int2Fired = false;

  Serial.println("[BOOT] Ready! BLE advertising, IMU armed.");
  Serial.println("[BOOT] BUTTON (D1): hold to talk, release to send");
  Serial.println("[BOOT] Shake for motion, double-tap for audio+photo.");
  Serial.printf("[BOOT] INT1(D2)=%d  INT2(D3)=%d  BTN(D1)=%d\n",
                digitalRead(IMU_INT1_PIN), digitalRead(IMU_INT2_PIN),
                digitalRead(BUTTON_PIN));
  Serial.printf("[BOOT] BLE connected: %s\n", bleIsConnected() ? "YES" : "no (waiting...)");
}

// Cooldown to avoid rapid re-triggers
static unsigned long lastEventTime = 0;
static const unsigned long EVENT_COOLDOWN_MS = 3000;  // 3s between events

void loop() {
  // --- Push-to-talk button (highest priority) ---
  if (digitalRead(BUTTON_PIN) == LOW) {
    // Debounce: wait 50ms and check again
    delay(50);
    if (digitalRead(BUTTON_PIN) == LOW) {
      Serial.println("[BTN] Button pressed -- starting push-to-talk");
      handlePushToTalk();
      lastEventTime = millis();
      // Wait for button release before continuing
      while (digitalRead(BUTTON_PIN) == LOW) delay(10);
      return;
    }
  }

  // --- Serial test commands (always available) ---
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'd' || c == 'D') {
      Serial.println("[TEST] Simulating double-tap...");
      handleDoubleTap();
    } else if (c == 'm' || c == 'M') {
      Serial.println("[TEST] Simulating motion...");
      handleMotion();
    } else if (c == 's' || c == 'S') {
      // Status dump
      Serial.printf("[STATUS] BLE: %s | INT1=%d INT2=%d BTN=%d | uptime=%lus\n",
                    bleIsConnected() ? "CONNECTED" : "advertising",
                    digitalRead(IMU_INT1_PIN), digitalRead(IMU_INT2_PIN),
                    digitalRead(BUTTON_PIN),
                    millis() / 1000);
    }
  }

  // --- IMU interrupt handling (motion only -- taps handled by button) ---
  if (g_int1Fired || g_int2Fired) {
    // Cooldown check
    if (millis() - lastEventTime < EVENT_COOLDOWN_MS) {
      g_int1Fired = false;
      g_int2Fired = false;
      lsmRead(LSM6DS3_TAP_SRC);
      lsmRead(LSM6DS3_WAKE_UP_SRC);
      delay(10);
      return;
    }

    g_int1Fired = false;
    g_int2Fired = false;

    // Clear source registers (clears latched interrupts)
    uint8_t tapSrc = lsmRead(LSM6DS3_TAP_SRC);
    uint8_t wuSrc = lsmRead(LSM6DS3_WAKE_UP_SRC);

    Serial.printf("[IMU] Motion! TAP_SRC=0x%02X WAKE_UP_SRC=0x%02X\n", tapSrc, wuSrc);

    handleMotion();
    lastEventTime = millis();

    // Clear any interrupts that fired during handling
    lsmRead(LSM6DS3_TAP_SRC);
    lsmRead(LSM6DS3_WAKE_UP_SRC);
    g_int1Fired = false;
    g_int2Fired = false;
  }

  delay(10);
}

