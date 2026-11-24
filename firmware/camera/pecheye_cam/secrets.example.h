// Copy this file to "secrets.h" (same folder) and fill in your real values.
// secrets.h is gitignored - never commit it.
#pragma once

#define SECRET_WIFI_SSID   "YOUR_WIFI_NAME"
#define SECRET_WIFI_PASS   "YOUR_WIFI_PASSWORD"
// Dashboard server (photos are uploaded here), e.g. "https://your-app.vercel.app"
#define SECRET_SERVER_URL  "https://YOUR_APP.vercel.app"
// Must equal DEVICE_API_KEY on the server
#define SECRET_API_KEY     "change-me"
// Supabase -> Project Settings -> API Keys. Use the PUBLISHABLE (or legacy "anon") key,
// NOT the secret / service_role key. It can only call camera_poll().
#define SECRET_SUPABASE_URL "https://YOUR_PROJECT.supabase.co"
#define SECRET_SUPABASE_KEY "sb_publishable_..."
