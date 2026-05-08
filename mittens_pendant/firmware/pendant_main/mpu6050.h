#pragma once
/**
 * MPU-6050 Driver -- motion wake + software tap detection.
 *
 * The MPU-6050 does NOT have hardware tap detection (that's LSM6DS3).
 * Instead, we use the motion detection interrupt to wake from deep sleep,
 * then sample accelerometer data rapidly to classify the wake cause:
 *   - Sharp impulse(s) --> tap or double-tap
 *   - Sustained acceleration --> motion (walking, moving)
 */

#include <Wire.h>
#include <math.h>
#include "config.h"

// ─── MPU-6050 Register Map ───

#define REG_PWR_MGMT_1     0x6B
#define REG_PWR_MGMT_2     0x6C
#define REG_WHO_AM_I       0x75
#define REG_ACCEL_CONFIG   0x1C
#define REG_CONFIG         0x1A
#define REG_MOT_THR        0x1F  // Motion detection threshold (2mg/LSB)
#define REG_MOT_DUR        0x20  // Motion detection duration (1ms/LSB)
#define REG_INT_PIN_CFG    0x37
#define REG_INT_ENABLE     0x38
#define REG_INT_STATUS     0x3A
#define REG_SIGNAL_RESET   0x68
#define REG_ACCEL_XOUT_H   0x3B

// ─── Wake Reason ───

enum WakeReason {
  WAKE_UNKNOWN,
  WAKE_MOTION,
  WAKE_SINGLE_TAP,
  WAKE_DOUBLE_TAP,
};

// ─── I2C Helpers ───

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t mpuRead(uint8_t reg) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)1);
  return Wire.read();
}

void mpuReadAccel(int16_t *ax, int16_t *ay, int16_t *az) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)6);
  *ax = (Wire.read() << 8) | Wire.read();
  *ay = (Wire.read() << 8) | Wire.read();
  *az = (Wire.read() << 8) | Wire.read();
}

// ─── Init ───

bool mpuInit() {
  // Wake from sleep mode
  mpuWrite(REG_PWR_MGMT_1, 0x00);
  delay(50);

  // Verify device presence
  uint8_t whoami = mpuRead(REG_WHO_AM_I);
  if (whoami != 0x68 && whoami != 0x70 && whoami != 0x98) {
    Serial.printf("[IMU] Not found (WHO_AM_I=0x%02X)\n", whoami);
    return false;
  }

  Serial.printf("[IMU] MPU-6050 online (WHO_AM_I=0x%02X)\n", whoami);
  return true;
}

// ─── Software Tap Detection ───
//
// After wake, sample accelerometer at 200Hz for TAP_SAMPLE_DURATION_MS.
// Analyze the magnitude pattern to classify:
//   - 2+ sharp peaks with quiet gaps --> DOUBLE_TAP
//   - 1 sharp peak then quiet --> SINGLE_TAP
//   - Sustained motion above threshold --> MOTION

WakeReason classifyWake() {
  const int sampleRate = 200;  // Hz
  const int totalSamples = (TAP_SAMPLE_DURATION_MS * sampleRate) / 1000;
  const unsigned long intervalUs = 1000000 / sampleRate;  // 5000us = 5ms

  // Allocate on stack (600 samples * 4 bytes = 2.4KB, fine for ESP32)
  float magnitudes[totalSamples];

  // Sample accelerometer rapidly
  for (int i = 0; i < totalSamples; i++) {
    int16_t ax, ay, az;
    mpuReadAccel(&ax, &ay, &az);
    // Convert to g (at +/-2g: 16384 LSB/g)
    float gx = ax / 16384.0f;
    float gy = ay / 16384.0f;
    float gz = az / 16384.0f;
    magnitudes[i] = sqrtf(gx * gx + gy * gy + gz * gz);
    delayMicroseconds(intervalUs);
  }

  // Count distinct peaks above tap threshold
  int peakCount = 0;
  bool inPeak = false;
  int lastPeakIdx = -100;

  for (int i = 0; i < totalSamples; i++) {
    if (magnitudes[i] > TAP_G_THRESHOLD && !inPeak) {
      inPeak = true;
      if (i - lastPeakIdx > TAP_MIN_GAP_SAMPLES) {
        peakCount++;
        lastPeakIdx = i;
      }
    } else if (magnitudes[i] < TAP_QUIET_G) {
      inPeak = false;
    }
  }

  // Count sustained motion samples
  int motionSamples = 0;
  for (int i = 0; i < totalSamples; i++) {
    if (magnitudes[i] > MOTION_G_THRESHOLD) {
      motionSamples++;
    }
  }

  float motionRatio = (float)motionSamples / totalSamples;

  Serial.printf("[IMU] peaks=%d motionRatio=%.2f\n", peakCount, motionRatio);

  if (peakCount >= 2) return WAKE_DOUBLE_TAP;
  if (peakCount == 1) return WAKE_SINGLE_TAP;
  if (motionRatio > MOTION_RATIO_THRESHOLD) return WAKE_MOTION;
  return WAKE_MOTION;  // Default to motion
}

// ─── Motion Wake Configuration ───
// Call before entering deep sleep to arm the motion interrupt.

void mpuConfigureMotionWake() {
  // Reset signal paths for clean state
  mpuWrite(REG_SIGNAL_RESET, 0x07);
  delay(100);

  // Accel: +/-2g (most sensitive)
  mpuWrite(REG_ACCEL_CONFIG, 0x00);

  // DLPF off for fastest response
  mpuWrite(REG_CONFIG, 0x00);

  // Motion threshold: 20 * 2mg = 40mg (sensitive enough for taps and motion)
  mpuWrite(REG_MOT_THR, 0x14);

  // Motion duration: 1ms above threshold triggers interrupt
  mpuWrite(REG_MOT_DUR, 0x01);

  // INT pin: active HIGH, push-pull, latched until read
  mpuWrite(REG_INT_PIN_CFG, 0x20);

  // Enable motion interrupt only
  mpuWrite(REG_INT_ENABLE, 0x40);

  // Cycle mode: wake at 5Hz to check motion, gyro standby
  mpuWrite(REG_PWR_MGMT_1, 0x20);
  mpuWrite(REG_PWR_MGMT_2, 0x47);

  // Clear any pending interrupt
  mpuRead(REG_INT_STATUS);

  Serial.println("[IMU] Motion wake armed");
}
