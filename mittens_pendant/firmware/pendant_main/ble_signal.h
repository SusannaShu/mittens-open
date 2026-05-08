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

static BLEServer *g_bleServer = nullptr;
static BLECharacteristic *g_eventChar = nullptr;
static BLECharacteristic *g_commandChar = nullptr;
static bool g_bleConnected = false;

// --- BLE Callbacks ---

class PendantServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    g_bleConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer *server) override {
    g_bleConnected = false;
    Serial.println("[BLE] Client disconnected");
    server->getAdvertising()->start();
  }
};

/**
 * Command handler: phone writes commands here.
 * Supported: "wifi:SSID:PASSWORD:IP"
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
  }
};

// ─── Init / Deinit ───

void bleInit() {
  if (g_bleServer) return;

  BLEDevice::init(BLE_DEVICE_NAME);
  g_bleServer = BLEDevice::createServer();
  g_bleServer->setCallbacks(new PendantServerCallbacks());

  BLEService *service = g_bleServer->createService(SERVICE_UUID);

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

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->start();

  Serial.println("[BLE] Advertising started");
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
}
