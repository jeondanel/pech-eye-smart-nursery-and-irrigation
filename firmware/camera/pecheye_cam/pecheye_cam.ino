/*
 * PECH-EYE camera node: GOOUUU ESP32-S3-CAM V1.5 + OV5640
 *
 * Always on (wall powered) but idle: it only takes a photo when Supabase says one is due.
 *   - "scheduled": every 12 h counted from "Start monitoring" (first photo 12 h after the start).
 *     Manual photos don't reset this schedule. Nothing is taken while no batch is monitored.
 *   - "manual":    someone pressed "Take photo" on the dashboard (picked up within CHECK_SECONDS).
 * The decision is made by camera_poll() in software/monitoring/supabase/schema.sql, so a
 * reboot or power cut never shifts the schedule. Photos are uploaded to the dashboard server.
 *
 * Credentials live in secrets.h (copy secrets.example.h -> secrets.h).
 *
 * Arduino IDE: ESP32S3 Dev Module, PSRAM: OPI PSRAM, Flash 16MB,
 *   Partition "16M Flash (3MB APP/9.9MB FATFS)", USB CDC On Boot: Disabled.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "secrets.h"

// ---- SETTINGS ----
const uint32_t CHECK_SECONDS = 3;   // how often to ask Supabase whether a photo is due
const uint32_t RETRY_SECONDS = 60;  // failed upload? wait this long before trying again
// ------------------

const char* WIFI_SSID    = SECRET_WIFI_SSID;
const char* WIFI_PASS    = SECRET_WIFI_PASS;
const char* SERVER_URL   = SECRET_SERVER_URL;
const char* API_KEY      = SECRET_API_KEY;
const char* SUPABASE_URL = SECRET_SUPABASE_URL;
const char* SUPABASE_KEY = SECRET_SUPABASE_KEY;

// GOOUUU ESP32-S3-CAM V1.5
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

bool cameraOk = false;
uint32_t nextCheckAt = 0;      // millis() of the next Supabase check
uint32_t lastWifiAttempt = 0;
WiFiClientSecure pollTls;      // kept open between checks so each one is quick
HTTPClient pollHttp;

// ---------- Camera ----------

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
  c.frame_size   = FRAMESIZE_QSXGA;   // OV5640 full 5 MP (2560x1920)
  c.jpeg_quality = 10;                // 0-63, lower = better quality
  c.fb_count     = 2;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("Camera init failed: 0x%x\n", err); return false; }
  Serial.printf("Camera PID: 0x%04X\n", esp_camera_sensor_get()->id.PID);
  return true;
}

// ---------- Wi-Fi ----------

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiAttempt < 15000) return;
  lastWifiAttempt = millis();
  Serial.println("Reconnecting Wi-Fi...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// ---------- Dashboard upload ----------

// POSTs a JPEG in small chunks, retrying partial writes. HTTPClient::POST(buf, len)
// aborts on the first short write, which happens easily with large photos over Wi-Fi.
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
  secure.setInsecure();
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

// source = "scheduled" | "manual"; the server stores it with the photo.
bool uploadPhoto(const String& source) {
  if (!cameraOk || WiFi.status() != WL_CONNECTED) return false;
  // Drop a stale buffered frame so the upload is a fresh picture.
  camera_fb_t* old = esp_camera_fb_get();
  if (old) esp_camera_fb_return(old);
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Capture failed"); return false; }
  String path = "/api/ingest/image?source=" + source;
  int code = postJpeg(path.c_str(), fb->buf, fb->len);
  Serial.printf("Uploaded %u bytes (%s) -> HTTP %d\n", (unsigned)fb->len, source.c_str(), code);
  esp_camera_fb_return(fb);
  return code == 200;
}

// ---------- Supabase check ----------

// Calls the camera_poll() database function. Returns "scheduled", "manual" or "" (nothing due).
String photoDue() {
  String url = SUPABASE_URL;
  while (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/rest/v1/rpc/camera_poll";
  pollHttp.setReuse(true);
  pollHttp.setTimeout(8000);
  if (!pollHttp.begin(pollTls, url)) return "";
  pollHttp.addHeader("apikey", SUPABASE_KEY);
  pollHttp.addHeader("Content-Type", "application/json");
  int code = pollHttp.POST("{\"p_every\":" + String(CHECK_SECONDS) + "}");
  String body = code == 200 ? pollHttp.getString() : "";
  pollHttp.end();
  if (code != 200) { Serial.printf("Supabase check -> HTTP %d\n", code); return ""; }
  if (body.indexOf("scheduled") >= 0) return "scheduled";
  if (body.indexOf("manual") >= 0) return "manual";
  return "";
}

// ---------- Main ----------

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\nPECH-EYE CAMERA");

  cameraOk = initCamera();
  pollTls.setInsecure();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);   // modem sleep stalls large uploads
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Full TX power garbles packets on many S3 boards; a lower power is more reliable.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  lastWifiAttempt = millis();
  Serial.print("Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " not connected yet");
}

void loop() {
  maintainWifi();
  if (WiFi.status() != WL_CONNECTED || (int32_t)(millis() - nextCheckAt) < 0) { delay(20); return; }

  String due = photoDue();
  nextCheckAt = millis() + CHECK_SECONDS * 1000UL;
  if (due.length()) {
    Serial.println("Photo due: " + due);
    // On failure the photo stays due in Supabase, so it is simply retried after RETRY_SECONDS.
    if (!uploadPhoto(due)) nextCheckAt = millis() + RETRY_SECONDS * 1000UL;
  }
}
