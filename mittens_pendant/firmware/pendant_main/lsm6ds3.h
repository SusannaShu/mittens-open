#pragma once
/**
 * LSM6DS3 Driver -- Hardware motion wake + tap detection.
 *
 * The LSM6DS3 features robust built-in hardware tap and double-tap detection.
 * We route Single Tap, Double Tap, and Wake-up (motion) events to the INT1 pin.
 * When the ESP32 wakes up from deep sleep, it reads the TAP_SRC and WAKE_UP_SRC
 * registers to instantly know the wake reason, without needing to sample data.
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
#define LSM6DS3_MD1_CFG        0x5E

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
  if (whoami != 0x69) {
    Serial.printf("[IMU] LSM6DS3 not found (WHO_AM_I=0x%02X)\n", whoami);
    return false;
  }
  Serial.printf("[IMU] LSM6DS3 online (WHO_AM_I=0x%02X)\n", whoami);
  return true;
}

// ─── Wake Classification ───
WakeReason classifyWake() {
  uint8_t tapSrc = lsmRead(LSM6DS3_TAP_SRC);
  uint8_t wuSrc = lsmRead(LSM6DS3_WAKE_UP_SRC);
  
  Serial.printf("[IMU] TAP_SRC=0x%02X, WAKE_UP_SRC=0x%02X\n", tapSrc, wuSrc);
  
  // Bit 4 in TAP_SRC is DOUBLE_TAP
  if (tapSrc & 0x10) return WAKE_DOUBLE_TAP;
  
  // Bit 5 in TAP_SRC is SINGLE_TAP
  if (tapSrc & 0x20) return WAKE_SINGLE_TAP;
  
  // Bit 5 in WAKE_UP_SRC is WU_IA (Wakeup event)
  if (wuSrc & 0x20) return WAKE_MOTION;
  
  return WAKE_UNKNOWN;
}

// ─── Motion Wake Configuration ───
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
  
  // Enable Tap on X, Y, Z, and enable Latched Interrupts (LIR=1)
  // Latching ensures the ESP32 can read the interrupt source after waking up from deep sleep.
  lsmWrite(LSM6DS3_TAP_CFG, 0x0F);
  
  // Set Tap threshold (0x0C = 12 * FS/32 = 12 * 2g/32 = 0.75g threshold)
  lsmWrite(LSM6DS3_TAP_THS_6D, 0x0C);
  
  // Set Tap durations (Quiet, Shock, Duration)
  // Max duration (0x7F) is good for general use
  lsmWrite(LSM6DS3_INT_DUR2, 0x7F);
  
  // Enable single & double tap, set Wake-up threshold
  // Bit 7=1 (Single/Double tap enable)
  // Bits 5:0 = Wake-up threshold (e.g., 0x02 = 2 * FS/64 = 2 * 2g/64 = 0.0625g)
  lsmWrite(LSM6DS3_WAKE_UP_THS, 0x82);
  
  // Route INT1: Single tap (bit 6), Wake-up (bit 5), Double tap (bit 3)
  // 0x40 | 0x20 | 0x08 = 0x68
  lsmWrite(LSM6DS3_MD1_CFG, 0x68); 
  
  // Wait to settle
  delay(100);
  
  // Clear any existing interrupts by reading the source registers
  lsmRead(LSM6DS3_TAP_SRC);
  lsmRead(LSM6DS3_WAKE_UP_SRC);
  
  Serial.println("[IMU] Hardware Tap & Motion wake armed on INT1");
}
