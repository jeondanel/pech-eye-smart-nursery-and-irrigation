/*
 * PECH-EYE camera node: GOOUUU ESP32-S3-CAM V1.5 + OV5640
 *
 * Always on (no deep sleep):
 *   - Live preview page on the LAN:  http://<camera-ip>/   and a single JPEG at /capture
 *     (the controller's Telegram /camera command links here)
 *   - Uploads a tray photo to the dashboard every CAPTURE_INTERVAL_HOURS, and once at boot
 *   - Every CHECK_INTERVAL_MINUTES asks the dashboard whether someone pressed "Take photo"
 *
 * Credentials live in secrets.h (copy secrets.example.h -> secrets.h).
 *
 * Arduino IDE: ESP32S3 Dev Module, PSRAM: OPI PSRAM, Flash 16MB,
 *   Partition "16M Flash (3MB APP/9.9MB FATFS)", USB CDC On Boot: Disabled.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "secrets.h"

// ---- SETTINGS ----
const uint32_t CAPTURE_INTERVAL_HOURS = 12;  // scheduled dashboard photo
const uint32_t CHECK_INTERVAL_MINUTES = 1;   // how often to ask for "Take photo" requests (0 = never)
const uint32_t RETRY_MINUTES          = 15;  // failed upload? try again this soon
// ------------------

const char* WIFI_SSID  = SECRET_WIFI_SSID;
const char* WIFI_PASS  = SECRET_WIFI_PASS;
const char* SERVER_URL = SECRET_SERVER_URL;
const char* API_KEY    = SECRET_API_KEY;

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

WebServer server(80);
bool cameraOk = false;
uint32_t nextCaptureAt = 0;   // millis() of the next scheduled upload (0 = right away)
uint32_t lastCheck = 0;
uint32_t lastWifiAttempt = 0;

const char webpage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <title>PECH-EYE Camera</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #111; color: white; text-align: center; font-family: Arial; margin: 20px; }
    img { width: 100%; max-width: 1100px; height: auto; border: 2px solid #555; }
    button, select { padding: 12px; margin: 8px; font-size: 15px; }
  </style>
</head>
<body>
  <h2>PECH-EYE OV5640 CAMERA</h2>
  <p>Live image preview</p>
  <img id="camera" src="/capture">
  <br>
  <button onclick="refreshImage()">Refresh Image</button>
  <p>Auto-refresh interval</p>
  <select id="interval" onchange="changeInterval()">
    <option value="500">0.5 seconds</option>
    <option value="1000" selected>1 second</option>
    <option value="2000">2 seconds</option>
    <option value="5000">5 seconds</option>
  </select>
  <p id="status">Camera ready</p>
  <script>
    let timer;
    function refreshImage() {
      const img = document.getElementById("camera");
      const status = document.getElementById("status");
      status.innerText = "Capturing image...";
      img.onload = () => { status.innerText = "Image captured successfully"; };
      img.onerror = () => { status.innerText = "Capture failed. Retrying..."; };
      img.src = "/capture?t=" + Date.now();
    }
    function changeInterval() {
      clearInterval(timer);
      timer = setInterval(refreshImage, Number(document.getElementById("interval").value));
    }
    changeInterval();
  </script>
</body>
</html>
)rawliteral";

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

// ---------- Local web page ----------

void handleRoot() { server.send_P(200, "text/html", webpage); }

void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { server.send(500, "text/plain", "Camera capture failed"); return; }
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");
  server.client().write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
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

bool uploadPhoto() {
  if (!cameraOk || WiFi.status() != WL_CONNECTED) return false;
  // Drop a stale buffered frame so the upload is a fresh picture.
  camera_fb_t* old = esp_camera_fb_get();
  if (old) esp_camera_fb_return(old);
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Capture failed"); return false; }
  int code = postJpeg("/api/ingest/image", fb->buf, fb->len);
  Serial.printf("Uploaded %u bytes -> HTTP %d\n", (unsigned)fb->len, code);
  esp_camera_fb_return(fb);
  return code == 200;
}

// Asks the server whether someone pressed "Take photo" on the dashboard.
bool photoRequested() {
  String url = String(SERVER_URL) + "/api/ingest/camera/poll?every=" + String(CHECK_INTERVAL_MINUTES * 60);
  WiFiClient plain;
  WiFiClientSecure secure;
  secure.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (url.startsWith("https://")) http.begin(secure, url); else http.begin(plain, url);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();
  String body = code == 200 ? http.getString() : "";
  http.end();
  if (code != 200) Serial.printf("Poll -> HTTP %d\n", code);
  return body.indexOf("\"capture\":true") >= 0;
}

// ---------- Main ----------

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\nPECH-EYE CAMERA");

  cameraOk = initCamera();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);   // modem sleep stalls large uploads
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Full TX power garbles packets on many S3 boards; a lower power is more reliable.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  lastWifiAttempt = millis();
  Serial.print("Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Live preview: http://");
    Serial.println(WiFi.localIP());
  }

  server.on("/", handleRoot);
  server.on("/capture", HTTP_GET, handleCapture);
  server.begin();
}

void loop() {
  server.handleClient();
  maintainWifi();
  if (WiFi.status() != WL_CONNECTED) { delay(10); return; }

  // Scheduled photo (first one right after boot).
  if ((int32_t)(millis() - nextCaptureAt) >= 0) {
    Serial.println("Scheduled photo");
    bool ok = uploadPhoto();
    nextCaptureAt = millis() + (ok ? CAPTURE_INTERVAL_HOURS * 3600000UL : RETRY_MINUTES * 60000UL);
  }

  // Dashboard "Take photo" request.
  if (CHECK_INTERVAL_MINUTES > 0 && millis() - lastCheck >= CHECK_INTERVAL_MINUTES * 60000UL) {
    lastCheck = millis();
    if (photoRequested()) {
      Serial.println("Photo requested from the dashboard");
      uploadPhoto();   // if it fails the request stays pending and is retried next check
    }
  }
  delay(2);
}
