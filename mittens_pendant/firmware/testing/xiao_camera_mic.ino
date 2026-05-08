/*
 * XIAO ESP32-S3 Sense — Camera + Mic over WiFi
 *
 * Open http://<printed-ip>/ in your browser.
 *
 * Board: XIAO_ESP32S3
 * Tools → PSRAM: "OPI PSRAM"   (REQUIRED)
 */

#include "esp_camera.h"
#include <ESP_I2S.h>
#include <WebServer.h>
#include <WiFi.h>

// ---- WiFi ----
const char *WIFI_SSID = "REDACTED_WIFI_SSID";
const char *WIFI_PASSWORD = "REDACTED_WIFI_PASSWORD";

// ---- Camera pins (XIAO ESP32-S3 Sense) ----
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

// ---- Audio ----
#define SAMPLE_RATE 16000
#define RECORD_SECONDS 5
#define WAV_HEADER_SIZE 44
#define PDM_CLK_PIN 42
#define PDM_DATA_PIN 41

WebServer server(80);
I2SClass I2S;

// ============================================================
//  HTML PAGE
// ============================================================
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>XIAO ESP32-S3 Sense</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; }
  img { width: 100%; border-radius: 8px; background: #111; }
  button { font-size: 16px; padding: 10px 18px; border-radius: 6px; border: 1px solid #333;
           background: #fff; cursor: pointer; margin-top: 12px; }
  button:disabled { opacity: 0.5; cursor: wait; }
  #status { margin-top: 8px; color: #555; }
</style></head>
<body>
  <h1>XIAO ESP32-S3 Sense</h1>
  <img src="/stream" alt="camera stream">
  <div>
    <button id="rec">Record 5s of audio</button>
    <a id="dl" style="display:none; margin-left:12px;">Download WAV</a>
  </div>
  <div id="status">Ready.</div>

<script>
const btn = document.getElementById('rec');
const dl  = document.getElementById('dl');
const st  = document.getElementById('status');
const img = document.querySelector('img');
const STREAM_URL = '/stream';

btn.onclick = async () => {
  btn.disabled = true; dl.style.display = 'none';
  st.textContent = 'Recording...';

  // Pause stream so the server can handle the audio request
  img.src = '';

  try {
    const res = await fetch('/audio.wav');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    dl.href = url; dl.download = 'audio.wav'; dl.textContent = 'Download WAV';
    dl.style.display = 'inline';
    st.textContent = 'Done. ' + (blob.size/1024).toFixed(1) + ' KB';
  } catch (e) {
    st.textContent = 'Error: ' + e.message;
  } finally {
    // Resume stream
    img.src = STREAM_URL + '?t=' + Date.now();
    btn.disabled = false;
  }
};
</script>
</body></html>
)rawliteral";

// ============================================================
//  CAMERA
// ============================================================
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
  config.frame_size = FRAMESIZE_VGA; // 640x480 — good for streaming
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  return true;
}

// ============================================================
//  HTTP HANDLERS
// ============================================================
void handleRoot() { server.send_P(200, "text/html", INDEX_HTML); }

// MJPEG stream — multipart response, one JPEG per part
void handleStream() {
  WiFiClient client = server.client();
  client.print("HTTP/1.1 200 OK\r\n"
               "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
               "Cache-Control: no-cache\r\n"
               "Connection: close\r\n\r\n");

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      delay(20);
      continue;
    }

    if (!client.printf(
            "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
            fb->len)) {
      esp_camera_fb_return(fb);
      break;
    }
    if (client.write(fb->buf, fb->len) != fb->len) {
      esp_camera_fb_return(fb);
      break;
    }
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(1); // yield so server.handleClient() in loop() can run
  }
  client.stop();
}

// Record N seconds of audio, return as WAV
void handleAudio() {
  I2S.setPinsPdmRx(PDM_CLK_PIN, PDM_DATA_PIN);
  if (!I2S.begin(I2S_MODE_PDM_RX, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO)) {
    server.send(500, "text/plain", "I2S init failed");
    return;
  }

  size_t totalBytes = SAMPLE_RATE * 2 * RECORD_SECONDS; // 16-bit mono
  uint8_t *buffer = (uint8_t *)ps_malloc(totalBytes);
  if (!buffer) {
    I2S.end();
    server.send(500, "text/plain", "alloc failed");
    return;
  }

  size_t got = 0;
  while (got < totalBytes) {
    size_t n = I2S.readBytes((char *)(buffer + got), totalBytes - got);
    if (n == 0)
      break;
    got += n;
  }
  I2S.end();

  // Build WAV header
  uint8_t header[WAV_HEADER_SIZE];
  uint32_t dataBytes = got;
  uint32_t fileSize = dataBytes + WAV_HEADER_SIZE - 8;
  uint32_t byteRate = SAMPLE_RATE * 2;
  uint32_t fmtSize = 16;
  uint16_t audioFmt = 1, channels = 1, blockAlign = 2, bps = 16;
  uint32_t sr = SAMPLE_RATE;

  memcpy(header, "RIFF", 4);
  memcpy(header + 4, &fileSize, 4);
  memcpy(header + 8, "WAVE", 4);
  memcpy(header + 12, "fmt ", 4);
  memcpy(header + 16, &fmtSize, 4);
  memcpy(header + 20, &audioFmt, 2);
  memcpy(header + 22, &channels, 2);
  memcpy(header + 24, &sr, 4);
  memcpy(header + 28, &byteRate, 4);
  memcpy(header + 32, &blockAlign, 2);
  memcpy(header + 34, &bps, 2);
  memcpy(header + 36, "data", 4);
  memcpy(header + 40, &dataBytes, 4);

  server.setContentLength(WAV_HEADER_SIZE + dataBytes);
  server.sendHeader("Content-Disposition",
                    "attachment; filename=\"audio.wav\"");
  server.send(200, "audio/wav", "");
  WiFiClient client = server.client();
  client.write(header, WAV_HEADER_SIZE);
  client.write(buffer, dataBytes);

  free(buffer);
  Serial.printf("Sent %u bytes of audio\n", dataBytes);
}

// ============================================================
//  SETUP / LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== XIAO ESP32-S3 Sense — WiFi test ===");

  if (!initCamera()) {
    Serial.println("Camera failed. Halting.");
    while (true)
      delay(1000);
  }
  Serial.println("Camera ready.");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Connecting to %s ", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.printf("\nConnected. Open http://%s/\n",
                WiFi.localIP().toString().c_str());

  server.on("/", handleRoot);
  server.on("/stream", HTTP_GET, handleStream);
  server.on("/audio.wav", HTTP_GET, handleAudio);
  server.begin();
}

void loop() { server.handleClient(); }