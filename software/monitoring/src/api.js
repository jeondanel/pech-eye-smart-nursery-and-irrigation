const PW_KEY = "pecheye_pw";
const getPw = () => { try { return localStorage.getItem(PW_KEY) || ""; } catch { return ""; } };
export const setPw = (p) => { try { localStorage.setItem(PW_KEY, p); } catch { /* ignore */ } };

// On 401 we tell the app to show its login screen (see App.jsx) instead of a browser prompt.
async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, "x-dashboard-password": getPw() } });
  if (r.status === 401) {
    window.dispatchEvent(new CustomEvent("pecheye-auth", { detail: { hadPassword: !!getPw() } }));
    throw new Error("Password required");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const post = (url, body) =>
  req(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

export const api = {
  dashboard: (batch) => req(`/api/dashboard${batch ? `?batch=${batch}` : ""}`),
  readings: (batch) => req(`/api/readings${batch ? `?batch=${batch}` : ""}`),
  images: (batch) => req(`/api/images${batch ? `?batch=${batch}` : ""}`),
  batches: () => req("/api/batches"),
  analyze: (id) => post(`/api/images/${id}/analyze`),
  transplant: (id, notes) => post(`/api/batches/${id}/transplant`, { notes }),
  newBatch: (name) => post("/api/batches", { name }),
};
