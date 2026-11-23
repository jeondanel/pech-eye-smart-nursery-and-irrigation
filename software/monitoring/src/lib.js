import { useCallback, useEffect, useState } from "react";

/* ---------- formatting ---------- */

export const fmt = (v, unit = "", digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Number(v).toFixed(digits)}${unit}`);
export const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const clockTimeSec = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const longDate = (d) => new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
export const fullDate = (d) => new Date(d).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
export const shortDate = (d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
export const every = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
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

// Same rules as the controller's irrigation decision.
export function irrigationDecision(w, r) {
  if (!w || !r) return { tone: "grey", icon: "hourglass_top", title: "Irrigation decision pending", text: "Waiting for weather and sensor data." };
  if (w.rain_chance_24h >= 50 || w.rain_1h > 0.5)
    return { tone: "info", icon: "rainy", title: "Irrigation deferred: rain expected", text: `Rain chance ${Math.round(w.rain_chance_24h ?? 0)}% in the next 24 h. Outdoor irrigation is locked out.` };
  if (r.temperature > 32 && r.humidity < 60)
    return { tone: "warn", icon: "heat", title: "Heat stress: misting recommended", text: `Chamber is ${fmt(r.temperature, "°C")} at ${fmt(r.humidity, "%")} humidity.` };
  return { tone: "ok", icon: "check_circle", title: "Irrigation permitted", text: "Clear weather. Normal irrigation schedule allowed." };
}

/* ---------- hooks ---------- */

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function usePoll(fn, deps, ms = 10000) {
  const [state, set] = useState({ data: null, error: null });
  const run = useCallback(() => fn().then((data) => set({ data, error: null })).catch((error) => set((s) => ({ ...s, error }))), deps); // eslint-disable-line
  useEffect(() => { run(); const t = setInterval(run, ms); return () => clearInterval(t); }, [run, ms]);
  return { ...state, reload: run };
}

// Tiny hash router: "#/photos?batch=3" -> { page: "photos", sub: undefined, params: { batch: "3" } }
export function useRoute() {
  const parse = () => {
    const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
    const [page = "home", sub] = path.split("/");
    return { page: page || "home", sub, params: Object.fromEntries(new URLSearchParams(query)) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const h = () => { setRoute(parse()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}
