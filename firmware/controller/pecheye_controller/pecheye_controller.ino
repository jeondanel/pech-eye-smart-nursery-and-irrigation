/*
  PECH-EYE controller node: ESP32-S3 DevKit
  Sensors (DHT11, capacitive soil, float switch) + relays (mist, grow light, pump)
  + 20x4 I2C LCD + Telegram bot + monitoring server.

  Arduino-ESP32 core 3.x
  Libraries: DHT sensor library, Adafruit Unified Sensor, ArduinoJson 7, LiquidCrystal I2C

  Credentials live in secrets.h (copy secrets.example.h -> secrets.h).

  What goes to the server (software/monitoring):
    POST /api/ingest/reading  every 5 min: climate, soil, reservoir, relay states
    POST /api/ingest/run      each time a relay switches OFF: device, seconds ON, who started it
    POST /api/ingest/alert    reservoir LOW / restored, safety stops, boot
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <math.h>
#include "secrets.h"

// ===== SETTINGS =====
// Camera node IP on the LAN (no http://). Shown by /camera.
const char* CAMERA_IP = "192.168.100.96";

// Set to true ONLY after checking float-switch behavior and filling the reservoir.
const bool ENABLE_WET_ACTUATORS = true;

// Soil calibration (capacitive sensor: higher ADC = drier). Read the raw values with /soil.
constexpr int SOIL_RAW_DRY = 2800;        // probe in dry air / dry soil
constexpr int SOIL_RAW_WET = 1200;        // probe in water / soaked soil
constexpr int SOIL_DRY_THRESHOLD = 2400;  // >= this is DRY
// ====================

constexpr uint8_t PIN_SOIL  = 1;  // Soil AO (0..3.3 V ONLY)
constexpr uint8_t PIN_FLOAT = 4;  // External 10k pull-up to 3.3 V; LOW = reservoir low
constexpr uint8_t PIN_DHT   = 5;
constexpr uint8_t PIN_MIST  = 6;  // Relay IN1, active LOW
constexpr uint8_t PIN_SDA   = 8;  // I2C SDA for LCD
constexpr uint8_t PIN_SCL   = 9;  // I2C SCL for LCD
constexpr uint8_t PIN_LIGHT = 15; // Relay IN3, active LOW
constexpr uint8_t PIN_PUMP  = 16; // Relay IN4, active LOW

constexpr uint32_t LIGHT_TEST_MS    = 5UL * 60UL * 1000UL;
constexpr uint32_t MIST_TEST_MS     = 5UL * 60UL * 1000UL;
constexpr uint32_t PUMP_TEST_MS     = 10UL * 1000UL;
constexpr uint32_t TELEGRAM_POLL_MS = 2300;
constexpr uint32_t WIFI_RETRY_MS    = 15000;
constexpr uint32_t LCD_UPDATE_MS    = 2000;
constexpr uint32_t REPORT_MS        = 5UL * 60UL * 1000UL;  // reading -> server

const String BOT_TOKEN        = SECRET_BOT_TOKEN;
const String TELEGRAM_CHAT_ID = SECRET_CHAT_ID;
const String SERVER_URL       = SECRET_SERVER_URL;
const String API_KEY          = SECRET_API_KEY;

DHT dht(PIN_DHT, DHT11);
LiquidCrystal_I2C lcd(0x27, 20, 4); // Change 0x27 to 0x3F if the screen stays blank

struct RelayState {
  uint8_t pin;
  bool on;
  uint32_t started;
  uint32_t duration;
  const char* name;    // shown in Telegram
  const char* device;  // stored in the database: mist | light | pump
  const char* source;  // who switched it on: telegram | auto | dashboard
};

RelayState mist  = {PIN_MIST,  false, 0, MIST_TEST_MS,  "Mist",       "mist",  ""};
RelayState light = {PIN_LIGHT, false, 0, LIGHT_TEST_MS, "Grow light", "light", ""};
RelayState pump  = {PIN_PUMP,  false, 0, PUMP_TEST_MS,  "Pump",       "pump",  ""};

long lastUpdateId = 0;
uint32_t lastTelegramPoll = 0;
uint32_t lastWifiAttempt = 0;
uint32_t lastLcdUpdate = 0;
uint32_t lastReport = 0;
bool wifiWasConnected = false;
bool startupSent = false;
bool telegramSynced = false; // never execute old queued commands after boot
bool lastFloatLow = false;

// ---------- Sensors ----------

struct Climate { float temp; float hum; };

// DHT11 read. Returns NAN for a failed read. Replace this function when the DHT11 is recoded;
// everything else (LCD, Telegram, server) only calls readClimate().
Climate readClimate() {
  return {dht.readTemperature(), dht.readHumidity()};
}

bool reservoirLow() { return digitalRead(PIN_FLOAT) == LOW; }
int soilRaw() { return analogRead(PIN_SOIL); }
bool isSoilDry(int raw) { return raw >= SOIL_DRY_THRESHOLD; }

// Raw ADC -> 0..100 % using the calibration above.
float soilPercent(int raw) {
  float pct = 100.0f * (SOIL_RAW_DRY - raw) / (float)(SOIL_RAW_DRY - SOIL_RAW_WET);
  return constrain(pct, 0.0f, 100.0f);
}

// ---------- Server ----------

bool postServer(const char* path, JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED || SERVER_URL.length() == 0) return false;
  String url = SERVER_URL + path;
  WiFiClient plain;
  WiFiClientSecure secure;
  secure.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);
  if (url.startsWith("https://") ? !http.begin(secure, url) : !http.begin(plain, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  http.end();
  Serial.printf("[SRV] POST %s -> %d\n", path, code);
  return code == 200;
}

bool postReading() {
  Climate c = readClimate();
  int raw = soilRaw();
  JsonDocument doc;
  if (!isnan(c.temp)) doc["temperature"] = c.temp;
  if (!isnan(c.hum)) doc["humidity"] = c.hum;
  doc["soil_raw"] = raw;
  doc["soil_moisture"] = soilPercent(raw);
  doc["reservoir_low"] = reservoirLow();
  doc["mist_on"] = mist.on;
  doc["light_on"] = light.on;
  doc["pump_on"] = pump.on;
  return postServer("/api/ingest/reading", doc);
}

void postRun(const RelayState& relay, uint32_t onMs, const char* stoppedBy) {
  JsonDocument doc;
  doc["device"] = relay.device;
  doc["duration_s"] = onMs / 1000.0;
  doc["source"] = relay.source;
  doc["stopped_by"] = stoppedBy;
  postServer("/api/ingest/run", doc);
}

// ---------- Telegram ----------

bool sendTelegram(const String& message) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(client, "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage")) return false;
  http.addHeader("Content-Type", "application/json");

  JsonDocument data;
  data["chat_id"] = TELEGRAM_CHAT_ID;
  data["text"] = message;
  String json;
  serializeJson(data, json);

  int status = http.POST(json);
  if (status != 200) Serial.printf("[TG] sendMessage HTTP error: %d\n", status);
  http.end();
  return status == 200;
}

// Telegram message + a row in the server's alerts table.
void alert(const char* kind, const String& message) {
  bool sent = sendTelegram(message);
  JsonDocument doc;
  doc["kind"] = kind;
  doc["message"] = message;
  doc["sent_telegram"] = sent;
  postServer("/api/ingest/alert", doc);
}

// ---------- Relays ----------

void setRelay(RelayState& relay, bool turnOn, const char* by = "") {
  if (relay.on && !turnOn) postRun(relay, millis() - relay.started, by);
  relay.on = turnOn;
  if (turnOn) { relay.started = millis(); relay.source = by; }
  digitalWrite(relay.pin, turnOn ? LOW : HIGH);
}

void stopWet(const char* by) {
  if (mist.on) setRelay(mist, false, by);
  if (pump.on) setRelay(pump, false, by);
}

void stopAll(const char* by) {
  stopWet(by);
  if (light.on) setRelay(light, false, by);
}

void startTimed(RelayState& relay, const char* by) {
  setRelay(relay, true, by);
  sendTelegram(String(relay.name) + " ON. Auto-off in " + String(relay.duration / 1000) + " seconds.");
}

// ---------- LCD ----------

void updateLCD() {
  Climate c = readClimate();
  int raw = soilRaw();

  lcd.setCursor(0, 0);
  char line[21];
  if (isnan(c.temp)) snprintf(line, sizeof(line), "Temp: ERR           ");
  else snprintf(line, sizeof(line), "Temp: %.1f C        ", c.temp);
  lcd.print(line);

  lcd.setCursor(0, 1);
  if (isnan(c.hum)) snprintf(line, sizeof(line), "Hum:  ERR           ");
  else snprintf(line, sizeof(line), "Hum:  %.0f %%         ", c.hum);
  lcd.print(line);

  lcd.setCursor(0, 2);
  snprintf(line, sizeof(line), "Soil: %s %3.0f%%      ", isSoilDry(raw) ? "DRY" : "WET", soilPercent(raw));
  lcd.print(line);

  lcd.setCursor(0, 3);
  snprintf(line, sizeof(line), "Tank:%s M%c L%c P%c ", reservoirLow() ? "LOW" : "OK ",
           mist.on ? '+' : '-', light.on ? '+' : '-', pump.on ? '+' : '-');
  lcd.print(line);
}

// ---------- Wi-Fi ----------

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.print("[NET] Wi-Fi connected: ");
      Serial.println(WiFi.localIP());
    }
    return;
  }
  wifiWasConnected = false;
  if (millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
    lastWifiAttempt = millis();
    Serial.println("[NET] Reconnecting Wi-Fi...");
    WiFi.disconnect();
    WiFi.begin(SECRET_WIFI_SSID, SECRET_WIFI_PASS);
  }
}

// ---------- Telegram commands ----------

String climateText() {
  Climate c = readClimate();
  if (isnan(c.temp) || isnan(c.hum)) return "DHT11: read failed (check GPIO5 / 3.3V / GND)";
  return "Temperature: " + String(c.temp, 1) + " C\nHumidity: " + String(c.hum, 1) + " %";
}

String soilText() {
  int raw = soilRaw();
  return "Soil: " + String(isSoilDry(raw) ? "DRY" : "MOIST / WET") + " (" + String(soilPercent(raw), 0) + " %)\n"
         "ADC: " + String(raw) + " / 4095, DRY at >= " + String(SOIL_DRY_THRESHOLD);
}

String statusText() {
  String msg = "PECH-EYE CONTROLLER\n";
  msg += climateText() + "\n";
  msg += soilText() + "\n";
  msg += "Reservoir: " + String(reservoirLow() ? "LOW / EMPTY" : "NORMAL") + "\n";
  msg += "Mist: " + String(mist.on ? "ON" : "OFF") + "\n";
  msg += "Light: " + String(light.on ? "ON" : "OFF") + "\n";
  msg += "Pump: " + String(pump.on ? "ON" : "OFF") + "\n";
  msg += "Wet actuators: " + String(ENABLE_WET_ACTUATORS ? "ENABLED" : "DISABLED") + "\n";
  msg += "IP: " + WiFi.localIP().toString() + ", RSSI " + String(WiFi.RSSI()) + " dBm";
  return msg;
}

void startWet(RelayState& relay) {
  if (!ENABLE_WET_ACTUATORS) sendTelegram(String(relay.name) + " blocked: set ENABLE_WET_ACTUATORS=true after hardware checks.");
  else if (reservoirLow()) sendTelegram(String(relay.name) + " blocked: reservoir is LOW.");
  else startTimed(relay, "telegram");
}

void commandReceived(String cmd) {
  cmd.trim();
  cmd.toLowerCase();
  int mention = cmd.indexOf('@');
  if (mention > 0 && cmd[0] == '/') cmd = cmd.substring(0, mention);
  Serial.println("[TG] Command: " + cmd);

  if (cmd == "/start" || cmd == "/help") {
    sendTelegram("PECH-EYE COMMANDS\n"
                 "/ping - Bot check\n"
                 "/status - All readings\n"
                 "/climate - DHT11\n"
                 "/soil - Soil moisture\n"
                 "/reservoir - Water float\n"
                 "/openlight - 5 minute light\n"
                 "/openmist - 5 minute mist\n"
                 "/openpump - 10 second pump\n"
                 "/camera - Camera URL\n"
                 "/stopall - Turn everything OFF");
  } else if (cmd == "/ping") {
    sendTelegram("PECH-EYE controller online. IP: " + WiFi.localIP().toString());
  } else if (cmd == "/status") {
    sendTelegram(statusText());
  } else if (cmd == "/climate") {
    sendTelegram(climateText());
  } else if (cmd == "/soil") {
    sendTelegram(soilText());
  } else if (cmd == "/reservoir") {
    sendTelegram(reservoirLow() ? "Reservoir LOW: refill needed." : "Reservoir NORMAL.");
  } else if (cmd == "/openlight" || cmd == "/openlights") {
    startTimed(light, "telegram");
  } else if (cmd == "/openmist" || cmd == "/openhumidifier") {
    startWet(mist);
  } else if (cmd == "/openpump") {
    startWet(pump);
  } else if (cmd == "/stopall" || cmd == "/stop") {
    stopAll("telegram");
    sendTelegram("ALL ACTUATORS OFF.");
  } else if (cmd == "/camera") {
    sendTelegram(String("Camera (same LAN): http://") + CAMERA_IP + "/\nSnapshot: http://" + CAMERA_IP + "/capture");
  } else {
    sendTelegram("Unknown command. Send /help.");
  }
}

// On boot, skip queued Telegram updates so old /open commands never run.
bool syncTelegramOnBoot() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(client, "https://api.telegram.org/bot" + BOT_TOKEN + "/getUpdates?offset=-1&limit=1&timeout=0")) return false;
  int code = http.GET();
  bool ok = false;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString()) && doc["ok"].as<bool>()) {
      JsonArray updates = doc["result"].as<JsonArray>();
      if (!updates.isNull() && updates.size() > 0) lastUpdateId = updates[updates.size() - 1]["update_id"].as<long>();
      ok = true;
      Serial.println("[TG] Old Telegram commands skipped on boot.");
    }
  }
  if (!ok) Serial.printf("[TG] Startup sync failed (HTTP %d); outputs remain OFF.\n", code);
  http.end();
  return ok;
}

void checkTelegram() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  String url = "https://api.telegram.org/bot" + BOT_TOKEN + "/getUpdates?offset=" + String(lastUpdateId + 1) + "&limit=5&timeout=0";
  if (!http.begin(client, url)) return;
  int code = http.GET();

  String commands[5];
  int commandCount = 0;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString()) && doc["ok"].as<bool>()) {
      for (JsonObject update : doc["result"].as<JsonArray>()) {
        long id = update["update_id"].as<long>();
        if (id > lastUpdateId) lastUpdateId = id;
        JsonVariant msg = update["message"];
        if (msg.isNull()) continue;
        String chat = msg["chat"]["id"].as<String>();
        String sender = msg["from"]["id"].as<String>();
        String content = msg["text"].as<String>();
        if (chat == TELEGRAM_CHAT_ID && sender == TELEGRAM_CHAT_ID && content.length() > 0) {
          if (commandCount < 5) commands[commandCount++] = content;
        } else {
          Serial.println("[TG] Ignored message outside the authorized private chat.");
        }
      }
    } else {
      Serial.println("[TG] Could not parse Telegram response.");
    }
  } else {
    Serial.printf("[TG] getUpdates HTTP error: %d (409 may mean a webhook is enabled)\n", code);
  }
  http.end();
  for (int i = 0; i < commandCount; ++i) commandReceived(commands[i]);
}

// ---------- Safety + timers ----------

void checkSafetyAndTimers() {
  bool low = reservoirLow();
  if (low && (pump.on || mist.on)) {
    stopWet("safety");
    alert("safety_stop", "SAFETY STOP: LOW water. Pump and mist switched OFF.");
  }

  if (low != lastFloatLow) {
    lastFloatLow = low;
    if (low) alert("reservoir_low", "ALERT: Reservoir LOW. Wet actuators locked.");
    else alert("reservoir_ok", "Reservoir level restored to NORMAL.");
    postReading();
    lastReport = millis();
  }

  RelayState* relays[] = {&light, &mist, &pump};
  for (RelayState* relay : relays) {
    if (relay->on && millis() - relay->started >= relay->duration) {
      setRelay(*relay, false, "timer");
      sendTelegram(String(relay->name) + " auto-OFF (timer finished).");
    }
  }
}

// ---------- Main ----------

void setup() {
  Serial.begin(115200);
  delay(400);

  // FIRST: relays inactive before anything else. Active-LOW board: HIGH = OFF.
  digitalWrite(PIN_MIST, HIGH);
  digitalWrite(PIN_LIGHT, HIGH);
  digitalWrite(PIN_PUMP, HIGH);
  pinMode(PIN_MIST, OUTPUT);
  pinMode(PIN_LIGHT, OUTPUT);
  pinMode(PIN_PUMP, OUTPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("PECH-EYE BOOTING");

  pinMode(PIN_FLOAT, INPUT);
  pinMode(PIN_SOIL, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);
  dht.begin();
  lastFloatLow = reservoirLow();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(SECRET_WIFI_SSID, SECRET_WIFI_PASS);
  lastWifiAttempt = millis();
  Serial.println("[BOOT] All relays OFF. Starting Wi-Fi...");
}

void loop() {
  maintainWifi();
  checkSafetyAndTimers();

  if (millis() - lastLcdUpdate >= LCD_UPDATE_MS) {
    lastLcdUpdate = millis();
    updateLCD();
  }

  bool online = WiFi.status() == WL_CONNECTED;
  if (online && !telegramSynced) telegramSynced = syncTelegramOnBoot();

  if (online && telegramSynced && !startupSent) {
    alert("online", "PECH-EYE controller ONLINE. All relays OFF. Send /help.");
    startupSent = true;
    postReading();
    lastReport = millis();
  }

  if (online && telegramSynced && millis() - lastTelegramPoll >= TELEGRAM_POLL_MS) {
    lastTelegramPoll = millis();
    checkTelegram();
  }

  if (online && millis() - lastReport >= REPORT_MS) {
    lastReport = millis();
    postReading();
  }
  delay(25);
}
