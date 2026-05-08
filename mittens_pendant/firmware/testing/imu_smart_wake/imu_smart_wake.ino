/*
 * Mittens Pendant — MPU-6050 Smart Wake + Camera
 *
 * Hardware:
 *   - Seeed XIAO ESP32S3 Sense
 *   - MPU-6050 IMU on I2C (default address 0x68)
 *   - INT → XIAO D2 (GPIO3)
 *
 * Behavior:
 *   - Boot → init camera + IMU → capture frame → arm motion wake → deep sleep
 *   - Motion above threshold → wake → repeat
 *
 * Arduino IDE settings:
 *   - Board: XIAO_ESP32S3
 *   - PSRAM: OPI PSRAM
 *   - Partition Scheme: Maximum APP (7.9MB APP No OTA/No FS)
 */

#include "driver/rtc_io.h"
#include "esp_camera.h"
#include "esp_sleep.h"
#include "mbedtls/base64.h"
#include <Wire.h>

#define INT_PIN GPIO_NUM_3 // XIAO D2 — wake interrupt
#define MPU_ADDR 0x68      // MPU-6050 default I2C address

// XIAO ESP32S3 Sense camera pinout
#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 10
#define SIOD_GPIO_NUM 40
#define SIOC_GPIO_NUM 39
#define Y9_GPIO_NUM 48
#define Y8_GPIO_NUM 11
#define Y7_GPIO_NUM 12
#define Y6_GPIO_NUM 14
#define Y5_GPIO_NUM 16
#define Y4_GPIO_NUM 18
#define Y3_GPIO_NUM 17
#define Y2_GPIO_NUM 15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM 47
#define PCLK_GPIO_NUM 13

RTC_DATA_ATTR int wakeCount = 0; // survives deep sleep

// ============ MPU-6050 helpers ============

void writeMPU(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t readMPU(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)1);
  return Wire.read();
}

bool initMPU() {
  // Wake from sleep mode (PWR_MGMT_1, default has SLEEP=1)
  writeMPU(0x6B, 0x00);
  delay(50);

  // Verify it's actually there — WHO_AM_I should be 0x68
  uint8_t whoami = readMPU(0x75);
  if (whoami != 0x68 && whoami != 0x70 && whoami != 0x98) {
    Serial.printf("❌ MPU not found (WHO_AM_I = 0x%02X)\n", whoami);
    return false;
  }

  Serial.printf("✅ MPU online (WHO_AM_I = 0x%02X)\n", whoami);
  return true;
}

void configureMotionWake() {
  // Reset signal paths to ensure clean state
  writeMPU(0x68, 0x07); // SIGNAL_PATH_RESET — reset accel/gyro/temp
  delay(100);

  // Accel config: ±2g full scale (most sensitive for motion detection)
  writeMPU(0x1C, 0x00);

  // Set high-pass filter to "Reset" mode (required for motion detection)
  // ACCEL_CONFIG (0x1C) bit-masked into ACCEL_HPF
  // Actually we use the high-pass filter config in CONFIG (0x1A)
  writeMPU(0x1A, 0x00); // DLPF off for fastest response

  // Motion threshold — register 0x1F
  // Each LSB = 2mg → 0x14 (20) = 40mg threshold
  // Lower = more sensitive (try 0x05 to 0x40)
  writeMPU(0x1F, 0x14);

  // Motion duration — register 0x20
  // Each LSB = 1ms. 1 = trigger after 1ms above threshold
  writeMPU(0x20, 0x01);

  // INT_PIN_CFG (0x37): active HIGH, push-pull, latch until cleared
  writeMPU(0x37, 0x20); // LATCH_INT_EN = 1

  // INT_ENABLE (0x38): enable motion interrupt only (bit 6)
  writeMPU(0x38, 0x40);

  // Power management: cycle mode for low power
  // PWR_MGMT_1 (0x6B): bit 5 CYCLE = 1, bit 6 SLEEP = 0
  // PWR_MGMT_2 (0x6C): wakeup freq + put gyro to standby
  writeMPU(0x6B, 0x20); // CYCLE mode, accel-only wake
  writeMPU(0x6C, 0x47); // wakeup at 5Hz, gyro standby (saves power)

  // Clear any pending interrupt by reading INT_STATUS (0x3A)
  readMPU(0x3A);

  Serial.println("✅ Motion wake armed");
}

// ============ Camera helpers ============

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("❌ Camera init failed");
    return false;
  }
  Serial.println("✅ Camera online");
  return true;
}

void captureAndReport() {
  // Throw away first frame (auto-exposure warmup)
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb)
    esp_camera_fb_return(fb);
  delay(100);

  // Real capture
  fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Capture failed");
    return;
  }

  Serial.printf("📷 Frame #%d: %d bytes, %dx%d\n", wakeCount, fb->len,
                fb->width, fb->height);

  // TODO: this is where BLE transmission goes
  // For now, just print size to confirm capture worked

  esp_camera_fb_return(fb);
}

// ============ Main ============

void setup() {
  Serial.begin(115200);
  delay(1000);

  // 1. Check why we woke up
  esp_sleep_wakeup_cause_t reason = esp_sleep_get_wakeup_cause();
  if (reason == ESP_SLEEP_WAKEUP_EXT0) {
    wakeCount++;
    Serial.printf("\n🐾 MITTENS WOKE — motion detected (#%d)\n", wakeCount);
  } else {
    Serial.println("\n🌀 First boot");
    wakeCount = 0;
  }

  // 2. Init I2C and MPU
  Wire.begin(5, 6); // SDA=GPIO5, SCL=GPIO6
  delay(50);
  if (!initMPU())
    while (1)
      delay(100);

  // 3. Init camera + capture frame
  if (!initCamera())
    while (1)
      delay(100);
  captureAndReport();

  // 4. Re-arm motion wake
  configureMotionWake();

  // 5. Configure ESP32 wake pin
  pinMode(INT_PIN, INPUT);
  esp_sleep_enable_ext0_wakeup(INT_PIN, 1); // wake when INT goes HIGH
  rtc_gpio_pullup_dis(INT_PIN);
  rtc_gpio_pulldown_en(INT_PIN);

  Serial.println("😴 Going to deep sleep. Move pendant to wake.\n");
  Serial.flush();
  delay(100);

  esp_deep_sleep_start();
}

void loop() {} // never runs — deep sleep resets chip on each wake