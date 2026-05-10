#include <Adafruit_LSM6DS33.h> // ← try this first
#include <Wire.h>

Adafruit_LSM6DS33 lsm6ds;

const int INT1_PIN = 4;
const uint8_t LSM_ADDR = 0x6B; // change to 0x6B if your scanner shows that

volatile bool tapDetected = false;

void IRAM_ATTR tapISR() { tapDetected = true; }

// Helper: write one byte to a register
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

void setup() {
  Serial.begin(115200);
  while (!Serial)
    delay(10);

  if (!lsm6ds.begin_I2C(0x6B)) {
    Serial.println("LSM6DS3 not found. Check wiring/address.");
    while (1)
      delay(10);
  }
  Serial.println("LSM6DS3 found.");

  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_2_G);
  lsm6ds.setAccelDataRate(LSM6DS_RATE_416_HZ);

  // ---- Configure tap detection via registers ----
  // TAP_CFG (0x58): enable X/Y/Z tap + latched interrupt
  writeReg(
      0x58,
      0x8E); // 1000 1110: INTERRUPTS_ENABLE | TAP_X_EN | TAP_Y_EN | TAP_Z_EN

  // TAP_THS_6D (0x59): tap threshold, 5 bits (0-31). Lower = more sensitive.
  writeReg(0x59, 0x09); // threshold ~9 (tweak 0x05–0x1F to taste)

  // INT_DUR2 (0x5A): DUR | QUIET | SHOCK
  // For double tap: durations matter. Try DUR=0x7, QUIET=0x3, SHOCK=0x3
  writeReg(0x5A, 0x7F); // 0111 1111

  // WAKE_UP_THS (0x5B): bit 7 = SINGLE_DOUBLE_TAP, set to 1 for double-tap
  // support
  writeReg(0x5B, 0x80);

  // MD1_CFG (0x5E): route SINGLE_TAP and DOUBLE_TAP to INT1
  writeReg(0x5E, 0x48); // bit 6 = INT1_SINGLE_TAP, bit 3 = INT1_DOUBLE_TAP

  pinMode(INT1_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(INT1_PIN), tapISR, RISING);

  Serial.println("Tap the sensor!");
}

void loop() {
  if (tapDetected) {
    tapDetected = false;
    uint8_t src = readReg(0x1C); // TAP_SRC
    if (src & 0x10)
      Serial.println("Double tap!");
    else if (src & 0x20)
      Serial.println("Single tap!");
    else
      Serial.printf("Tap event, TAP_SRC=0x%02X\n", src);
  }
}