import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { sb, BUCKET, ok, fetchAll, imageUrl, activeBatch } from "./supabase.js";
import { analyzeTray } from "./analyzer.js";
import { sendPhoto, sendMessage } from "./telegram.js";
import { ensureWeather } from "./weather.js";

const app = express();
// NOTE: no body-parser middleware on purpose. Vercel may or may not pre-parse bodies,
// so rawBody() below handles both cases.

// Flow rates used to estimate water use from relay ON time (measure: run 60 s into a cup).
const ML_PER_MIN = { mist: Number(process.env.MIST_ML_PER_MIN || 0), pump: Number(process.env.PUMP_ML_PER_MIN || 0) };
// Unexpected errors: full details go to the server log only; the browser gets a generic message.
// (Expected problems are answered with 4xx and a plain-words message in the route itself.)
const h = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(`${req.method} ${req.path}:`, e);
  res.status(500).json({ error: "Server error. Please try again." });
});
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

// Values pasted into Vercel often carry stray spaces/newlines/quotes, so compare them trimmed.
const clean = (v) => String(v ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
// Constant-time compare (hashing first makes both sides the same length), so response
// timing does not reveal how much of a guess was right.
const sha = (v) => createHash("sha256").update(v).digest();
const sameSecret = (given, expected) => expected !== "" && timingSafeEqual(sha(clean(given)), sha(expected));

const deviceAuth = (req, res, next) => {
  if (!sameSecret(req.header("x-api-key"), clean(process.env.DEVICE_API_KEY))) return res.status(401).json({ error: "bad api key" });
  next();
};

// Brute-force guard: after MAX_FAILS wrong passwords from one IP, that IP is locked out for
// LOCK_MS. Best effort: it lives in this server instance's memory (Vercel reuses warm
// instances, so it slows guessing a lot but is not a hard guarantee). For a hard limit add a
// Vercel Firewall rule: Project -> Firewall -> Rate Limit on paths
// starting with /api/, per IP, set well above what the dashboard's polling uses (e.g. 300 req/min).
const MAX_FAILS = 10, LOCK_MS = 15 * 60000;
const fails = new Map(); // ip -> { n, since }
const clientIp = (req) => req.header("x-real-ip") || (req.header("x-forwarded-for") || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";

const dashAuth = (req, res, next) => {
  const pw = clean(process.env.DASHBOARD_PASSWORD);
  if (!pw) {
    // Fail closed when deployed: a missing env var must not leave the dashboard open.
    // An empty password is allowed only for local testing (dev-server.js).
    if (process.env.VERCEL) return res.status(500).json({ error: "DASHBOARD_PASSWORD is not set on the server." });
    return next();
  }
  const ip = clientIp(req), now = Date.now();
  let f = fails.get(ip);
  if (f && now - f.since > LOCK_MS) { fails.delete(ip); f = null; }
  if (f && f.n >= MAX_FAILS) {
    const mins = Math.ceil((f.since + LOCK_MS - now) / 60000);
    return res.status(429).json({ error: `Too many wrong passwords. Try again in ${mins} min.` });
  }
  if (!sameSecret(req.header("x-dashboard-password"), pw)) {
    fails.set(ip, f ? { ...f, n: f.n + 1 } : { n: 1, since: now });
    if (fails.size > 5000) fails.clear(); // keep memory bounded
    return res.status(401).json({ error: "password required" });
  }
  if (f) fails.delete(ip);
  next();
};

const withUrl = (r) => ({ ...r, url: imageUrl(r.file) });
const phTime = (iso) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
// Calendar day of a batch in Philippine time: the start date is Day 1.
const phMidnight = (d) => Date.parse(new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
const batchDay = (b, at = Date.now()) => Math.round((phMidnight(at) - phMidnight(b.started_at)) / 86400000) + 1;
const MIN_TRANSPLANT_DAY = 10;

// Logged to the alerts table; also sent to Telegram when telegram=true.
async function logAlert(kind, message, { batchId = null, telegram = false } = {}) {
  const sent = telegram ? await sendMessage(message).catch(() => false) : false;
  const { error } = await sb.from("alerts").insert({ kind, message, batch_id: batchId, source: "server", sent_telegram: sent });
  if (error) console.error("alerts:", error.message);
}

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
  if (!batch) {
    // Nothing is being monitored: keep the camera marked online but don't store the photo.
    await sb.from("camera_status").upsert({ id: 1, last_seen: ts });
    return res.json({ ok: true, skipped: "no batch is being monitored" });
  }
  const file = `${batch.id}/${ts.replace(/[:.]/g, "-")}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(file, buf, { contentType: "image/jpeg", cacheControl: "31536000" }); // each photo has a unique name and never changes
  if (up.error) throw new Error(up.error.message);
  // ?source=scheduled (12 h schedule) | manual (dashboard "Take photo"); camera_poll() relies on it.
  const source = req.query.source === "scheduled" ? "scheduled" : "manual";
  const row = ok(await sb.from("images").insert({ batch_id: batch.id, ts, file, source }).select().single());
  // Any new photo satisfies a pending "take a photo now" request from the dashboard.
  // Errors are only logged so a missing table never loses an upload.
  const [cr, cs] = await Promise.all([
    sb.from("capture_requests").update({ fulfilled_at: ts, image_id: row.id }).is("fulfilled_at", null),
    sb.from("camera_status").upsert({ id: 1, last_seen: ts }),
  ]);
  if (cr.error || cs.error) console.error("camera tables:", (cr.error || cs.error).message);
  res.json({ ok: true, id: row.id });

  // Runs after the response; waitUntil keeps the serverless function alive for it.
  waitUntil((async () => {
    let caption = `PECH-EYE ${batch.name} - ${phTime(ts)}`;
    const w = await ensureWeather();
    if (w) caption += `\nOutdoor ${w.temp?.toFixed(1)} C, ${w.humidity}% RH, rain chance ${Math.round(w.rain_chance_24h ?? 0)}% (${w.description})`;
    if (req.query.analyze !== "0") {
      try {
        const a = await analyzeTray(buf);
        await saveAnalysis(row.id, a);
        caption += `\nTray: ${a.stage_label} (${a.canopy_pct}% green)`;
        if (a.ready) {
          caption += "\nCheck the tray for transplantation.";
          await logAlert("tray_ready", `${batch.name}: the tray is full of green (${a.canopy_pct}%). Check it for transplantation.`, { batchId: batch.id });
        }
      } catch (e) { console.error("analysis failed:", e.message); }
    }
    await sendPhoto(buf, caption).catch((e) => console.error("telegram failed:", e.message));
  })());
}));

// The camera doesn't check in here: it calls camera_poll() in Supabase directly
// (see supabase/schema.sql), so "Take photo" is picked up within seconds.

const bool = (v) => (typeof v === "boolean" ? v : null);

// Controller snapshot. JSON {temperature, humidity, soil_raw, soil_moisture, reservoir_low,
// mist_on, light_on, pump_on}; every field optional.
// Only stored while a batch is being monitored; readings between batches are dropped.
app.post("/api/ingest/reading", deviceAuth, h(async (req, res) => {
  const b = await jsonBody(req);
  const batch = await activeBatch();
  if (!batch) {
    await ensureWeather(); // the outdoor weather log keeps growing between batches
    return res.json({ ok: true, skipped: "no batch is being monitored" });
  }
  ok(await sb.from("readings").insert({
    batch_id: batch.id, temperature: num(b.temperature), humidity: num(b.humidity),
    soil_raw: num(b.soil_raw), soil_moisture: num(b.soil_moisture), reservoir_low: bool(b.reservoir_low),
    mist_on: bool(b.mist_on), light_on: bool(b.light_on), pump_on: bool(b.pump_on),
  }));
  await ensureWeather(); // keeps the outdoor weather log growing alongside sensor data
  res.json({ ok: true });
}));

// A relay ON period, sent when it switches OFF. JSON {device, duration_s, source, stopped_by}.
app.post("/api/ingest/run", deviceAuth, h(async (req, res) => {
  const b = await jsonBody(req);
  const duration = num(b.duration_s);
  if (!["mist", "light", "pump"].includes(b.device) || duration === null) return res.status(400).json({ error: "device and duration_s required" });
  const batch = await activeBatch();
  const end = new Date();
  const rate = ML_PER_MIN[b.device];
  ok(await sb.from("actuator_runs").insert({
    batch_id: batch?.id ?? null, device: b.device, duration_s: duration,
    started_at: new Date(end - duration * 1000).toISOString(), ended_at: end.toISOString(),
    source: b.source || null, stopped_by: b.stopped_by || null,
    water_ml: rate ? +((duration / 60) * rate).toFixed(1) : null,
  }));
  res.json({ ok: true });
}));

// An alert the controller already sent to Telegram. JSON {kind, message, sent_telegram}.
app.post("/api/ingest/alert", deviceAuth, h(async (req, res) => {
  const b = await jsonBody(req);
  if (!b.kind) return res.status(400).json({ error: "kind required" });
  const batch = await activeBatch();
  ok(await sb.from("alerts").insert({ batch_id: batch?.id ?? null, kind: String(b.kind), message: b.message || null, sent_telegram: b.sent_telegram === true }));
  res.json({ ok: true });
}));

// ---------- Dashboard (password protected) ----------
app.use("/api", dashAuth);

// The login screen calls this to check the password.
app.get("/api/session", (_req, res) => res.json({ ok: true }));

app.post("/api/images/:id/analyze", h(async (req, res) => {
  const row = ok(await sb.from("images").select("*").eq("id", req.params.id).single());
  const img = await fetch(imageUrl(row.file));
  const a = await analyzeTray(Buffer.from(await img.arrayBuffer()));
  await saveAnalysis(row.id, a);
  res.json(withUrl(ok(await sb.from("images").select("*").eq("id", row.id).single())));
}));

async function cameraState() {
  const [st, pending] = await Promise.all([
    sb.from("camera_status").select("*").eq("id", 1).maybeSingle(),
    sb.from("capture_requests").select("*").is("fulfilled_at", null).order("requested_at").limit(1),
  ]);
  const s = ok(st);
  return { lastSeen: s?.last_seen || null, checkSeconds: s?.check_seconds || null, pending: ok(pending)[0] || null };
}

// "Take a photo now": queue a request; the camera picks it up within a few seconds.
app.post("/api/camera/capture", h(async (_req, res) => {
  const st = await cameraState();
  if (!st.pending) ok(await sb.from("capture_requests").insert({}));
  res.json(await cameraState());
}));

app.post("/api/camera/cancel", h(async (_req, res) => {
  ok(await sb.from("capture_requests").delete().is("fulfilled_at", null));
  res.json(await cameraState());
}));

app.get("/api/dashboard", h(async (req, res) => {
  const batch = req.query.batch
    ? ok(await sb.from("batches").select("*").eq("id", req.query.batch).single())
    : await activeBatch();
  if (!batch) {
    // No batch: the chamber isn't monitored, so only the outdoor weather.
    return res.json({ batch: null, latestReading: null, weather: await ensureWeather() });
  }
  const [lr, recent, cnt, weather, camera] = await Promise.all([
    sb.from("readings").select("*").eq("batch_id", batch.id).order("ts", { ascending: false }).limit(1),
    sb.from("images").select("*").eq("batch_id", batch.id).order("ts", { ascending: false }).limit(12),
    sb.from("images").select("id", { count: "exact", head: true }).eq("batch_id", batch.id),
    batch.status === "growing" ? ensureWeather() : null,
    batch.status === "growing" ? cameraState().catch(() => null) : null, // null if the camera tables aren't created yet
  ]);
  const recentImages = ok(recent).map(withUrl);
  res.json({
    batch,
    day: batchDay(batch, batch.ended_at || Date.now()),
    minTransplantDay: MIN_TRANSPLANT_DAY,
    latestReading: ok(lr)[0] || null,
    recentImages,
    latestAnalyzed: recentImages.find((i) => i.analysis) || null,
    imageCount: cnt.count || 0,
    weather,
    camera,
  });
}));

app.get("/api/readings", h(async (req, res) => {
  const id = req.query.batch || (await activeBatch())?.id;
  if (!id) return res.json([]);
  const rows = await fetchAll((a, b) => sb.from("readings").select("*").eq("batch_id", id).order("ts").range(a, b));
  const step = Math.ceil(rows.length / 500) || 1; // downsample for fast charts
  res.json(rows.filter((_, i) => i % step === 0));
}));

// Sensor history pages: every reading and mist run of the last N days (any batch).
app.get("/api/history", h(async (req, res) => {
  const days = Math.min(90, Math.max(1, num(req.query.days) || 7));
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const [readings, runs] = await Promise.all([
    fetchAll((a, b) => sb.from("readings").select("ts, temperature, humidity, soil_moisture, soil_raw, reservoir_low").gte("ts", from).order("ts").range(a, b)),
    fetchAll((a, b) => sb.from("actuator_runs").select("started_at, duration_s, water_ml, source").eq("device", "mist").gte("started_at", from).order("started_at", { ascending: false }).range(a, b)),
  ]);
  res.json({ from, days, readings, runs });
}));

// Every photo of a batch (newest first) for the Photos gallery.
app.get("/api/images", h(async (req, res) => {
  const batch = req.query.batch
    ? ok(await sb.from("batches").select("*").eq("id", req.query.batch).single())
    : await activeBatch();
  if (!batch) return res.json({ batch: null, images: [] });
  const rows = await fetchAll((a, b) => sb.from("images").select("*").eq("batch_id", batch.id).order("ts", { ascending: false }).range(a, b));
  res.json({ batch, images: rows.map(withUrl) });
}));

// Each batch with its newest photo as a cover (Photos -> Transplanted Batch cards).
app.get("/api/batches", h(async (_req, res) => {
  const batches = ok(await sb.from("batches").select("*").order("id", { ascending: false }));
  const [covers, anyReading] = await Promise.all([
    Promise.all(batches.map((b) => sb.from("images").select("file").eq("batch_id", b.id).order("ts", { ascending: false }).limit(1))),
    Promise.all(batches.map((b) => sb.from("readings").select("id").eq("batch_id", b.id).limit(1))),
  ]);
  res.json(batches.map((b, i) => {
    const file = covers[i].data?.[0]?.file;
    const empty = !file && !anyReading[i].data?.length;
    // When the Delete button unlocks (null while the batch is still being monitored).
    const deletableFrom = b.status === "growing" ? null
      : empty ? b.ended_at : new Date(new Date(b.ended_at).getTime() + DELETE_AFTER_DAYS * 86400000).toISOString();
    return { ...b, cover: file ? imageUrl(file) : null, empty, deletable_from: deletableFrom };
  }));
}));

// "Start monitoring": batches are named Batch 1, Batch 2, ... one above the highest existing number.
// Deleting the latest batch frees its name for the next one; deleting an older batch never
// brings its number back (Batch 1 deleted while Batch 5 exists -> next is Batch 6).
app.post("/api/batches", h(async (_req, res) => {
  if (await activeBatch()) return res.status(409).json({ error: "A batch is already being monitored." });
  const nums = ok(await sb.from("batches").select("name")).map((b) => Number(/^Batch (\d+)$/.exec(b.name)?.[1]) || 0);
  res.json(ok(await sb.from("batches").insert({ name: `Batch ${Math.max(0, ...nums) + 1}` }).select().single()));
}));

// Ended batches can be deleted: right away if nothing was recorded (no readings, no photos),
// otherwise only DELETE_AFTER_DAYS after the batch ended. The browser shows the same rule.
const DELETE_AFTER_DAYS = 30;
app.delete("/api/batches/:id", h(async (req, res) => {
  const b = ok(await sb.from("batches").select("*").eq("id", req.params.id).single());
  if (b.status === "growing") return res.status(409).json({ error: "Stop monitoring this batch before deleting it." });
  const [rc, ic] = await Promise.all([
    sb.from("readings").select("id", { count: "exact", head: true }).eq("batch_id", b.id),
    sb.from("images").select("id", { count: "exact", head: true }).eq("batch_id", b.id),
  ]);
  const empty = !rc.count && !ic.count;
  const age = (Date.now() - new Date(b.ended_at)) / 86400000;
  if (!empty && age < DELETE_AFTER_DAYS)
    return res.status(409).json({ error: `${b.name} has records. It can be deleted ${DELETE_AFTER_DAYS} days after it ended.` });

  // Photo files first, then every row that points at the batch, then the batch itself.
  const files = await fetchAll((x, y) => sb.from("images").select("file").eq("batch_id", b.id).range(x, y));
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await sb.storage.from(BUCKET).remove(files.slice(i, i + 100).map((f) => f.file));
    if (error) throw new Error(error.message);
  }
  for (const t of ["images", "readings", "actuator_runs", "alerts"]) ok(await sb.from(t).delete().eq("batch_id", b.id));
  ok(await sb.from("batches").delete().eq("id", b.id));
  res.json({ ok: true, deleted: b.name });
}));

async function buildSummary(batch, endedAt) {
  const r1 = (v) => (v === null || v === undefined ? null : +Number(v).toFixed(1));
  const [stats, wx, imgs, last] = await Promise.all([
    sb.rpc("batch_stats", { p_batch: batch.id }),
    sb.rpc("weather_stats", { p_from: batch.started_at, p_to: endedAt }),
    sb.from("images").select("id", { count: "exact", head: true }).eq("batch_id", batch.id),
    sb.from("images").select("ready_cells, occupied_cells, total_cells, canopy_pct, ready").eq("batch_id", batch.id)
      .not("analysis", "is", null).order("ts", { ascending: false }).limit(1),
  ]);
  const s = ok(stats), w = ok(wx);
  const ms = new Date(endedAt) - new Date(batch.started_at);
  return {
    started_at: batch.started_at, ended_at: endedAt,
    duration_days: r1(ms / 86400000), duration_hours: r1(ms / 3600000),
    readings: s.n, images: imgs.count || 0,
    avg_temperature: r1(s.avg_temp), min_temperature: r1(s.min_temp), max_temperature: r1(s.max_temp),
    avg_humidity: r1(s.avg_humidity), min_humidity: r1(s.min_humidity), max_humidity: r1(s.max_humidity),
    avg_soil_moisture: r1(s.avg_soil), min_soil_moisture: r1(s.min_soil), max_soil_moisture: r1(s.max_soil),
    mist_runs: s.mist_runs ?? 0, water_ml: r1(s.water_ml),
    outdoor_avg_temp: r1(w.avg_temp), outdoor_avg_humidity: r1(w.avg_humidity),
    outdoor_avg_rain_chance: r1(w.avg_rain_chance), outdoor_max_rain_1h: r1(w.max_rain_1h),
    final_analysis: ok(last)[0] || null,
  };
}

// Ends the batch (transplanted, or stopped early): freezes the logs and stores the summary.
async function closeBatch(req, res, status) {
  const body = await jsonBody(req);
  const b = ok(await sb.from("batches").select("*").eq("id", req.params.id).single());
  if (b.status !== "growing") return res.status(409).json({ error: "This batch has already ended." });
  if (status === "transplanted" && batchDay(b) < MIN_TRANSPLANT_DAY)
    return res.status(409).json({ error: `Transplanting is allowed from Day ${MIN_TRANSPLANT_DAY}.` });
  const endedAt = new Date().toISOString();
  const summary = await buildSummary(b, endedAt);
  ok(await sb.from("batches").update({ status, ended_at: endedAt, summary, notes: body.notes || b.notes }).eq("id", b.id));
  const msg = status === "transplanted"
    ? `${b.name} transplanted after ${summary.duration_days} days. Avg temperature ${summary.avg_temperature} C, avg humidity ${summary.avg_humidity}%.`
    : `${b.name} monitoring stopped on Day ${batchDay(b)}${body.notes ? `: ${body.notes}` : "."}`;
  waitUntil(logAlert(status, msg, { batchId: b.id, telegram: true }));
  res.json(summary);
}
app.post("/api/batches/:id/transplant", h((req, res) => closeBatch(req, res, "transplanted")));
app.post("/api/batches/:id/stop", h((req, res) => closeBatch(req, res, "stopped")));

export default app;
