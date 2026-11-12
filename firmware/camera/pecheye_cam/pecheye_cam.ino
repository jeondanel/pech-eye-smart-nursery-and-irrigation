/*
 * PECH-EYE camera node: ESP32-S3-CAM -> web server
 *
 * Arduino IDE settings:
 *   Board: "ESP32S3 Dev Module"   PSRAM: "OPI PSRAM" (or "QSPI PSRAM" - match your module)
 *   Flash size 8/16MB as per your board, USB CDC On Boot: Enabled
 *
 * The camera pin map below is for the common Freenove-style ESP32-S3-CAM (OV2640).
 * If your board differs, change ONLY the pin defines (check your board's schematic).
 *
 * Flow: wake -> connect Wi-Fi -> capture JPEG -> POST to /api/ingest/image -> repeat.
 * The server stores it, runs the AI analysis and forwards it to Telegram.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "secrets.h"

// ---- EDIT THESE ----
// Wi-Fi, server URL and API key live in secrets.h (copy secrets.example.h -> secrets.h)
const char* WIFI_SSID   = SECRET_WIFI_SSID;
const char* WIFI_PASS   = SECRET_WIFI_PASS;
const char* SERVER_URL  = SECRET_SERVER_URL;
const char* API_KEY     = SECRET_API_KEY;
const uint32_t CAPTURE_INTERVAL_MS = 15UL * 60UL * 1000UL;  // every 15 min
// --------------------

// Set to true once real sensors are wired (see readSensors() below).
#define USE_SENSORS false

#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  15
#define SIOD_GPIO_NUM   4
#define SIOC_GPIO_NUM   5
#define Y9_GPIO_NUM    16
#define Y8_GPIO_NUM    17
#define Y7_GPIO_NUM    18
#define Y6_GPIO_NUM    12
#define Y5_GPIO_NUM    10
#define Y4_GPIO_NUM     8
#define Y3_GPIO_NUM     9
#define Y2_GPIO_NUM    11
#define VSYNC_GPIO_NUM  6
#define HREF_GPIO_NUM   7
#define PCLK_GPIO_NUM  13

bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size   = FRAMESIZE_UXGA;      // 1600x1200: enough detail to see 72 holes
  c.jpeg_quality = 10;                  // 0-63, lower = better quality
  c.fb_count     = 2;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("Camera init failed: 0x%x\n", err); return false; }
  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : " FAILED");
}

bool postJson(const String& json) {
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/ingest/reading");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  int code = http.POST(json);
  http.end();
  return code == 200;
}

// ---- Sensors (tentative: not connected yet) ----
// Fill these in when hardware arrives. Only send the fields you actually have.
//  Soil moisture: analogRead(pin) mapped to 0-100 %  (calibrate dry/wet values)
//  Humidity/temp: DHT22/SHT31 library
//  Ultrasonic (HC-SR04 / JSN-SR04T): trigger+echo -> distance in cm
void readAndSendSensors() {
#if USE_SENSORS
  float soil = NAN, hum = NAN, temp = NAN, dist = NAN;
  // soil = ...; hum = ...; temp = ...; dist = ...;
  String j = "{";
  if (!isnan(soil)) j += "\"soil_moisture\":" + String(soil, 1) + ",";
  if (!isnan(hum))  j += "\"humidity\":" + String(hum, 1) + ",";
  if (!isnan(temp)) j += "\"temperature\":" + String(temp, 1) + ",";
  if (!isnan(dist)) j += "\"distance_cm\":" + String(dist, 1) + ",";
  if (j.endsWith(",")) j.remove(j.length() - 1);
  j += "}";
  postJson(j);
#endif
}

bool captureAndSend() {
  camera_fb_t* fb = esp_camera_fb_get();   // first frame can be stale: discard it
  if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Capture failed"); return false; }

  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/ingest/image");
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(20000);
  int code = http.POST(fb->buf, fb->len);
  Serial.printf("Uploaded %u bytes -> HTTP %d\n", (unsigned)fb->len, code);
  http.end();
  esp_camera_fb_return(fb);
  return code == 200;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  if (!initCamera()) { delay(5000); ESP.restart(); }
}

void loop() {
  connectWifi();
  if (WiFi.status() == WL_CONNECTED) {
    readAndSendSensors();
    captureAndSend();
  }
  delay(CAPTURE_INTERVAL_MS);
}
