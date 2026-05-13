#include "driver/rtc_io.h"
#include "esp_sleep.h"
#include <Wire.h>

const uint8_t LSM_ADDR = 0x6B;
const gpio_num_t INT1_PIN = GPIO_NUM_3; // D2 on XIAO ESP32-S3 — WAKE motion
const gpio_num_t INT2_PIN = GPIO_NUM_4; // D3 on XIAO ESP32-S3 — TAP

volatile bool wakeFlag = false;
volatile bool tapFlag = false;

void IRAM_ATTR wakeISR() { wakeFlag = true; }

void IRAM_ATTR tapISR() { tapFlag = true; }

void writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(LSM_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(LSM_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(LSM_ADDR, (uint8_t)1);
  return Wire.read();
}

void configureLSM() {
  // CTRL1_XL (0x10): accel ODR=416Hz, FS=2g
  writeReg(0x10, 0x60);

  // TAP_CFG (0x58): enable interrupts + X/Y/Z tap, latched
  writeReg(0x58, 0x8E);

  // TAP_THS_6D (0x59): tap threshold (sensitive)
  writeReg(0x59, 0x06);

  // INT_DUR2 (0x5A): DUR=4 (~330ms), QUIET=2, SHOCK=2
  writeReg(0x5A, 0x42);

  // WAKE_UP_THS (0x5B): SINGLE_BUTTON_PRESS=1, wake threshold=2
  writeReg(0x5B, 0x82);

  // WAKE_UP_DUR (0x5C): wake needs ~7ms sustained motion
  writeReg(0x5C, 0x02);

  // MD1_CFG (0x5E): route ONLY WAKE_UP to INT1
  writeReg(0x5E, 0x20); // INT1_WU

  // MD2_CFG (0x5F): route ONLY BUTTON_PRESS to INT2
  writeReg(0x5F, 0x08); // INT2_BUTTON_PRESS
}

void printWakeReason() {
  esp_sleep_wakeup_cause_t reason = esp_sleep_get_wakeup_cause();
  switch (reason) {
  case ESP_SLEEP_WAKEUP_EXT0:
    Serial.println(">>> Woke from deep sleep via LSM6DS3 INT1!");
    break;
  case ESP_SLEEP_WAKEUP_UNDEFINED:
    Serial.println(">>> Fresh boot (not from deep sleep)");
    break;
  default:
    Serial.printf(">>> Wake reason: %d\n", reason);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== XIAO ESP32-S3 + LSM6DS3 (dual interrupt) ===");
  printWakeReason();

  Wire.begin();

  uint8_t whoami = readReg(0x0F);
  Serial.printf("WHO_AM_I = 0x%02X\n", whoami);

  if (whoami != 0x69 && whoami != 0x6A) {
    Serial.println("Sensor not responding correctly. Halting.");
    while (1)
      delay(1000);
  }

  configureLSM();

  readReg(0x1C);
  readReg(0x1B);

  pinMode(INT1_PIN, INPUT);
  pinMode(INT2_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(INT1_PIN), wakeISR, RISING);
  attachInterrupt(digitalPinToInterrupt(INT2_PIN), tapISR, RISING);

  Serial.println("Ready.");
  Serial.println("- Move/shake = wake motion (activity tracking)");
  Serial.println("- Two FAST sharp taps = Button Press (Mittens audio)");
  Serial.println("Send 's' to enter deep sleep.");
}

void loop() {
  static unsigned long lastTapTime = 0;
  static unsigned long lastWakeTime = 0;
  unsigned long now = millis();

  // Handle tap on INT2 — independent path, no interference from wake
  if (tapFlag) {
    tapFlag = false;
    uint8_t tapSrc = readReg(0x1C);
    if (tapSrc & 0x10) {
      if (now - lastTapTime > 500) {
        Serial.println("Button Press — trigger Mittens audio");
        lastTapTime = now;
      }
    }
  }

  // Handle wake motion on INT1 — independent path
  if (wakeFlag) {
    wakeFlag = false;
    uint8_t wakeSrc = readReg(0x1B);
    if (wakeSrc & 0x08) {
      if (now - lastWakeTime > 500) {
        Serial.printf("Wake motion (axes:%s%s%s) — log activity\n",
                      wakeSrc & 0x04 ? " X" : "", wakeSrc & 0x02 ? " Y" : "",
                      wakeSrc & 0x01 ? " Z" : "");
        lastWakeTime = now;
      }
    }
  }

  if (Serial.available() && Serial.read() == 's') {
    Serial.println("\nGoing to deep sleep. Move device to wake.");
    Serial.flush();
    readReg(0x1C);
    readReg(0x1B);
    // Deep sleep wakes only from INT1 (wake motion)
    esp_sleep_enable_ext0_wakeup(INT1_PIN, 1);
    rtc_gpio_pullup_dis(INT1_PIN);
    rtc_gpio_pulldown_en(INT1_PIN);
    esp_deep_sleep_start();
  }
}