// Minimal service worker so browsers offer "Install app". It does not cache anything:
// every request goes to the network as usual, so the dashboard always shows live data
// and a new deploy shows up on the next load.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
