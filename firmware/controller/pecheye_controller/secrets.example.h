// Copy this file to "secrets.h" (same folder) and fill in your real values.
// secrets.h is gitignored - never commit it.
#pragma once

#define SECRET_WIFI_SSID   "YOUR_WIFI_NAME"
#define SECRET_WIFI_PASS   "YOUR_WIFI_PASSWORD"
// Dashboard server: your Vercel URL (https://your-app.vercel.app) or a local PC (http://192.168.1.50:3001)
#define SECRET_SERVER_URL  "https://your-app.vercel.app"
// Must equal DEVICE_API_KEY on the server
#define SECRET_API_KEY     "change-me"

// Telegram bot (@BotFather) and your private chat ID. Only this chat can send commands.
#define SECRET_BOT_TOKEN   "YOUR_BOT_TOKEN_HERE"
#define SECRET_CHAT_ID     "YOUR_CHAT_ID_HERE"
