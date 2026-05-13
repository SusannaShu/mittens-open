#pragma once
/**
 * WiFi + HTTP POST -- connect to home WiFi or hotspot, POST data to phone.
 *
 * Tries home WiFi first, falls back to phone hotspot.
 * Uses multipart/form-data POST matching pendantServer.ts on the phone.
 */

#include "config.h"
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>

// Phone IP (loaded from NVS or default)
String g_phoneIP = PHONE_IP_DEFAULT;
String g_userSSID = "";
String g_userPassword = "";
static Preferences g_wifiPrefs;

/** Load phone IP and user WiFi from NVS (set during BLE pairing). */
void wifiLoadConfig() {
  g_wifiPrefs.begin("mittens", true);
  g_phoneIP = g_wifiPrefs.getString("phone_ip", PHONE_IP_DEFAULT);
  g_userSSID = g_wifiPrefs.getString("user_ssid", "");
  g_userPassword = g_wifiPrefs.getString("user_pass", "");
  g_wifiPrefs.end();
  Serial.printf("[WIFI] Phone IP: %s\n", g_phoneIP.c_str());
  if (g_userSSID.length() > 0) {
    Serial.printf("[WIFI] User network: %s\n", g_userSSID.c_str());
  }
}

/** Save phone IP to NVS. */
void wifiSavePhoneIP(const String &ip) {
  g_wifiPrefs.begin("mittens", false);
  g_wifiPrefs.putString("phone_ip", ip);
  g_wifiPrefs.end();
  g_phoneIP = ip;
}

/** Save user WiFi credentials to NVS. */
void wifiSaveUserNetwork(const String &ssid, const String &password) {
  g_wifiPrefs.begin("mittens", false);
  g_wifiPrefs.putString("user_ssid", ssid);
  g_wifiPrefs.putString("user_pass", password);
  g_wifiPrefs.end();
  g_userSSID = ssid;
  g_userPassword = password;
  Serial.printf("[WIFI] User network saved: %s\n", ssid.c_str());
}

/** Clear user WiFi credentials from NVS (used when credentials fail). */
void wifiClearUserNetwork() {
  g_wifiPrefs.begin("mittens", false);
  g_wifiPrefs.remove("user_ssid");
  g_wifiPrefs.remove("user_pass");
  g_wifiPrefs.end();
  g_userSSID = "";
  g_userPassword = "";
  Serial.println("[WIFI] User network cleared");
}

/**
 * Connect to WiFi.
 * Priority: 1. User-provisioned network (NVS, from app via BLE)
 *           2. Dev network 1 (config.h, for bench testing)
 *           3. Dev network 2 (config.h, for bench testing)
 * Returns true on success.
 */
bool wifiConnect() {
  WiFi.mode(WIFI_STA);

  // 1. Try user-configured network first (from NVS / BLE provisioning)
  if (g_userSSID.length() > 0) {
    Serial.printf("[WIFI] Trying user network: %s\n", g_userSSID.c_str());
    WiFi.begin(g_userSSID.c_str(), g_userPassword.c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           millis() - start < WIFI_TIMEOUT_MS) {
      delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WIFI] Connected to user network, IP: %s\n",
                    WiFi.localIP().toString().c_str());
      return true;
    }
    WiFi.disconnect(true);
    delay(100);
  }

  // 2. Try dev network 1 (if configured in config.h)
  if (strlen(WIFI_DEV_SSID_1) > 0) {
    Serial.printf("[WIFI] Trying dev network 1: %s\n", WIFI_DEV_SSID_1);
    WiFi.begin(WIFI_DEV_SSID_1, WIFI_DEV_PASSWORD_1);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           millis() - start < WIFI_TIMEOUT_MS) {
      delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WIFI] Connected to dev network 1, IP: %s\n",
                    WiFi.localIP().toString().c_str());
      return true;
    }
    WiFi.disconnect(true);
    delay(100);
  }

  // 3. Try dev network 2 (if configured in config.h)
  if (strlen(WIFI_DEV_SSID_2) > 0) {
    Serial.printf("[WIFI] Trying dev network 2: %s\n", WIFI_DEV_SSID_2);
    WiFi.begin(WIFI_DEV_SSID_2, WIFI_DEV_PASSWORD_2);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           millis() - start < WIFI_TIMEOUT_MS) {
      delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WIFI] Connected to dev network 2, IP: %s\n",
                    WiFi.localIP().toString().c_str());
      return true;
    }
    WiFi.disconnect(true);
    delay(100);
  }

  Serial.println("[WIFI] All networks failed");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  return false;
}

void wifiDisconnect() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

/**
 * HTTP POST multipart event to phone.
 * Compatible with pendantServer.ts on the React Native app.
 *
 * @param eventType  "MOTION" or "BUTTON_PRESS"
 * @param wakeCount  Wake counter (persisted in RTC)
 * @param audio      PCM16 audio bytes (nullable)
 * @param audioLen   Audio byte count
 * @param frame      JPEG frame bytes (nullable)
 * @param frameLen   Frame byte count
 */
bool wifiPostEvent(const char *eventType, int wakeCount, uint8_t *audio,
                   size_t audioLen, uint8_t *frame, size_t frameLen) {
  String url =
      "http://" + g_phoneIP + ":" + String(HTTP_PORT) + "/pendant/event";
  Serial.printf("[HTTP] POST %s (audio:%d frame:%d)\n", url.c_str(), audioLen,
                frameLen);

  HTTPClient http;
  http.begin(url);
  http.setTimeout(HTTP_TIMEOUT_MS);

  String boundary = "----MittensPendant";
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);

  // Build meta JSON
  String metaJson =
      String("{\"type\":\"") + eventType + "\",\"ts\":" + String(millis()) +
      ",\"wake\":" + String(wakeCount) +
      ",\"audioRate\":" + String(AUDIO_SAMPLE_RATE) + ",\"audioChannels\":1}";

  // Build multipart parts as strings (headers only)
  String metaHeader = "--" + boundary +
                      "\r\nContent-Disposition: form-data; name=\"meta\"\r\n"
                      "Content-Type: application/json\r\n\r\n";
  String metaPart = metaHeader + metaJson + "\r\n";

  String audioHeader = "--" + boundary +
                       "\r\nContent-Disposition: form-data; name=\"audio\"; "
                       "filename=\"audio.pcm\"\r\n"
                       "Content-Type: application/octet-stream\r\n\r\n";

  String frameHeader = "--" + boundary +
                       "\r\nContent-Disposition: form-data; name=\"frame\"; "
                       "filename=\"frame.jpg\"\r\n"
                       "Content-Type: image/jpeg\r\n\r\n";

  String partEnd = "\r\n";
  String bodyEnd = "--" + boundary + "--\r\n";

  // Calculate total body size
  size_t totalSize = metaPart.length();
  if (audioLen > 0)
    totalSize += audioHeader.length() + audioLen + partEnd.length();
  if (frameLen > 0)
    totalSize += frameHeader.length() + frameLen + partEnd.length();
  totalSize += bodyEnd.length();

  // Allocate body in PSRAM
  uint8_t *body = (uint8_t *)ps_malloc(totalSize);
  if (!body) {
    Serial.println("[HTTP] Body alloc failed");
    http.end();
    return false;
  }

  size_t offset = 0;

  // Meta
  memcpy(body + offset, metaPart.c_str(), metaPart.length());
  offset += metaPart.length();

  // Audio
  if (audioLen > 0) {
    memcpy(body + offset, audioHeader.c_str(), audioHeader.length());
    offset += audioHeader.length();
    memcpy(body + offset, audio, audioLen);
    offset += audioLen;
    memcpy(body + offset, partEnd.c_str(), partEnd.length());
    offset += partEnd.length();
  }

  // Frame
  if (frameLen > 0) {
    memcpy(body + offset, frameHeader.c_str(), frameHeader.length());
    offset += frameHeader.length();
    memcpy(body + offset, frame, frameLen);
    offset += frameLen;
    memcpy(body + offset, partEnd.c_str(), partEnd.length());
    offset += partEnd.length();
  }

  // End boundary
  memcpy(body + offset, bodyEnd.c_str(), bodyEnd.length());
  offset += bodyEnd.length();

  int httpCode = http.POST(body, offset);
  free(body);

  Serial.printf("[HTTP] Response: %d\n", httpCode);
  http.end();

  return httpCode == 200;
}
