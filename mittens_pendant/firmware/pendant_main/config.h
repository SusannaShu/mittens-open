#pragma once
/**
 * Mittens Pendant -- Configuration
 *
 * WiFi credentials, pin assignments, BLE UUIDs, and tuning constants.
 * This file contains secrets -- add to .gitignore for production builds.
 */

// --- WiFi Credentials ---
// Production: provisioned from the Mittens app via BLE -> stored in NVS.
// Development: set these for bench testing before app pairing is done.
// NVS-stored credentials (from app) always take priority over these.

#define WIFI_DEV_SSID_1     ""    // Set for dev bench testing
#define WIFI_DEV_PASSWORD_1 ""

#define WIFI_DEV_SSID_2     ""    // Second dev network (e.g. phone hotspot)
#define WIFI_DEV_PASSWORD_2 ""

// iOS personal hotspot default gateway (used when phone IP not provisioned)
#define PHONE_IP_DEFAULT  "172.20.10.1"

// ─── Pin Definitions ───

// XIAO ESP32S3 Sense camera pinout (fixed by hardware)
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  10
#define SIOD_GPIO_NUM  40
#define SIOC_GPIO_NUM  39
#define Y9_GPIO_NUM    48
#define Y8_GPIO_NUM    11
#define Y7_GPIO_NUM    12
#define Y6_GPIO_NUM    14
#define Y5_GPIO_NUM    16
#define Y4_GPIO_NUM    18
#define Y3_GPIO_NUM    17
#define Y2_GPIO_NUM    15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM  47
#define PCLK_GPIO_NUM  13

// IMU I2C (external MPU-6050 breakout)
#define IMU_SDA_PIN  GPIO_NUM_5   // D4
#define IMU_SCL_PIN  GPIO_NUM_6   // D5
#define IMU_INT_PIN  GPIO_NUM_3   // D2 -- wake interrupt

// PDM Microphone (built into Sense board)
#define PDM_CLK_PIN  42
#define PDM_DATA_PIN 41

// LED (built-in, active low on XIAO)
#define LED_PIN 21

// ─── IMU ───

#define MPU6050_ADDR  0x68  // MPU-6050 default I2C address (AD0 low)

// ─── Audio ───

#define AUDIO_SAMPLE_RATE    16000  // 16kHz mono
#define AUDIO_DURATION_SEC   5      // seconds to record on double-tap
#define AUDIO_BUFFER_BYTES   (AUDIO_SAMPLE_RATE * 2 * AUDIO_DURATION_SEC)  // 160KB

// ─── Network ───

#define HTTP_PORT         8742
#define HTTP_TIMEOUT_MS   8000
#define WIFI_TIMEOUT_MS   15000  // Hotspots need 8-12s to accept new clients

// ─── BLE ───

#define BLE_DEVICE_NAME     "Mittens Pendant"
#define SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define EVENT_SIGNAL_UUID   "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
#define COMMAND_UUID        "6e400004-b5a3-f393-e0a9-e50e24dcca9e"

// ─── Tap Detection Tuning ───

// Duration to sample accelerometer after wake (ms)
#define TAP_SAMPLE_DURATION_MS  600
// Minimum G magnitude to count as a tap impulse
#define TAP_G_THRESHOLD  1.8f
// Quiet threshold -- below this is "rest"
#define TAP_QUIET_G      1.2f
// Minimum gap between two peaks to count as separate taps (samples at 200Hz)
#define TAP_MIN_GAP_SAMPLES  10  // 50ms at 200Hz
// Fraction of samples above motion threshold to classify as sustained motion
#define MOTION_RATIO_THRESHOLD  0.3f
// G value for sustained motion detection
#define MOTION_G_THRESHOLD  1.15f
