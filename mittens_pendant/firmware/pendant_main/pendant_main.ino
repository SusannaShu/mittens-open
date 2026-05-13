/**
 * Mittens Pendant -- Main Firmware
 *
 * Hardware: XIAO ESP32S3 Sense + LSM6DS3 IMU (I2C @ 0x6B) + LED on D6
 *
 * Deep sleep with IMU wake-on-motion via dual interrupts:
 *   INT1 (D2) = motion wake -- deep sleep wake source
 *   INT2 (D3) = double-tap -- checked after wake to classify event
 *
 *   BUTTON_PRESS -> record 5s PDM audio + capture JPEG -> BLE transfer
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

#include "ble_signal.h"
#include "ble_transfer.h"
#include "camera.h"
#include "config.h"
#include "lsm6ds3.h"
#include "pdm_mic.h"
#include "wifi_post.h"

// --- Persistent State (survives deep sleep) ---
RTC_DATA_ATTR int wakeCount = 0;

// --- LED ---
void ledOn() {
  digitalWrite(LED_PIN, HIGH);
} // Active high (external LED on D6)
void ledOff() { digitalWrite(LED_PIN, LOW); }

// --- BLE Data Transfer Flow ---
// Replaces WiFi POST. Captures data, stages it, and waits for phone to pull.

/**
 * Stage data and wait for phone to pull it over BLE.
 * Returns true if phone successfully pulled the data.
 */
bool bleTransferAndWait(const char *eventType, uint8_t *jpegBuf, size_t jpegLen,
                        uint8_t *audioBuf, size_t audioLen) {
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
  return digitalRead(BUTTON_PIN) == HIGH; // Button is active-low
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
    audioLen = micRecord(buttonReleased); // Stops when button released
    micDeinit();
  }

  // 2. Capture frame after recording
  bool camOk = cameraInit();
  camera_fb_t *fb = nullptr;
  if (camOk) {
    fb = captureFrame();
  }

  // 3. Signal and transfer
  bleSignalEvent(
      "BUTTON_PRESS"); // Same event type as double-tap for app compatibility
  delay(200);

  bool ok = bleTransferAndWait(
      "BUTTON_PRESS", fb ? fb->buf : nullptr, fb ? fb->len : 0,
      audioLen > 0 ? micGetBuffer() : nullptr, audioLen);

  // 4. Cleanup
  if (fb)
    esp_camera_fb_return(fb);
  cameraDeinit();
  micFreeBuffer();
  ledOff();

  return ok;
}

bool handleDoubleTap() {
  // Double-tap now just calls push-to-talk with a fixed 3s recording
  Serial.println("[FLOW] === Button Press ===");
  return handlePushToTalk();
}

bool handleSingleTap() {
  Serial.println("[FLOW] === SINGLE TAP ===");

  bleSignalEvent("SINGLE_TAP");
  delay(500);

  return true; // No data to transfer
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
  bool ok = bleTransferAndWait("MOTION", fb->buf, fb->len, nullptr, 0);

  // Cleanup
  esp_camera_fb_return(fb);
  cameraDeinit();
  ledOff();

  return ok;
}

bool handleFreefall() {
  Serial.println("[FLOW] === FREEFALL DETECTED ===");
  ledOn();

  // Signal the phone immediately -- no photo or audio needed for fall alert
  bleSignalEvent("FREEFALL");

  // Rapid LED blink to indicate freefall detection (3 quick flashes)
  for (int i = 0; i < 3; i++) {
    ledOff();
    delay(100);
    ledOn();
    delay(100);
  }
  ledOff();

  return true;
}

// --- Deep Sleep (idle timeout) ---
// Only sleep when nothing has happened for IDLE_SLEEP_MS.
// Wake on: button press (D1/GPIO2, LOW) or IMU motion (D2/GPIO3, HIGH).

#define IDLE_SLEEP_MS (5UL * 60UL * 1000UL) // 5 minutes

static unsigned long lastActivityTime = 0;
static bool hasEverConnected = false;

void resetIdleTimer() { lastActivityTime = millis(); }

void enterDeepSleep() {
  Serial.println("[SLEEP] 5 min idle -- entering deep sleep");
  Serial.println("[SLEEP] Wake via: button press (D1) or motion (D2)");
  Serial.flush();

  // Turn off BLE cleanly
  bleDeinit();
  ledOff();

  // Re-arm IMU for motion wake
  lsmConfigureWake();

  // Clear any pending interrupts
  int retries = 50;
  while ((digitalRead(IMU_INT1_PIN) == HIGH ||
          digitalRead(IMU_INT2_PIN) == HIGH) &&
         retries > 0) {
    lsmRead(LSM6DS3_TAP_SRC);
    lsmRead(LSM6DS3_WAKE_UP_SRC);
    delay(10);
    retries--;
  }

  // Wake source 1: IMU motion (INT1 / GPIO3 goes HIGH)
  esp_sleep_enable_ext0_wakeup((gpio_num_t)IMU_INT1_PIN, 1);
  rtc_gpio_pullup_dis((gpio_num_t)IMU_INT1_PIN);
  rtc_gpio_pulldown_en((gpio_num_t)IMU_INT1_PIN);

  // Wake source 2: Button press (D1 / GPIO2 goes LOW)
  esp_sleep_enable_ext1_wakeup(BIT64((gpio_num_t)BUTTON_PIN),
                               ESP_EXT1_WAKEUP_ANY_LOW);
  rtc_gpio_pullup_en((gpio_num_t)BUTTON_PIN);
  rtc_gpio_pulldown_dis((gpio_num_t)BUTTON_PIN);

  // Fallback: 30 min timer wake in case both sources fail
  esp_sleep_enable_timer_wakeup(30ULL * 60ULL * 1000000ULL);

  esp_deep_sleep_start();
}

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
    ledOn();
    delay(100);
    ledOff();
    delay(100);
    ledOn();
    delay(100);
    ledOff();
    delay(800);

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

// Capture mode: phone controls via BLE "mode:active" / "mode:passive" commands
// PASSIVE (0) = IMU-driven captures (default, stationary)
// ACTIVE  (1) = phone-driven captures (transit, GPS-synced)
volatile uint8_t g_captureMode = 0;       // CAPTURE_MODE_PASSIVE
volatile bool g_captureRequested = false; // one-shot flag from phone

// --- Arduino Entry Points ---

void setup() {
  Serial.begin(115200);
  // Wait for USB CDC serial to be ready (up to 3s)
  unsigned long serialWait = millis();
  while (!Serial && millis() - serialWait < 3000)
    delay(10);
  delay(100);

  wakeCount++;

  // Check what woke us
  esp_sleep_wakeup_cause_t wakeReason = esp_sleep_get_wakeup_cause();
  const char *wakeStr = "cold boot";
  if (wakeReason == ESP_SLEEP_WAKEUP_EXT0)
    wakeStr = "MOTION (IMU INT1)";
  else if (wakeReason == ESP_SLEEP_WAKEUP_EXT1)
    wakeStr = "BUTTON PRESS";
  else if (wakeReason == ESP_SLEEP_WAKEUP_TIMER)
    wakeStr = "TIMER (30min fallback)";

  Serial.printf("\n[BOOT] Mittens Pendant v3 -- boot #%d (%s)\n", wakeCount,
                wakeStr);

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
    Serial.println(
        "[BOOT] IMU not found -- test mode (type 'd' or 'm' in serial)");
    Serial.println(
        "[BOOT] BLE is ON and advertising. Try connecting from phone.");
    resetIdleTimer();
    return;
  }

  // Configure IMU for tap + motion interrupts
  lsmConfigureWake();

  // Set up hardware interrupts
  pinMode(IMU_INT1_PIN, INPUT);
  pinMode(IMU_INT2_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(IMU_INT1_PIN), onINT1, RISING);
  attachInterrupt(digitalPinToInterrupt(IMU_INT2_PIN), onINT2, RISING);

  // Clear any stale interrupts
  lsmRead(LSM6DS3_TAP_SRC);
  lsmRead(LSM6DS3_WAKE_UP_SRC);
  g_int1Fired = false;
  g_int2Fired = false;

  // If woken by button, handle the press immediately
  if (wakeReason == ESP_SLEEP_WAKEUP_EXT1) {
    Serial.println(
        "[BOOT] Woke from button -- waiting for release to start PTT...");
    // Wait for button release, then handle
    while (digitalRead(BUTTON_PIN) == LOW)
      delay(10);
    // Small delay then check if they press again (they will for PTT)
  }

  resetIdleTimer();
  Serial.println("[BOOT] Ready! BLE advertising, IMU armed.");
  Serial.println("[BOOT] BUTTON (D1): hold to talk | MOTION: auto-capture");
  Serial.printf("[BOOT] Sleep after %d min idle\n", IDLE_SLEEP_MS / 60000);
  Serial.printf("[BOOT] INT1=%d INT2=%d BTN=%d\n", digitalRead(IMU_INT1_PIN),
                digitalRead(IMU_INT2_PIN), digitalRead(BUTTON_PIN));
}

// Cooldown to avoid rapid re-triggers
static unsigned long lastEventTime = 0;
static const unsigned long EVENT_COOLDOWN_MS = 3000; // 3s between events

void loop() {
  // --- Push-to-talk button (highest priority) ---
  if (digitalRead(BUTTON_PIN) == LOW) {
    // Debounce: wait 50ms and check again
    delay(50);
    if (digitalRead(BUTTON_PIN) == LOW) {
      Serial.println("[BTN] Button pressed -- starting push-to-talk");
      handlePushToTalk();
      lastEventTime = millis();
      resetIdleTimer();
      // Wait for button release before continuing
      while (digitalRead(BUTTON_PIN) == LOW)
        delay(10);
      return;
    }
  }

  // --- Serial test commands (always available) ---
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'd' || c == 'D') {
      Serial.println("[TEST] Simulating push-to-talk...");
      handlePushToTalk();
      resetIdleTimer();
    } else if (c == 'm' || c == 'M') {
      Serial.println("[TEST] Simulating motion...");
      handleMotion();
      resetIdleTimer();
    } else if (c == 's' || c == 'S') {
      unsigned long idleSec = (millis() - lastActivityTime) / 1000;
      unsigned long sleepIn = 0;
      if (millis() - lastActivityTime < IDLE_SLEEP_MS) {
        sleepIn = (IDLE_SLEEP_MS - (millis() - lastActivityTime)) / 1000;
      }
      Serial.printf("[STATUS] BLE: %s | BTN=%d | idle=%lus | sleep in %lus\n",
                    bleIsConnected() ? "CONNECTED" : "advertising",
                    digitalRead(BUTTON_PIN), idleSec, sleepIn);
    }
  }

  // --- Phone-requested capture (ACTIVE mode GPS trigger) ---
  if (g_captureRequested) {
    g_captureRequested = false;
    if (millis() - lastEventTime >= EVENT_COOLDOWN_MS) {
      Serial.println("[CMD] Phone-requested capture");
      handleMotion();
      lastEventTime = millis();
      resetIdleTimer();
    }
  }

  // --- IMU interrupt handling (PASSIVE mode only) ---
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

    uint8_t tapSrc = lsmRead(LSM6DS3_TAP_SRC);
    uint8_t wuSrc = lsmRead(LSM6DS3_WAKE_UP_SRC);
    uint8_t ffSrc = lsmRead(LSM6DS3_FREE_FALL);

    Serial.printf("[IMU] Motion! TAP_SRC=0x%02X WAKE_UP_SRC=0x%02X FF=0x%02X\n", tapSrc,
                  wuSrc, ffSrc);

    // Check freefall first (highest priority safety event)
    if (ffSrc & 0x20) {
      handleFreefall();
    } else if (g_captureMode == 1) {
      // In ACTIVE mode, skip IMU-triggered captures (phone drives captures)
      Serial.println(
          "[IMU] ACTIVE mode -- skipping IMU capture (phone controls)");
    } else {
      handleMotion();
    }
    lastEventTime = millis();
    resetIdleTimer();

    lsmRead(LSM6DS3_TAP_SRC);
    lsmRead(LSM6DS3_WAKE_UP_SRC);
    lsmRead(LSM6DS3_FREE_FALL);
    g_int1Fired = false;
    g_int2Fired = false;
  }

  // --- BLE connection keeps us awake ---
  if (bleIsConnected()) {
    if (!hasEverConnected) {
      hasEverConnected = true;
      Serial.println("[BLE] Phone connected! Staying awake.");
    }
    resetIdleTimer(); // Stay awake while phone is connected
  }

  // --- Idle timeout → deep sleep ---
  if (millis() - lastActivityTime > IDLE_SLEEP_MS) {
    Serial.printf("[SLEEP] Idle for %lu min, going to sleep...\n",
                  IDLE_SLEEP_MS / 60000);
    enterDeepSleep();
    // Never reaches here
  }

  delay(10);
}
