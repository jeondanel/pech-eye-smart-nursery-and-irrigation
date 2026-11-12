// Copy this file to "secrets.h" (same folder) and fill in your real values.
// secrets.h is gitignored - never commit it.
#pragma once

#define SECRET_WIFI_SSID   "YOUR_WIFI_NAME"
#define SECRET_WIFI_PASS   "YOUR_WIFI_PASSWORD"
// IP of the PC/server running software/monitoring (same Wi-Fi). Find with `ipconfig`.
#define SECRET_SERVER_URL  "http://192.168.1.50:3001"
// Must equal DEVICE_API_KEY in the server .env.local
#define SECRET_API_KEY     "change-me"
