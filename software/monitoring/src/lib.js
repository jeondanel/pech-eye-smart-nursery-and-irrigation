import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- formatting ---------- */

export const fmt = (v, unit = "", digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Number(v).toFixed(digits)}${unit}`);
export const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const clockTimeSec = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const longDate = (d) => new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
export const fullDate = (d) => new Date(d).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
export const shortDate = (d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
export const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
export const water = (ml) => (ml == null ? "—" : ml >= 1000 ? `${(ml / 1000).toFixed(2)} L` : `${Math.round(ml)} mL`);

// "NOVEMBER 1 - 7, 2026" / "OCTOBER 28 - NOVEMBER 3, 2026"
export function rangeLabel(from, to) {
  const a = new Date(from), b = new Date(to);
  const m = (d) => d.toLocaleDateString([], { month: "long" });
  const left = `${m(a)} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${m(b)} ${b.getDate()}`;
  return `${left} - ${right}, ${b.getFullYear()}`.toUpperCase();
}

/* ---------- days ---------- */

export const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const dayKey = (d) => midnight(d).getTime();
// Transplanting is allowed from this batch day (the server checks it too).
export const MIN_TRANSPLANT_DAY = 10;

// Calendar days since the batch started (local time): the start date is Day 1.
export const dayOf = (start, at = Date.now()) => Math.max(1, Math.round((midnight(at) - midnight(start)) / 86400000) + 1);

/* ---------- sensors ---------- */

// Thresholds for the "Status" column and warning colors.
export const SENSORS = {
  temperature: { key: "temperature", title: "Temperature", unit: "°C", low: 18, high: 32, labels: ["Low", "Normal", "High"] },
  humidity: { key: "humidity", title: "Humidity", unit: "%", low: 60, high: 90, labels: ["Low", "Normal", "High"] },
  soil: { key: "soil_moisture", title: "Soil Moisture", unit: "%", low: 35, high: 85, labels: ["Dry", "Normal", "Wet"] },
};

export function sensorStatus(cfg, v) {
  if (v == null) return null;
  if (v < cfg.low) return { label: cfg.labels[0], tone: "low" };
  if (v > cfg.high) return { label: cfg.labels[2], tone: "high" };
  return { label: cfg.labels[1], tone: "normal" };
}

// Plain-words rain status from the current precipitation (mm in the last hour) and the
// highest forecast chance of rain in the next 24 h. Rates follow the usual light / moderate / heavy bands.
export function rainStatus(w) {
  if (!w) return null;
  const mm = w.rain_1h ?? 0, chance = w.rain_chance_24h;
  if (mm >= 7.6) return { text: "Heavy rain right now", tone: "info" };
  if (mm >= 2.5) return { text: "Raining right now", tone: "info" };
  if (mm > 0) return { text: "Light rain right now", tone: "info" };
  if (chance == null) return { text: "Not raining", tone: "" };
  if (chance >= 70) return { text: "Rain likely later", tone: "info" };
  if (chance >= 30) return { text: "Rain possible later", tone: "" };
  if (chance > 0) return { text: "Low chance of rain", tone: "" };
  return { text: "No rain expected", tone: "" };
}

/* ---------- theme (light is the default) ---------- */

const THEME_KEY = "pecheye_theme";
export const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; } };
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  window.dispatchEvent(new Event("pecheye-theme"));
}
export function useTheme() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || "light");
  useEffect(() => {
    const h = () => setT(document.documentElement.dataset.theme);
    window.addEventListener("pecheye-theme", h);
    return () => window.removeEventListener("pecheye-theme", h);
  }, []);
  return t;
}

// Chart colors per theme (SVG attributes can't use CSS variables).
const CHART = {
  light: {
    lines: ["#518123", "#88B43A", "#A47B12"], bars: ["#B6D455", "#518123"], dot: "#518123",
    tick: "#5f6b5a", axis: "#cfd8c6", cursor: "rgba(0,0,0,.04)",
    tooltip: { background: "#fff", border: "1px solid #dde5d3", borderRadius: 10, color: "#1b2614", fontFamily: "Poppins" },
  },
  dark: {
    lines: ["#B6D455", "#8ABB63", "#DFF3A0"], bars: ["#DFF3A0", "#88B43A"], dot: "#fff",
    tick: "#9aa894", axis: "#3a463a", cursor: "rgba(255,255,255,.04)",
    tooltip: { background: "#1f2820", border: "1px solid #2f3b2f", borderRadius: 10, color: "#eef3e6", fontFamily: "Poppins" },
  },
};
export const useChart = () => CHART[useTheme()];

/* ---------- hooks ---------- */

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Last response per poll key, kept in memory for this tab only (cleared when the app locks).
// Reopening a page shows it instantly while a fresh copy is fetched in the background.
const pollCache = new Map();
export const clearPollCache = () => pollCache.clear();

// Fetches fn() now and every ms; `key` names the request (change it when fn's inputs change).
// Polling pauses while the browser tab is hidden and refreshes as soon as it is visible again.
export function usePoll(key, fn, ms = 10000) {
  const fresh = () => ({ key, data: pollCache.get(key) ?? null, error: null });
  const [state, set] = useState(fresh);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(() => fnRef.current()
    .then((data) => { pollCache.set(key, data); set({ key, data, error: null }); })
    .catch((error) => set((s) => ({ ...(s.key === key ? s : fresh()), error }))), [key]); // eslint-disable-line
  useEffect(() => {
    let t = null;
    const start = () => { clearInterval(t); t = null; if (!document.hidden) { run(); t = setInterval(run, ms); } };
    start();
    document.addEventListener("visibilitychange", start);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", start); };
  }, [run, ms]);
  const view = state.key === key ? state : fresh(); // key just changed: show its cached copy, if any
  return { data: view.data, error: view.error, reload: run };
}

// Tiny hash router: "#/photos?batch=3" -> { page: "photos", sub: undefined, params: { batch: "3" } }
export function useRoute() {
  const parse = () => {
    const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
    const [page = "dashboard", sub] = path.split("/");
    return { page: page || "dashboard", sub, params: Object.fromEntries(new URLSearchParams(query)) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const h = () => { setRoute(parse()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}
