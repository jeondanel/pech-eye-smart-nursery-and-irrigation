/*
 * PECH-EYE camera node: ESP32-S3-CAM -> web server
 *
 * Board: GOOUUU ESP32-S3-CAM V1.5 (N16R8) + OV2640. Same camera pin map as Freenove ESP32-S3-CAM.
 *
 * Build/flash from VS Code (arduino-cli), board on the CH340 "COM" USB-C port:
 *   arduino-cli compile --upload -p COM3 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=default" firmware/camera/pecheye_cam
 * Arduino IDE equivalent: ESP32S3 Dev Module, OPI PSRAM, 16MB flash,
 *   "16M Flash (3MB APP/9.9MB FATFS)", USB CDC On Boot: Disabled (Enabled only if using the OTG port).
 *
 * Flow (one photo per wake, then deep sleep):
 *   wake -> init camera -> Wi-Fi -> capture JPEG -> POST /api/ingest/image -> deep sleep
 * The server stores the photo and runs the ExG tray analysis.
 *
 * ---------------------------------------------------------------------------
 * WHEN DOES IT CAPTURE?  (any of these wakes the board and takes ONE photo)
 *   1. Timer: every CAPTURE_INTERVAL_HOURS (12 h).
 *   2. Manual button: push button between WAKE_BUTTON_PIN (GPIO14) and GND.
 *      No resistor needed (internal pull-up). Set WAKE_BUTTON_PIN to -1 to disable.
 *   3. Power-on or the on-board RST button: always captures once right away.
 *      -> For quick manual tests with no wiring, just press RST.
 *
 * TESTING TIP: to capture every 30 s instead of 12 h, set TEST_INTERVAL_SECONDS
 * below to 30, re-flash, and set it back to 0 when done.
 *
 * Notes:
 *  - Deep sleep resets the chip, so all the work happens in setup(); loop() never runs.
 *  - The sleep timer runs on the ESP32's internal RC clock, which can drift a few %
 *    (12 h may land ~10-30 min early/late). Fine for a tray photo.
 *  - Serial Monitor goes quiet while it sleeps - that's normal.
 * ---------------------------------------------------------------------------
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "esp_camera.h"
#include "esp_sleep.h"
#include "driver/rtc_io.h"
#include "secrets.h"

// ---- EDIT THESE ----
// Wi-Fi, server URL and API key live in secrets.h (copy secrets.example.h -> secrets.h)
const char* WIFI_SSID   = SECRET_WIFI_SSID;
const char* WIFI_PASS   = SECRET_WIFI_PASS;
const char* SERVER_URL  = SECRET_SERVER_URL;
const char* API_KEY     = SECRET_API_KEY;

const uint32_t CAPTURE_INTERVAL_HOURS = 12;   // normal schedule: one photo every 12 h
const uint32_t TEST_INTERVAL_SECONDS  = 0;    // TESTING: e.g. 30 = photo every 30 s. 0 = use the 12 h schedule
const uint32_t RETRY_MINUTES          = 15;   // if Wi-Fi/upload fails, try again this soon instead of waiting 12 h

// Manual capture button: wire a push button from this pin to GND.
// Must be an RTC-capable GPIO (0-21 on ESP32-S3) that the camera doesn't use.
// Free choices on this board: 1, 2, 14, 21. Not GPIO0 (BOOT): holding it during wake can enter flash mode.
// Set to -1 to disable the button.
#define WAKE_BUTTON_PIN 14
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
  WiFi.setSleep(false);   // modem sleep stalls large uploads
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Full TX power garbles outgoing packets on many cheap S3 boards (and sags USB power):
  // ~80% loss despite a strong signal. A lower TX power fixes it; the router is close anyway.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  Serial.print("Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  if (WiFi.status() == WL_CONNECTED) Serial.printf("%s  RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else Serial.println(" FAILED");
}

// POSTs a JPEG by writing it in small chunks and retrying partial writes.
// HTTPClient::POST(buf, len) aborts the whole upload on the first short write
// (HTTP -3), which happens easily with ~150 KB photos over Wi-Fi.
int postJpeg(const char* path, const uint8_t* buf, size_t len) {
  String url = SERVER_URL;
  bool tls = url.startsWith("https://");
  url.remove(0, url.indexOf("//") + 2);
  int slash = url.indexOf('/');
  if (slash >= 0) url = url.substring(0, slash);
  String host = url;
  uint16_t port = tls ? 443 : 80;
  int colon = url.indexOf(':');
  if (colon >= 0) { host = url.substring(0, colon); port = url.substring(colon + 1).toInt(); }

  WiFiClient plain;
  WiFiClientSecure secure;
  secure.setInsecure();   // no CA pinning; fine for this project's Vercel endpoint
  Client& client = tls ? (Client&)secure : (Client&)plain;
  if (!client.connect(host.c_str(), port)) return -1;

  client.printf("POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: image/jpeg\r\n"
                "x-api-key: %s\r\nContent-Length: %u\r\nConnection: close\r\n\r\n",
                path, host.c_str(), API_KEY, (unsigned)len);

  size_t sent = 0;
  uint32_t lastProgress = millis();
  while (sent < len) {
    size_t n = client.write(buf + sent, min((size_t)2048, len - sent));
    if (n > 0) { sent += n; lastProgress = millis(); continue; }
    if (!client.connected() || millis() - lastProgress > 15000) break;
    delay(20);
  }
  if (sent < len) { Serial.printf("Send stalled at %u/%u bytes\n", (unsigned)sent, (unsigned)len); client.stop(); return -3; }

  uint32_t t0 = millis();
  while (!client.available() && client.connected() && millis() - t0 < 20000) delay(20);
  String status = client.readStringUntil('\n');   // "HTTP/1.1 200 OK"
  client.stop();
  return status.length() > 12 ? status.substring(9, 12).toInt() : -11;
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
  // The camera was just powered up from deep sleep: let auto-exposure / white balance
  // settle by throwing away a few frames, otherwise the photo comes out dark and green-tinted.
  for (int i = 0; i < 5; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(150);
  }
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Capture failed"); return false; }

  int code = postJpeg("/api/ingest/image", fb->buf, fb->len);
  Serial.printf("Uploaded %u bytes -> HTTP %d\n", (unsigned)fb->len, code);
  esp_camera_fb_return(fb);
  return code == 200;
}

void goToSleep(uint64_t seconds) {
  Serial.printf("Sleeping %llu s (%.1f h)", seconds, seconds / 3600.0);
  esp_sleep_enable_timer_wakeup(seconds * 1000000ULL);

#if WAKE_BUTTON_PIN >= 0
  // Wait until the button is released, otherwise it would wake us again instantly.
  pinMode(WAKE_BUTTON_PIN, INPUT_PULLUP);
  while (digitalRead(WAKE_BUTTON_PIN) == LOW) delay(10);
  // Keep the pull-up active during sleep and wake when the pin is pulled LOW (button pressed).
  rtc_gpio_pullup_en((gpio_num_t)WAKE_BUTTON_PIN);
  rtc_gpio_pulldown_dis((gpio_num_t)WAKE_BUTTON_PIN);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)WAKE_BUTTON_PIN, 0);
  Serial.printf(" - or press the button on GPIO%d", WAKE_BUTTON_PIN);
#endif
  Serial.println();
  Serial.flush();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  esp_camera_deinit();
  esp_deep_sleep_start();   // never returns; the board restarts into setup() on wake
}

void setup() {
  Serial.begin(115200);
  delay(500);

  switch (esp_sleep_get_wakeup_cause()) {
    case ESP_SLEEP_WAKEUP_TIMER: Serial.println("\nWake: scheduled capture"); break;
    case ESP_SLEEP_WAKEUP_EXT0:  Serial.println("\nWake: manual button");      break;
    default:                     Serial.println("\nWake: power-on / RST");     break;
  }

  uint64_t sleepSeconds = TEST_INTERVAL_SECONDS > 0
      ? TEST_INTERVAL_SECONDS
      : (uint64_t)CAPTURE_INTERVAL_HOURS * 3600ULL;

  bool ok = false;
  if (initCamera()) {
    connectWifi();
    if (WiFi.status() == WL_CONNECTED) {
      readAndSendSensors();
      ok = captureAndSend();
    }
  }
  // Failed (camera, Wi-Fi or upload)? Retry soon rather than losing a whole 12 h slot.
  if (!ok && TEST_INTERVAL_SECONDS == 0) sleepSeconds = (uint64_t)RETRY_MINUTES * 60ULL;

  goToSleep(sleepSeconds);
}

void loop() {
  // Not used: the board deep-sleeps at the end of setup() and restarts on wake.
}
