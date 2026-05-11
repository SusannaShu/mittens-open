#pragma once
/**
 * BLE GATT Server -- low-power signaling channel.
 *
 * The pendant uses BLE for lightweight event signals (tap type, timestamp)
 * and receiving commands from the phone (WiFi credentials, config).
 * Data transfer (audio, frames) goes over WiFi, not BLE.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "config.h"

// Forward declarations for WiFi config save
extern void wifiSavePhoneIP(const String &ip);
extern void wifiSaveUserNetwork(const String &ssid, const String &password);

BLEServer *g_bleServer = nullptr;
static BLECharacteristic *g_eventChar = nullptr;
static BLECharacteristic *g_commandChar = nullptr;
static bool g_bleConnected = false;

// --- BLE Callbacks ---

// Forward declaration for re-signaling on connect
extern volatile bool g_pullRequested;
extern uint8_t *g_transferData;

class PendantServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    g_bleConnected = true;
    Serial.println("[BLE] Client connected");
    // If we have pending data, re-signal DATA_READY after a short delay
    // so the phone has time to subscribe to notifications
    if (g_transferData != nullptr && !g_pullRequested) {
      delay(500);  // Give phone time to discover services + subscribe
      if (g_eventChar) {
        String json = "{\"type\":\"DATA_READY\",\"ts\":" + String(millis()) + "}";
        g_eventChar->setValue(json.c_str());
        g_eventChar->notify();
        Serial.println("[BLE] Re-signaled DATA_READY for late-connecting client");
      }
    }
  }
  void onDisconnect(BLEServer *server) override {
    g_bleConnected = false;
    Serial.println("[BLE] Client disconnected");
    server->getAdvertising()->start();
  }
};

// Forward declarations for capture mode control
extern volatile uint8_t g_captureMode;    // 0=PASSIVE (default), 1=ACTIVE
extern volatile bool g_captureRequested;   // one-shot capture flag from phone

#define CAPTURE_MODE_PASSIVE 0
#define CAPTURE_MODE_ACTIVE  1

/**
 * Command handler: phone writes commands here.
 * Supported:
 *   "wifi:SSID:PASSWORD:IP"   -- save WiFi credentials
 *   "mode:active"             -- switch to phone-driven capture (transit)
 *   "mode:passive"            -- switch to IMU-driven capture (stationary)
 *   "capture"                 -- take one photo now (used in ACTIVE mode)
 */
class PendantCommandCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue().c_str();
    Serial.printf("[BLE] Command: %s\n", value.c_str());

    // Parse WiFi credentials: "wifi:SSID:PASSWORD:IP"
    if (value.startsWith("wifi:")) {
      int first = value.indexOf(':', 5);
      int second = value.indexOf(':', first + 1);
      if (first > 5 && second > first) {
        String ssid = value.substring(5, first);
        String password = value.substring(first + 1, second);
        String ip = value.substring(second + 1);
        wifiSaveUserNetwork(ssid, password);
        wifiSavePhoneIP(ip);
        Serial.printf("[BLE] WiFi saved: %s -> %s\n", ssid.c_str(), ip.c_str());
      }
    }
    // Capture mode: "mode:active" or "mode:passive"
    else if (value.startsWith("mode:")) {
      String mode = value.substring(5);
      if (mode == "active") {
        g_captureMode = CAPTURE_MODE_ACTIVE;
        Serial.println("[BLE] Capture mode -> ACTIVE (phone-driven)");
      } else if (mode == "passive") {
        g_captureMode = CAPTURE_MODE_PASSIVE;
        Serial.println("[BLE] Capture mode -> PASSIVE (IMU-driven)");
      }
    }
    // One-shot capture: "capture"
    else if (value == "capture") {
      g_captureRequested = true;
      Serial.println("[BLE] Capture requested by phone");
    }
  }
};

// ─── Init / Deinit ───

// Characteristic pointers declared in ble_transfer.h
extern BLECharacteristic *g_dataInfoChar;
extern BLECharacteristic *g_dataStreamChar;
extern BLECharacteristic *g_dataAckChar;

void bleInit() {
  if (g_bleServer) return;

  BLEDevice::init(BLE_DEVICE_NAME);
  g_bleServer = BLEDevice::createServer();
  g_bleServer->setCallbacks(new PendantServerCallbacks());

  // Need more handles for 7 characteristics (default 15 is too few)
  BLEService *service = g_bleServer->createService(
    BLEUUID(SERVICE_UUID), 30  // 30 handles
  );

  // Event signal: pendant -> phone (notify)
  g_eventChar = service->createCharacteristic(
    EVENT_SIGNAL_UUID,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  g_eventChar->addDescriptor(new BLE2902());

  // Command: phone -> pendant (write)
  g_commandChar = service->createCharacteristic(
    COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  g_commandChar->setCallbacks(new PendantCommandCallback());

  // DATA_INFO: phone reads to get data sizes (read-only)
  g_dataInfoChar = service->createCharacteristic(
    DATA_INFO_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  g_dataInfoChar->setValue("none:0:0");

  // DATA_STREAM: pendant notifies chunks to phone
  g_dataStreamChar = service->createCharacteristic(
    DATA_STREAM_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  g_dataStreamChar->addDescriptor(new BLE2902());

  // DATA_ACK: phone writes flow control ("PULL", "DONE")
  // Callback is set later by bleTransferAttachCallback() after ble_transfer.h is loaded
  g_dataAckChar = service->createCharacteristic(
    DATA_ACK_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->start();

  Serial.println("[BLE] Advertising started (all characteristics ready)");
}

/** Send an event signal over BLE notify. */
void bleSignalEvent(const char *eventType) {
  if (!g_eventChar) return;

  String json = String("{\"type\":\"") + eventType +
    "\",\"ts\":" + String(millis()) + "}";
  g_eventChar->setValue(json.c_str());
  g_eventChar->notify();
  Serial.printf("[BLE] Signaled: %s\n", eventType);
}

bool bleIsConnected() {
  return g_bleConnected;
}

void bleDeinit() {
  BLEDevice::deinit(false);
  g_bleServer = nullptr;
  g_eventChar = nullptr;
  g_commandChar = nullptr;
  g_dataInfoChar = nullptr;
  g_dataStreamChar = nullptr;
  g_dataAckChar = nullptr;
}
