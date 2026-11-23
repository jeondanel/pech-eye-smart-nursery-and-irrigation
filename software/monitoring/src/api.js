// The password is kept in memory only, so it is asked again every time the app is opened or reloaded.
let password = "";
export const setPw = (p) => { password = p; };
try { localStorage.removeItem("pecheye_pw"); } catch { /* older versions saved it here */ }

// On 401 we tell the app to show its login screen (see App.jsx).
async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, "x-dashboard-password": password } });
  if (r.status === 401) {
    window.dispatchEvent(new Event("pecheye-auth"));
    throw new Error("Password required");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const post = (url, body) =>
  req(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
const q = (batch) => (batch ? `?batch=${batch}` : "");

export const api = {
  session: () => req("/api/session"),
  dashboard: () => req("/api/dashboard"),
  readings: (batch) => req(`/api/readings${q(batch)}`),
  history: (days) => req(`/api/history?days=${days}`),
  images: (batch) => req(`/api/images${q(batch)}`),
  batches: () => req("/api/batches"),
  requestPhoto: () => post("/api/camera/capture"),
  cancelPhoto: () => post("/api/camera/cancel"),
  analyze: (id) => post(`/api/images/${id}/analyze`),
  startBatch: () => post("/api/batches"),
  transplant: (id) => post(`/api/batches/${id}/transplant`),
  stopBatch: (id, notes) => post(`/api/batches/${id}/stop`, { notes }),
};
