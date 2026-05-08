/**
 * Mittens Pendant -- Main Firmware
 *
 * Hardware: XIAO ESP32S3 Sense + MPU-6050 IMU (I2C @ 0x68)
 *
 * Deep sleep with IMU wake-on-motion. On wake, samples accelerometer
 * to classify the event via software tap detection:
 *   DOUBLE_TAP -> record 5s PDM audio + capture JPEG -> WiFi POST
 *   SINGLE_TAP -> BLE notify only
 *   MOTION     -> capture JPEG -> WiFi POST
 *
 * PROVISIONING:
 *   If no WiFi credentials are stored, or WiFi connection fails,
 *   the pendant stays awake with BLE advertising until the app
 *   connects and sends valid WiFi credentials. LED blinks to
 *   indicate setup mode. Only enters deep sleep after a successful
 *   WiFi connection confirms the credentials work.
 *
 * Two wireless channels:
 *   BLE  -> low-power signaling (tap events, pairing, config)
 *   WiFi -> data transfer (audio + frames via HTTP POST)
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
#include "mpu6050.h"
#include "camera.h"
#include "pdm_mic.h"
#include "wifi_post.h"
#include "ble_signal.h"

// --- Persistent State (survives deep sleep) ---
RTC_DATA_ATTR int wakeCount = 0;

// --- LED ---
void ledOn()  { digitalWrite(LED_PIN, LOW);  }  // Active low
void ledOff() { digitalWrite(LED_PIN, HIGH); }

// --- Provisioning Mode ---

/**
 * Enter provisioning mode: BLE advertising, LED blinks, waiting for app.
 * Stays here until WiFi credentials arrive via BLE AND WiFi connects.
 * Called when no WiFi is configured or when WiFi connection fails.
 */
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
        // We DO NOT clear stored creds here. This allows the pendant to
        // continuously retry the connection. If the user just needs to
        // toggle their iPhone Hotspot 'Allow Others to Join', it will
        // succeed on the next loop! If the password was wrong, the app
        // will overwrite the credentials via BLE.
      }
    }

    // Log BLE status every ~10s
    if ((millis() - startTime) % 10000 < 1200) {
      Serial.printf("[PROV] BLE %s, waiting... (%lus)\n",
                    bleIsConnected() ? "CONNECTED" : "advertising",
                    (millis() - startTime) / 1000);
    }
  }

  // Success -- solid LED 1s + signal, then reboot cleanly.
  // BLE + WiFi coexistence fragments the heap on ESP32S3, so a
  // clean reboot avoids heap corruption. NVS has the credentials
  // now, so the reboot will skip provisioning and go straight to
  // normal wake/sleep operation.
  ledOn();
  bleSignalEvent("PROVISIONED");
  delay(1000);
  ledOff();
  Serial.println("[PROV] Rebooting into normal mode...");
  Serial.flush();
  ESP.restart();
}

// --- Event Handlers ---

/** Returns true if WiFi POST succeeded. */
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

  // 3. BLE signal (fast notification)
  bleInit();
  bleSignalEvent("DOUBLE_TAP");
  delay(200);

  // 4. WiFi POST data
  bool wifiOk = false;
  wifiLoadConfig();
  if (wifiConnect()) {
    wifiPostEvent(
      "DOUBLE_TAP", wakeCount,
      audioLen > 0 ? micGetBuffer() : nullptr, audioLen,
      fb ? fb->buf : nullptr, fb ? fb->len : 0
    );
    wifiDisconnect();
    wifiOk = true;
  }

  // 5. Cleanup memory to prevent heap corruption on next wake
  if (fb) esp_camera_fb_return(fb);
  micFreeBuffer();
  bleDeinit();
  ledOff();

  // 6. Deep sleep
  Serial.println("[SLEEP] Entering deep sleep...");
  delay(100);
  esp_deep_sleep_start();
  return wifiOk;
}

bool handleSingleTap() {
  Serial.println("[FLOW] === SINGLE TAP ===");

  bleInit();
  bleSignalEvent("SINGLE_TAP");
  delay(500);
  bleDeinit();

  return true;  // No WiFi needed
}

bool handleMotion() {
  Serial.println("[FLOW] === MOTION ===");

  // Capture frame only (no audio for passive observation)
  bool camOk = cameraInit();
  camera_fb_t *fb = nullptr;
  if (camOk) {
    fb = captureFrame();
  }

  // WiFi POST frame
  bool wifiOk = false;
  if (fb) {
    wifiLoadConfig();
    if (wifiConnect()) {
      wifiPostEvent(
        "MOTION", wakeCount,
        nullptr, 0,
        fb->buf, fb->len
      );
      wifiDisconnect();
      wifiOk = true;
    }
    esp_camera_fb_return(fb);
  }

  return wifiOk;
}

// --- Deep Sleep ---

void enterDeepSleep() {
  Serial.println("[SLEEP] Entering deep sleep...");
  Serial.flush();

  // Re-arm IMU motion interrupt
  mpuConfigureMotionWake();

  // Configure GPIO3 (INT) as wake source (active high)
  pinMode(IMU_INT_PIN, INPUT);
  esp_sleep_enable_ext0_wakeup(IMU_INT_PIN, 1);
  rtc_gpio_pullup_dis(IMU_INT_PIN);
  rtc_gpio_pulldown_en(IMU_INT_PIN);

  esp_deep_sleep_start();
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
  if (!mpuInit()) {
    Serial.println("[BOOT] IMU not found -- entering test mode");
    bleInit();
    return;
  }

  // On first boot, check if WiFi is provisioned at all
  wifiLoadConfig();
  if (g_userSSID.length() == 0 && strlen(WIFI_DEV_SSID_1) == 0) {
    enterProvisioningMode();
  }

  // Classify what woke us
  WakeReason reason = classifyWake();

  bool wifiOk = true;
  switch (reason) {
    case WAKE_DOUBLE_TAP:
      wifiOk = handleDoubleTap();
      break;
    case WAKE_SINGLE_TAP:
      wifiOk = handleSingleTap();
      break;
    case WAKE_MOTION:
      wifiOk = handleMotion();
      break;
    default:
      Serial.println("[FLOW] Unknown wake, ignoring");
      break;
  }

  // If WiFi failed, don't sleep -- enter provisioning mode
  // so user can fix the network from the app
  if (!wifiOk) {
    Serial.println("[FLOW] WiFi POST failed -- entering provisioning mode");
    enterProvisioningMode();
  }

  // Only sleep if everything worked
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
