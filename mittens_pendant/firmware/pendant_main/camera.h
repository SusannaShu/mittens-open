#pragma once
/**
 * OV2640 Camera -- init + single frame capture.
 *
 * Uses VGA (640x480) with good JPEG quality for food/face analysis.
 * Single frame capture (not streaming) -- optimized for pendant wake cycle.
 */

#include "esp_camera.h"
#include "config.h"

bool cameraInit() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;  // 640x480 for food/face analysis
  config.jpeg_quality = 10;             // Good quality (lower = better)
  config.fb_count     = 1;              // Single capture, not streaming
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }

  Serial.println("[CAM] Initialized (VGA 640x480)");
  return true;
}

/**
 * Capture a single JPEG frame.
 * Throws away the first frame for auto-exposure warmup.
 * Returns the frame buffer (caller must call esp_camera_fb_return).
 */
camera_fb_t* captureFrame() {
  // Discard first frame (auto-exposure warmup)
  camera_fb_t *warmup = esp_camera_fb_get();
  if (warmup) esp_camera_fb_return(warmup);
  delay(100);

  // Real capture
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Capture failed");
    return nullptr;
  }

  Serial.printf("[CAM] Frame: %d bytes, %dx%d\n", fb->len, fb->width, fb->height);
  return fb;
}
