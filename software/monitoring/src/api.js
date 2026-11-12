const PW_KEY = "pecheye_pw";
const getPw = () => { try { return localStorage.getItem(PW_KEY) || ""; } catch { return ""; } };

async function req(url, opts = {}, retried = false) {
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, "x-dashboard-password": getPw() } });
  if (r.status === 401 && !retried) {
    const p = window.prompt("Dashboard password");
    if (p === null) throw new Error("Password required");
    try { localStorage.setItem(PW_KEY, p); } catch { /* ignore */ }
    return req(url, opts, true);
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
