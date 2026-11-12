import express from "express";
import { waitUntil } from "@vercel/functions";
import { sb, BUCKET, ok, fetchAll, imageUrl, activeBatch } from "./supabase.js";
import { analyzeTray } from "./analyzer.js";
import { sendPhoto, sendMessage } from "./telegram.js";
import { ensureWeather } from "./weather.js";

const app = express();
// NOTE: no body-parser middleware on purpose. Vercel may or may not pre-parse bodies,
// so rawBody() below handles both cases.

const MOUNT_HEIGHT = Number(process.env.MOUNT_HEIGHT_CM || 30);
const h = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });
const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  try { return JSON.parse((await rawBody(req)).toString() || "{}"); } catch { return {}; }
}

const deviceAuth = (req, res, next) => {
  const expected = process.env.DEVICE_API_KEY;
  if (!expected || req.header("x-api-key") !== expected) return res.status(401).json({ error: "bad api key" });
  next();
};
const dashAuth = (req, res, next) => {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.header("x-dashboard-password") !== pw) return res.status(401).json({ error: "password required" });
  next();
};

const withUrl = (r) => ({ ...r, url: imageUrl(r.file) });

async function saveAnalysis(id, a) {
  ok(await sb.from("images").update({
    analysis: a, ready_cells: a.ready_cells, occupied_cells: a.occupied_cells,
    total_cells: a.total_cells, canopy_pct: a.canopy_pct, ready: a.ready,
  }).eq("id", id));
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- Device ingest (ESP32) ----------

app.post("/api/ingest/image", deviceAuth, h(async (req, res) => {
  const buf = await rawBody(req);
  if (buf.length < 100) return res.status(400).json({ error: "send a JPEG body" });
  const batch = await activeBatch();
  const ts = new Date().toISOString();
  const file = `${batch.id}/${ts.replace(/[:.]/g, "-")}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(file, buf, { contentType: "image/jpeg" });
  if (up.error) throw new Error(up.error.message);
  const row = ok(await sb.from("images").insert({ batch_id: batch.id, ts, file }).select().single());
  res.json({ ok: true, id: row.id });

  // Runs after the response; waitUntil keeps the serverless function alive for it.
  waitUntil((async () => {
    let caption = `PECH-EYE ${batch.name} - ${new Date(ts).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`;
    const w = await ensureWeather();
    if (w) caption += `\n🌤 Outdoor ${w.temp?.toFixed(1)}°C, ${w.humidity}% RH, rain chance ${Math.round(w.rain_chance_24h ?? 0)}% (${w.description})`;
    if (req.query.analyze !== "0") {
      try {
        const a = await analyzeTray(buf);
        await saveAnalysis(row.id, a);
        caption += `\nReady: ${a.ready_cells}/${a.occupied_cells} plants (${Math.round(a.ready_ratio * 100)}%)`;
        if (a.ready) caption += "\n✅ Tray looks READY for transplantation!";
      } catch (e) { console.error("analysis failed:", e.message); }
    }
    await sendPhoto(buf, caption).catch((e) => console.error("telegram failed:", e.message));
  })());
}));

// JSON {soil_moisture, humidity, temperature, distance_cm, reservoir_low}; every field optional.
app.post("/api/ingest/reading", deviceAuth, h(async (req, res) => {
  const b = await jsonBody(req);
  const batch = await activeBatch();
  const distance = num(b.distance_cm);
  const height = distance === null ? null : Math.max(0, +(MOUNT_HEIGHT - distance).toFixed(1));
  ok(await sb.from("readings").insert({
    batch_id: batch.id, soil_moisture: num(b.soil_moisture), humidity: num(b.humidity),
    temperature: num(b.temperature), distance_cm: distance, height_cm: height,
    reservoir_low: typeof b.reservoir_low === "boolean" ? b.reservoir_low : null,
  }));
  await ensureWeather(); // keeps the outdoor weather log growing alongside sensor data
  res.json({ ok: true });
}));

// ---------- Dashboard (password protected) ----------
app.use("/api", dashAuth);

app.post("/api/images/:id/analyze", h(async (req, res) => {
  const row = ok(await sb.from("images").select("*").eq("id", req.params.id).single());
  const img = await fetch(imageUrl(row.file));
  const a = await analyzeTray(Buffer.from(await img.arrayBuffer()));
  await saveAnalysis(row.id, a);
  res.json(withUrl(ok(await sb.from("images").select("*").eq("id", row.id).single())));
}));

app.get("/api/dashboard", h(async (req, res) => {
  const batch = req.query.batch
    ? ok(await sb.from("batches").select("*").eq("id", req.query.batch).single())
    : await activeBatch();
  const [lr, recent, cnt, weather] = await Promise.all([
    sb.from("readings").select("*").eq("batch_id", batch.id).order("ts", { ascending: false }).limit(1),
    sb.from("images").select("*").eq("batch_id", batch.id).order("ts", { ascending: false }).limit(12),
    sb.from("images").select("id", { count: "exact", head: true }).eq("batch_id", batch.id),
    batch.status === "growing" ? ensureWeather() : null,
  ]);
  const recentImages = ok(recent).map(withUrl);
  res.json({
    batch,
    daysGrowing: Math.max(0, (new Date(batch.ended_at || Date.now()) - new Date(batch.started_at)) / 86400000),
    latestReading: ok(lr)[0] || null,
    recentImages,
    latestAnalyzed: recentImages.find((i) => i.analysis) || null,
    imageCount: cnt.count || 0,
    weather,
  });
}));

app.get("/api/readings", h(async (req, res) => {
  const id = req.query.batch || (await activeBatch()).id;
  const rows = await fetchAll((a, b) => sb.from("readings").select("*").eq("batch_id", id).order("ts").range(a, b));
  const step = Math.ceil(rows.length / 500) || 1; // downsample for fast charts
  res.json(rows.filter((_, i) => i % step === 0));
}));

app.get("/api/images", h(async (req, res) => {
  const id = req.query.batch || (await activeBatch()).id;
  const rows = ok(await sb.from("images").select("*").eq("batch_id", id).order("ts", { ascending: false }).limit(100));
  res.json(rows.map(withUrl));
}));

app.get("/api/batches", h(async (_req, res) => {
  res.json(ok(await sb.from("batches").select("*").order("id", { ascending: false })));
}));

app.post("/api/batches", h(async (req, res) => {
  const b = await jsonBody(req);
  const growing = ok(await sb.from("batches").select("id").eq("status", "growing"));
  if (growing.length) return res.status(409).json({ error: "A batch is still growing. Transplant it first." });
  const { count } = await sb.from("batches").select("id", { count: "exact", head: true });
  res.json(ok(await sb.from("batches").insert({ name: b.name || `Batch ${(count || 0) + 1}` }).select().single()));
}));

async function buildSummary(batch, endedAt) {
  const r1 = (v) => (v === null || v === undefined ? null : +Number(v).toFixed(1));
  const [stats, wx, imgs, last] = await Promise.all([
    sb.rpc("batch_stats", { p_batch: batch.id }),
    sb.rpc("weather_stats", { p_from: batch.started_at, p_to: endedAt }),
    sb.from("images").select("id", { count: "exact", head: true }).eq("batch_id", batch.id),
    sb.from("images").select("ready_cells, occupied_cells, total_cells, canopy_pct").eq("batch_id", batch.id)
      .not("analysis", "is", null).order("ts", { ascending: false }).limit(1),
  ]);
  const s = ok(stats), w = ok(wx);
  const ms = new Date(endedAt) - new Date(batch.started_at);
  return {
    started_at: batch.started_at, ended_at: endedAt,
    duration_days: r1(ms / 86400000), duration_hours: r1(ms / 3600000),
    readings: s.n, images: imgs.count || 0,
    avg_humidity: r1(s.avg_humidity), min_humidity: r1(s.min_humidity), max_humidity: r1(s.max_humidity),
    avg_soil_moisture: r1(s.avg_soil), min_soil_moisture: r1(s.min_soil), max_soil_moisture: r1(s.max_soil),
    avg_temperature: r1(s.avg_temp), avg_height_cm: r1(s.avg_height), max_height_cm: r1(s.max_height),
    outdoor_avg_temp: r1(w.avg_temp), outdoor_avg_humidity: r1(w.avg_humidity),
    outdoor_avg_rain_chance: r1(w.avg_rain_chance), outdoor_max_rain_1h: r1(w.max_rain_1h),
    final_analysis: ok(last)[0] || null,
  };
}

app.get("/api/batches/:id/summary", h(async (req, res) => {
  const b = ok(await sb.from("batches").select("*").eq("id", req.params.id).single());
  res.json(b.summary || (await buildSummary(b, b.ended_at || new Date().toISOString())));
}));

// Closes the batch: freezes the logs and stores the overall summary.
app.post("/api/batches/:id/transplant", h(async (req, res) => {
  const body = await jsonBody(req);
  const b = ok(await sb.from("batches").select("*").eq("id", req.params.id).single());
  if (b.status !== "growing") return res.status(409).json({ error: "already transplanted" });
  const endedAt = new Date().toISOString();
  const summary = await buildSummary(b, endedAt);
  ok(await sb.from("batches").update({ status: "transplanted", ended_at: endedAt, summary, notes: body.notes || b.notes }).eq("id", b.id));
  waitUntil(sendMessage(`🌱 ${b.name} transplanted after ${summary.duration_days} days. Avg humidity ${summary.avg_humidity}%, avg soil moisture ${summary.avg_soil_moisture}%.`).catch(() => {}));
  res.json(summary);
}));

export default app;
