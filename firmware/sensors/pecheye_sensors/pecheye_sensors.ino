#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"
#include "secrets.h"

// --- STRUCTS (Placed first so the compiler recognizes the type everywhere) ---
struct WeatherData {
  float temp;
  int humidity;
  float precip;
  int rainProb;
  bool valid;
};

// --- WI-FI CREDENTIALS ---
// All credentials live in secrets.h (copy secrets.example.h -> secrets.h)
const char* ssid     = SECRET_WIFI_SSID;
const char* password = SECRET_WIFI_PASS;

// --- TELEGRAM BOT CREDENTIALS ---
const String botToken         = SECRET_BOT_TOKEN;
const String authorizedChatId = SECRET_CHAT_ID;

// --- MONITORING SERVER (same one the camera node posts to) ---
const String serverUrl = SECRET_SERVER_URL;
const String apiKey    = SECRET_API_KEY;
const unsigned long reportInterval = 5UL * 60UL * 1000UL;  // log a reading every 5 min
unsigned long lastReport = 0;

// --- PINS ---
#define DHTPIN 5
#define DHTTYPE DHT11
#define FLOAT_PIN 4

DHT dht(DHTPIN, DHTTYPE);

// Open-Meteo URL targeting QCU San Bartolome, Novaliches (Lat 14.7011, Lon 121.0366)
const char* weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=14.7011&longitude=121.0366&current=temperature_2m,relative_humidity_2m,precipitation&hourly=precipitation_probability&forecast_days=1&timezone=Asia%2FManila";

int lastFloatState = -1;
long lastMessageOffset = 0;
unsigned long lastTelegramPoll = 0;
const unsigned long pollInterval = 1500;

// DHT11 returns NaN on a failed read; show that clearly instead of "nan"
String fmtSensor(float v, const char* unit) {
  return isnan(v) ? String("sensor error") : String(v, 1) + " " + unit;
}

// Log a reading to the monitoring server (shows up on the dashboard)
bool postReading() {
  if (WiFi.status() != WL_CONNECTED) return false;
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  JsonDocument doc;
  if (!isnan(t)) doc["temperature"] = t;
  if (!isnan(h)) doc["humidity"] = h;
  doc["reservoir_low"] = isReservoirLow();
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl + "/api/ingest/reading");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", apiKey);
  int code = http.POST(body);
  http.end();
  Serial.printf("[Server] POST reading -> %d\n", code);
  return code == 200;
}

// Reusable function to dispatch messages (with or without custom keyboard)
void sendTelegram(String text, bool includeKeyboard = false) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  String url = "https://api.telegram.org/bot" + botToken + "/sendMessage";

  if (https.begin(client, url)) {
    https.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    doc["chat_id"] = authorizedChatId;
    doc["text"] = text;
    doc["parse_mode"] = "Markdown";

    if (includeKeyboard) {
      JsonObject replyMarkup = doc["reply_markup"].to<JsonObject>();
      JsonArray keyboard = replyMarkup["keyboard"].to<JsonArray>();
      replyMarkup["resize_keyboard"] = true;
      replyMarkup["one_time_keyboard"] = false;

      // Row 1
      JsonArray row1 = keyboard.add<JsonArray>();
      row1.add("🌡 Climate");
      row1.add("🌦 Weather");

      // Row 2
      JsonArray row2 = keyboard.add<JsonArray>();
      row2.add("💧 Reservoir");
      row2.add("📊 System Status");
    }

    String requestBody;
    serializeJson(doc, requestBody);

    https.POST(requestBody);
    https.end();
  }
}

// Fetch external weather for QCU Novaliches
WeatherData getExternalWeather() {
  WeatherData data = {0.0, 0, 0.0, 0, false};
  if (WiFi.status() != WL_CONNECTED) return data;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  if (https.begin(client, weatherUrl)) {
    int code = https.GET();
    if (code == HTTP_CODE_OK) {
      String payload = https.getString();
      https.end();

      JsonDocument doc;
      deserializeJson(doc, payload);

      data.temp = doc["current"]["temperature_2m"];
      data.humidity = doc["current"]["relative_humidity_2m"];
      data.precip = doc["current"]["precipitation"];
      // hourly[] starts at 00:00 local time; pick the current hour ("2026-11-12T14:15" -> 14)
      int hour = String((const char*)doc["current"]["time"]).substring(11, 13).toInt();
      data.rainProb = doc["hourly"]["precipitation_probability"][hour];
      data.valid = true;
    }
    https.end();
  }
  return data;
}

// Logic rules for irrigation authorization
String evaluateIrrigationDecision(WeatherData w, float chamberTemp, float chamberHum) {
  if (!w.valid) {
    return "[FALLBACK MODE] External weather unreachable. Relying strictly on local sensors.";
  }

  // Pechay nursery cultivation thresholds
  if (w.rainProb >= 50 || w.precip > 0.5) {
    return "LOCKOUT: High rain risk at QCU Novaliches (" + String(w.rainProb) + "% prob). External irrigation deferred.";
  }

  if (!isnan(chamberTemp) && !isnan(chamberHum) && chamberTemp > 32.0 && chamberHum < 60.0) {
    return "OVERRIDE: Chamber heat stress detected (" + String(chamberTemp, 1) + " C). Fogging / misting recommended.";
  }

  return "PERMITTED: Clear weather (" + String(w.rainProb) + "% rain prob). Normal irrigation schedule allowed.";
}

// Float Switch Orientation:
// Horizontal / Straight (HIGH) = LOW / REFILL NEEDED
// Angled / Bent 90 deg (LOW)   = NORMAL LEVEL
bool isReservoirLow() {
  return digitalRead(FLOAT_PIN) == HIGH;
}

void handleIncomingCommand(String cmd) {
  cmd.trim();
  Serial.print("[Telegram RX] Command: ");
  Serial.println(cmd);

  if (cmd == "/start" || cmd == "/help" || cmd == "Menu") {
    String msg = "*PECH-EYE Node 2 Console*\nLocation: QCU San Bartolome\nSelect an option using the keyboard below.";
    sendTelegram(msg, true);
  }
  else if (cmd == "/climate" || cmd == "🌡 Climate") {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    String msg = "*Nursery Chamber (DHT11)*\n";
    msg += "Temperature: " + fmtSensor(t, "°C") + "\n";
    msg += "Relative Humidity: " + fmtSensor(h, "%");
    sendTelegram(msg, true);
  }
  else if (cmd == "/weather" || cmd == "🌦 Weather") {
    WeatherData w = getExternalWeather();
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (w.valid) {
      String msg = "*Weather Forecast (QCU Novaliches)*\n";
      msg += "Outdoor Temp: " + String(w.temp, 1) + " °C\n";
      msg += "Outdoor Humidity: " + String(w.humidity) + " %\n";
      msg += "Precipitation: " + String(w.precip, 2) + " mm\n";
      msg += "Rain Probability (1h): " + String(w.rainProb) + " %\n\n";
      msg += "*Decision Engine:*\n" + evaluateIrrigationDecision(w, t, h);
      sendTelegram(msg, true);
    } else {
      sendTelegram("Error: Unable to fetch weather data from endpoint.", true);
    }
  }
  else if (cmd == "/reservoir" || cmd == "💧 Reservoir") {
    String msg = "*Mist Reservoir Status*\n";
    if (isReservoirLow()) {
      msg += "Level: LOW (Float horizontal - Refill needed)";
    } else {
      msg += "Level: NORMAL (Float angled down - Water sufficient)";
    }
    sendTelegram(msg, true);
  }
  else if (cmd == "/status" || cmd == "📊 System Status") {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    WeatherData w = getExternalWeather();

    String msg = "*Master System Status*\n";
    msg += "Node: Outdoor Gateway (QCU)\n";
    msg += "Chamber Temp: " + fmtSensor(t, "°C") + "\n";
    msg += "Chamber Hum: " + fmtSensor(h, "%") + "\n";
    msg += "Reservoir: " + String(isReservoirLow() ? "LOW (REFILL)" : "NORMAL") + "\n";
    msg += "Rain Risk: " + String(w.valid ? String(w.rainProb) + " %" : "N/A") + "\n";
    msg += "Decision: " + evaluateIrrigationDecision(w, t, h) + "\n";
    msg += "Wi-Fi RSSI: " + String(WiFi.RSSI()) + " dBm\n";
    msg += "Uptime: " + String(millis() / 1000) + "s";
    sendTelegram(msg, true);
  }
  else {
    sendTelegram("Unknown command. Tap a button below.", true);
  }
}

void checkTelegramMessages() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = "https://api.telegram.org/bot" + botToken + "/getUpdates?offset=" + String(lastMessageOffset + 1) + "&limit=1";

  if (https.begin(client, url)) {
    int code = https.GET();
    if (code == HTTP_CODE_OK) {
      String payload = https.getString();
      JsonDocument doc;
      deserializeJson(doc, payload);

      if (doc["ok"] == true && doc["result"].size() > 0) {
        long updateId = doc["result"][0]["update_id"];
        lastMessageOffset = updateId;

        String senderId = doc["result"][0]["message"]["from"]["id"].as<String>();
        JsonVariant textVar = doc["result"][0]["message"]["text"];

        if (textVar.isNull()) {
          // photo, sticker, edited message, etc. - nothing to do
        } else if (senderId == authorizedChatId) {
          String text = textVar.as<String>();
          handleIncomingCommand(text);
        } else {
          Serial.println("[Security] Blocked unauthorized message.");
        }
      }
    }
    https.end();
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(FLOAT_PIN, INPUT_PULLUP);
  dht.begin();

  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[OK] Connected to Wi-Fi!");

  // Start from the real float state so boot doesn't trigger a false "restored" alert
  lastFloatState = digitalRead(FLOAT_PIN);
  String hello = "*PECH-EYE Gateway Online*\nLocation: QCU San Bartolome\n";
  hello += isReservoirLow() ? "Reservoir: LOW (refill needed)\n" : "Reservoir: NORMAL\n";
  hello += "Tap a button to query:";
  sendTelegram(hello, true);

  dht.readTemperature();  // first DHT11 read after power-up is often stale
  delay(2000);
  postReading();
  lastReport = millis();
}

void loop() {
  // 1. Poll incoming Telegram messages
  if (millis() - lastTelegramPoll >= pollInterval) {
    lastTelegramPoll = millis();
    checkTelegramMessages();
  }

  // 2. Float switch state check
  int currentFloat = digitalRead(FLOAT_PIN);
  if (currentFloat != lastFloatState) {
    lastFloatState = currentFloat;
    if (isReservoirLow()) {
      sendTelegram("ALERT: Reservoir level is LOW. Mist pump cutoff active.", true);
    } else {
      sendTelegram("UPDATE: Reservoir level restored to NORMAL.", true);
    }
    postReading();  // log the change immediately
    lastReport = millis();
  }

  // 3. Periodic reading -> monitoring server
  if (millis() - lastReport >= reportInterval) {
    lastReport = millis();
    postReading();
  }
}
