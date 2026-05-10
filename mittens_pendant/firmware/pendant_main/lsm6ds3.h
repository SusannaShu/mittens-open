#pragma once
/**
 * LSM6DS3 Driver -- Dual-interrupt motion wake + tap detection.
 *
 * Uses two interrupt pins for clean event separation:
 *   INT1 (D2 / GPIO3) -- Wake-up motion only. This is the deep sleep wake source.
 *   INT2 (D3 / GPIO4) -- Double-tap only. Checked after wake to distinguish events.
 *
 * After waking from deep sleep (always via INT1), the firmware reads both
 * TAP_SRC and WAKE_UP_SRC to classify: if INT2 is also high, it was a double-tap.
 * Otherwise it was general motion.
 */

#include <Wire.h>
#include "config.h"

// ─── LSM6DS3 Registers ───
#define LSM6DS3_WHO_AM_I       0x0F
#define LSM6DS3_CTRL1_XL       0x10
#define LSM6DS3_CTRL2_G        0x11
#define LSM6DS3_CTRL3_C        0x12
#define LSM6DS3_WAKE_UP_SRC    0x1B
#define LSM6DS3_TAP_SRC        0x1C
#define LSM6DS3_TAP_CFG        0x58
#define LSM6DS3_TAP_THS_6D     0x59
#define LSM6DS3_INT_DUR2       0x5A
#define LSM6DS3_WAKE_UP_THS    0x5B
#define LSM6DS3_WAKE_UP_DUR    0x5C
#define LSM6DS3_MD1_CFG        0x5E
#define LSM6DS3_MD2_CFG        0x5F

// ─── Wake Reason ───
enum WakeReason {
  WAKE_UNKNOWN,
  WAKE_MOTION,
  WAKE_SINGLE_TAP,
  WAKE_DOUBLE_TAP,
};

// ─── I2C Helpers ───
void lsmWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(LSM6DS3_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t lsmRead(uint8_t reg) {
  Wire.beginTransmission(LSM6DS3_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)LSM6DS3_ADDR, (uint8_t)1);
  return Wire.read();
}

// ─── Init ───
bool lsmInit() {
  uint8_t whoami = lsmRead(LSM6DS3_WHO_AM_I);
  // Accept 0x69 (LSM6DS3) or 0x6A (LSM6DS33/LSM6DSO variants)
  if (whoami != 0x69 && whoami != 0x6A) {
    Serial.printf("[IMU] LSM6DS not found (WHO_AM_I=0x%02X)\n", whoami);
    return false;
  }
  Serial.printf("[IMU] LSM6DS online (WHO_AM_I=0x%02X)\n", whoami);
  return true;
}

// ─── Wake Classification ───
// After deep sleep wake (always from INT1 = motion), check INT2 pin
// to see if a double-tap also fired. Both events can happen simultaneously
// since a tap is also motion.
WakeReason classifyWake() {
  uint8_t tapSrc = lsmRead(LSM6DS3_TAP_SRC);
  uint8_t wuSrc = lsmRead(LSM6DS3_WAKE_UP_SRC);

  Serial.printf("[IMU] TAP_SRC=0x%02X, WAKE_UP_SRC=0x%02X, INT2=%d\n",
                tapSrc, wuSrc, digitalRead(IMU_INT2_PIN));

  // Check INT2 (double-tap pin) -- if high, the tap interrupt fired
  if (digitalRead(IMU_INT2_PIN) == HIGH) {
    // Confirm via register: bit 4 in TAP_SRC is DOUBLE_TAP
    if (tapSrc & 0x10) return WAKE_DOUBLE_TAP;
    // Single tap on INT2 (shouldn't happen with our config, but handle it)
    if (tapSrc & 0x20) return WAKE_SINGLE_TAP;
  }

  // INT2 not high -- pure motion wake
  if (wuSrc & 0x08) return WAKE_MOTION;

  return WAKE_UNKNOWN;
}

// ─── Dual-Interrupt Configuration ───
// Matches tested register values from tap_motion_lsm.ino
void lsmConfigureWake() {
  // Soft reset
  lsmWrite(LSM6DS3_CTRL3_C, 0x01);
  delay(20);

  // Enable auto-increment for multi-byte reads
  lsmWrite(LSM6DS3_CTRL3_C, 0x04);

  // Accel: 416 Hz (High-Performance), +/- 2g
  lsmWrite(LSM6DS3_CTRL1_XL, 0x60);

  // Gyro: Power down
  lsmWrite(LSM6DS3_CTRL2_G, 0x00);

  // TAP_CFG (0x58): INTERRUPTS_ENABLE + TAP_X/Y/Z_EN (no LIR -- latching
  // would prevent clearing INT2 independently)
  // 0x8E = INTERRUPTS_ENABLE | TAP_X_EN | TAP_Y_EN | TAP_Z_EN
  lsmWrite(LSM6DS3_TAP_CFG, 0x8E);

  // Tap threshold (0x06 = tested working value, ~0.375g)
  lsmWrite(LSM6DS3_TAP_THS_6D, 0x06);

  // INT_DUR2: DUR=4 (~330ms window), QUIET=2, SHOCK=2
  // 0x42 = tested working value for reliable double-tap
  lsmWrite(LSM6DS3_INT_DUR2, 0x42);

  // Enable single + double tap detection, set wake-up threshold
  // Bit 7 = SINGLE_DOUBLE_TAP enable, bits 5:0 = wake threshold (0x02)
  lsmWrite(LSM6DS3_WAKE_UP_THS, 0x82);

  // WAKE_UP_DUR: wake needs ~7ms sustained motion
  lsmWrite(LSM6DS3_WAKE_UP_DUR, 0x02);

  // Route ONLY wake-up (motion) to INT1 -- this is the deep sleep wake source
  // 0x20 = INT1_WU
  lsmWrite(LSM6DS3_MD1_CFG, 0x20);

  // Route ONLY double-tap to INT2 -- checked after wake to classify event
  // 0x08 = INT2_DOUBLE_TAP
  lsmWrite(LSM6DS3_MD2_CFG, 0x08);

  // Wait to settle
  delay(100);

  // Clear any existing interrupts by reading the source registers
  lsmRead(LSM6DS3_TAP_SRC);
  lsmRead(LSM6DS3_WAKE_UP_SRC);

  Serial.println("[IMU] Dual-INT armed: INT1=motion(D2), INT2=tap(D3)");
}
