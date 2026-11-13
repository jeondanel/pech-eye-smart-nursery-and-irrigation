import { useCallback, useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { api, setPw } from "./api.js";

const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}${unit}`);
const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const longDate = (d) => new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const every = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

// Calendar days since the batch started (local time): the start date is Day 1, the next date Day 2, ...
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayOf = (start, at = Date.now()) => Math.max(1, Math.round((midnight(at) - midnight(start)) / 86400000) + 1);

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Clock() {
  const now = useNow(1000);
  return (
    <div className="clock" aria-live="off">
      <b>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</b>
      <small>{now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</small>
    </div>
  );
}

function usePoll(fn, deps, ms = 10000) {
  const [state, set] = useState({ data: null, error: null });
  const run = useCallback(() => fn().then((data) => set({ data, error: null })).catch((error) => set((s) => ({ ...s, error }))), deps); // eslint-disable-line
  useEffect(() => { run(); const t = setInterval(run, ms); return () => clearInterval(t); }, [run, ms]);
  return { ...state, reload: run };
}

/* ---------- small building blocks ---------- */

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`card stat ${tone || ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

const Icon = {
  dash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  batch: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V12" /><path d="M12 12C12 7 8 4 3 4c0 5 3 8 9 8Z" /><path d="M12 14c0-4 3-7 9-7 0 5-3 8-9 8" /></svg>,
  photos: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>,
};

function Login({ wrong, onSubmit }) {
  const [p, setP] = useState("");
  return (
    <form className="card login" onSubmit={(e) => { e.preventDefault(); onSubmit(p); }}>
      <div className="logo">🌱</div>
      <h2>PECH-EYE</h2>
      <p className="muted">Enter the dashboard password to continue.</p>
      <input type="password" autoFocus autoComplete="current-password" placeholder="Password" value={p} onChange={(e) => setP(e.target.value)} />
      {wrong && <div className="err">Wrong password. Try again.</div>}
      <button className="btn block" type="submit">Open dashboard</button>
    </form>
  );
}

/* ---------- tray analysis ---------- */

const STATE_COLOR = { empty: "var(--c-empty)", growing: "var(--c-growing)", ready: "var(--c-ready)" };

function TrayGrid({ analysis }) {
  if (!analysis) return <p className="muted">No analysis yet.</p>;
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${analysis.cols}, 1fr)` }}>
        {analysis.cells.map((c, i) => (
          <div key={i} className="cell" style={{ background: STATE_COLOR[c] }} title={`Row ${Math.floor(i / analysis.cols) + 1}, Col ${(i % analysis.cols) + 1}: ${c}${analysis.cover ? ` (${analysis.cover[i]}% green)` : ""}`} />
        ))}
      </div>
      <div className="legend">
        {Object.entries(STATE_COLOR).map(([k, c]) => (
          <span key={k}><i style={{ background: c }} />{k}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------- charts ---------- */

const CHARTS = [
  { title: "Chamber temperature & humidity", lines: [["temperature", "Temp (°C)", "#e57373"], ["humidity", "Humidity (%)", "#42a5f5"]] },
  { title: "Soil moisture (%)", lines: [["soil_moisture", "Soil moisture", "#a1887f"]] },
  { title: "Plant height (cm)", lines: [["height_cm", "Height", "#66bb6a"]] },
];

function Charts({ batch }) {
  const { data } = usePoll(() => api.readings(batch), [batch]);
  if (!data) return <div className="skel" style={{ height: 240 }} />;
  const rows = data.map((r) => ({ ...r, time: new Date(r.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  if (rows.length === 0) {
    return <div className="card empty"><b>📡</b>No sensor readings yet. Charts appear as soon as the sensor node starts reporting.</div>;
  }
  const shown = CHARTS.filter((c) => c.lines.some(([k]) => rows.some((r) => r[k] != null)));
  return (
    <div className="two">
      {shown.map((c) => (
        <div className="card" key={c.title}>
          <h3>{c.title}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" minTickGap={48} tickMargin={6} />
              <YAxis domain={["auto", "auto"]} width={46} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--text)" }} />
              <Legend />
              {c.lines.filter(([k]) => rows.some((r) => r[k] != null)).map(([k, name, color]) => (
                <Line key={k} type="monotone" dataKey={k} name={name} stroke={color} strokeWidth={2.2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

/* ---------- remote camera trigger ---------- */

function CameraControl({ camera, onChange }) {
  useNow(15000); // keep the "x min ago" text fresh between polls
  const [busy, setBusy] = useState(false);
  if (!camera) return null;
  const { pending, lastSeen, checkSeconds } = camera;
  const offline = lastSeen && checkSeconds && Date.now() - new Date(lastSeen) > checkSeconds * 3000 + 120000;
  const act = async (fn) => { setBusy(true); try { await fn(); onChange(); } catch (e) { alert(e.message); } setBusy(false); };

  return (
    <div className="card camctl">
      <div>
        <b>{pending ? "📷 Photo requested" : "📷 Take a photo now"}</b>
        <span className="muted">
          {pending
            ? <>Requested {ago(pending.requested_at)}. The camera takes it on its next check-in{checkSeconds ? <> (every {every(checkSeconds)})</> : null}; the photo appears here automatically.</>
            : <>The camera checks in{checkSeconds ? <> every {every(checkSeconds)}</> : " regularly"} and takes the photo then.</>}
        </span>
        <span className={`muted small ${offline ? "warn-t" : ""}`}>
          {lastSeen ? <>Camera last checked in {ago(lastSeen)}{offline ? " - it may be offline or out of power." : "."}</> : "The camera hasn't checked in yet. Flash the updated firmware."}
        </span>
      </div>
      {pending
        ? <button className="btn ghost" disabled={busy} onClick={() => act(api.cancelPhoto)}>Cancel request</button>
        : <button className="btn" disabled={busy} onClick={() => act(api.requestPhoto)}>{busy ? "Requesting…" : "Take photo"}</button>}
    </div>
  );
}

/* ---------- dashboard ---------- */

// Same rules as the sensor node's decision engine (firmware evaluateIrrigationDecision)
function irrigationDecision(w, r) {
  if (!w || !r) return { tone: "grey", icon: "⏳", title: "Irrigation decision pending", text: "Waiting for weather and sensor data." };
  if (w.rain_chance_24h >= 50 || w.rain_1h > 0.5)
    return { tone: "info", icon: "🌧️", title: "Irrigation deferred: rain expected", text: `Rain chance ${Math.round(w.rain_chance_24h ?? 0)}% in the next 24 h. Outdoor irrigation is locked out.` };
  if (r.temperature > 32 && r.humidity < 60)
    return { tone: "warn", icon: "🔥", title: "Heat stress: misting recommended", text: `Chamber is ${fmt(r.temperature, "°C")} at ${fmt(r.humidity, "%")} humidity.` };
  return { tone: "ok", icon: "✅", title: "Irrigation permitted", text: "Clear weather. Normal irrigation schedule allowed." };
}

function Dashboard({ batchId, onPhotos }) {
  const { data, error, reload } = usePoll(() => api.dashboard(batchId), [batchId]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error && !data) {
    return (
      <div className="card empty">
        <b>⚠️</b>Cannot reach the server ({error.message}).
        <div style={{ marginTop: 12 }}><button className="btn ghost" onClick={reload}>Try again</button></div>
      </div>
    );
  }
  if (!data) return <><div className="skel" /><div className="skel" style={{ height: 150 }} /><div className="skel" /></>;

  const { batch, latestReading: r, recentImages, latestAnalyzed } = data;
  const w = data.weather;
  const decision = irrigationDecision(w, r);
  const shown = selected || latestAnalyzed || recentImages[0];
  const a = shown?.analysis;

  const ageMin = r ? (Date.now() - new Date(r.ts)) / 60000 : null;
  const live = ageMin !== null && ageMin < 15;
  const reservoirLow = r?.reservoir_low === true;

  const analyze = async () => {
    setBusy(true);
    try { setSelected(await api.analyze(shown.id)); reload(); } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="card hero">
        <div>
          <p className="muted">{batch.status === "growing" ? "Current batch" : "Batch"}</p>
          <h2>{batch.name} <span className="day">Day {dayOf(batch.started_at, batch.ended_at || Date.now())}</span></h2>
          <p className="muted">Started {longDate(batch.started_at)}{batch.ended_at && ` · transplanted ${longDate(batch.ended_at)}`}</p>
        </div>
        <div className="chips">
          {batch.status !== "growing" && <span className="chip info">Transplanted</span>}
          {r
            ? <span className={`chip ${live ? "live" : "warn"}`}><i className="dot" />{live ? "Sensors live" : "Sensors offline"} · {ago(r.ts)}</span>
            : <span className="chip grey"><i className="dot" />No sensor data</span>}
        </div>
      </div>

      {reservoirLow && (
        <div className="banner bad">
          <div className="ic">🚰</div>
          <div><b>Mist reservoir is LOW</b><span>Float switch reports low water. Refill the reservoir; the mist pump is cut off until then.</span></div>
        </div>
      )}

      <div className={`banner ${decision.tone}`}>
        <div className="ic">{decision.icon}</div>
        <div><b>{decision.title}</b><span>{decision.text}</span></div>
      </div>

      <div className="sec-title">Nursery chamber</div>
      <div className="stats">
        <Stat label="Temperature" value={fmt(r?.temperature, "°C")} tone={r?.temperature > 32 ? "warn" : ""} />
        <Stat label="Humidity" value={fmt(r?.humidity, "%")} />
        <Stat label="Mist reservoir" value={r?.reservoir_low == null ? "—" : reservoirLow ? "LOW" : "OK"} tone={r?.reservoir_low == null ? "" : reservoirLow ? "bad" : "ok"} sub={reservoirLow ? "refill needed" : r?.reservoir_low === false ? "water sufficient" : ""} />
        {r?.soil_moisture != null && <Stat label="Soil moisture" value={fmt(r.soil_moisture, "%")} />}
        {r?.height_cm != null && <Stat label="Plant height" value={fmt(r.height_cm, " cm")} />}
      </div>

      <div className="sec-title">Outdoor weather</div>
      <div className="stats">
        <Stat label="Temperature" value={fmt(w?.temp, "°C")} sub={w ? w.description : "weather not configured"} />
        <Stat label="Humidity" value={w?.humidity == null ? "—" : `${Math.round(w.humidity)}%`} />
        <Stat label="Rain chance (24 h)" value={w?.rain_chance_24h == null ? "—" : `${Math.round(w.rain_chance_24h)}%`} tone={w?.rain_chance_24h >= 50 ? "info" : ""} sub={w ? `wind ${fmt(w.wind_speed, " m/s")}` : ""} />
      </div>

      <div className="sec-title">Trends</div>
      <Charts batch={batchId} />

      <div className="sec-title">Tray monitoring</div>
      <div className="stats">
        <Stat label="Readiness" value={latestAnalyzed ? (latestAnalyzed.ready ? "READY" : `${latestAnalyzed.ready_cells}/${latestAnalyzed.occupied_cells}`) : "—"} tone={latestAnalyzed?.ready ? "ok" : ""} sub="ready / occupied holes" />
        <Stat label="Photos" value={data.imageCount} />
      </div>

      <CameraControl camera={data.camera} onChange={reload} />

      <div className="two">
        <div className="card">
          <div className="row head">
            <h3>Recent pictures</h3>
            {data.imageCount > 0 && <button className="link" onClick={() => onPhotos(batch.id)}>View all {data.imageCount} →</button>}
          </div>
          {recentImages.length === 0 ? <div className="empty"><b>📷</b>No pictures yet. Photos appear here once the camera node uploads.</div> : (
            <div className="thumbs">
              {recentImages.map((im) => (
                <img key={im.id} src={im.url} loading="lazy" alt={`Tray photo, Day ${dayOf(batch.started_at, im.ts)}, ${when(im.ts)}`} title={`Day ${dayOf(batch.started_at, im.ts)} · ${when(im.ts)}`} className={shown?.id === im.id ? "sel" : ""} onClick={() => setSelected(im)} />
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3>Tray analysis {shown && <small className="muted">· Day {dayOf(batch.started_at, shown.ts)} · {when(shown.ts)}</small>}</h3>
          {!shown && <div className="empty"><b>🌿</b>Analysis shows up after the first photo.</div>}
          {shown && <img src={shown.url} className="big" alt="Selected tray" />}
          {shown && <button className="btn ghost block" onClick={analyze} disabled={busy}>{busy ? "Analyzing…" : a ? "Re-analyze" : "Analyze this photo"}</button>}
          {a && (
            <>
              <div className="metrics">
                <div><b>{a.ready_cells}</b>ready</div>
                <div><b>{a.occupied_cells}</b>occupied</div>
                <div><b>{a.total_cells}</b>holes</div>
                <div><b>{fmt(a.canopy_pct, "%")}</b>canopy</div>
              </div>
              <p className="result">{a.ready ? <b className="chip">✅ Ready for transplant</b> : <b className="chip warn">Not ready yet</b>}</p>
              <TrayGrid analysis={a} />
              {a.notes && <p className="muted" style={{ marginTop: 8 }}>{a.notes}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- photo gallery ---------- */

function Lightbox({ images, index, start, onIndex, onClose }) {
  const im = images[index];
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index < images.length - 1) onIndex(index + 1); // older
      if (e.key === "ArrowRight" && index > 0) onIndex(index - 1);                // newer
    };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [index, images.length, onClose, onIndex]);
  if (!im) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lb-in" onClick={(e) => e.stopPropagation()}>
        <div className="lb-top">
          <div><b>Day {dayOf(start, im.ts)}</b> · {longDate(im.ts)}, {clockTime(im.ts)}</div>
          <button className="lb-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <img src={im.url} alt={`Tray photo, Day ${dayOf(start, im.ts)}`} />
        <div className="lb-bot">
          <button className="btn ghost" disabled={index >= images.length - 1} onClick={() => onIndex(index + 1)}>← Older</button>
          <span className="muted">
            {im.analysis ? `${im.ready_cells}/${im.occupied_cells} ready${im.ready ? " ✅" : ""}` : "not analyzed"} · {images.length - index} of {images.length}
            {" · "}<a href={im.url} target="_blank" rel="noreferrer">Full size</a>
          </span>
          <button className="btn ghost" disabled={index <= 0} onClick={() => onIndex(index - 1)}>Newer →</button>
        </div>
      </div>
    </div>
  );
}

function Photos({ initialBatch }) {
  const [batchId, setBatchId] = useState(initialBatch || "");
  const [open, setOpen] = useState(null);
  const batches = usePoll(() => api.batches(), [], 60000);
  const { data, error } = usePoll(() => api.images(batchId || undefined), [batchId], 20000);
  const close = useCallback(() => setOpen(null), []);

  if (error && !data) return <div className="card empty"><b>⚠️</b>Cannot load photos ({error.message}).</div>;

  const images = data?.images || [];
  const start = data?.batch.started_at;
  const groups = [];
  images.forEach((im, i) => {
    const d = dayOf(start, im.ts);
    if (!groups.length || groups[groups.length - 1].day !== d) groups.push({ day: d, ts: im.ts, items: [] });
    groups[groups.length - 1].items.push({ im, i });
  });

  return (
    <>
      <div className="row">
        <div>
          <h2>Photos</h2>
          {data && <p className="muted">{data.batch.name} · {images.length} photo{images.length === 1 ? "" : "s"} · started {longDate(start)}</p>}
        </div>
        {batches.data?.length > 1 && (
          <select className="select" value={batchId} onChange={(e) => { setBatchId(e.target.value); setOpen(null); }} aria-label="Batch">
            <option value="">Current batch</option>
            {batches.data.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.status})</option>)}
          </select>
        )}
      </div>

      {!data ? <div className="skel" style={{ height: 240 }} />
        : images.length === 0 ? <div className="card empty"><b>📷</b>No photos for this batch yet.</div>
        : groups.map((g) => (
          <section key={g.day}>
            <div className="sec-title day-title">Day {g.day} <span>· {longDate(g.ts)} · {g.items.length} photo{g.items.length === 1 ? "" : "s"}</span></div>
            <div className="gallery">
              {g.items.map(({ im, i }) => (
                <button key={im.id} className="shot" onClick={() => setOpen(i)}>
                  <img src={im.url} loading="lazy" alt={`Tray photo, Day ${g.day}, ${clockTime(im.ts)}`} />
                  <span className="cap">{clockTime(im.ts)}{im.ready ? " · ✅" : ""}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

      {open !== null && <Lightbox images={images} index={open} start={start} onIndex={setOpen} onClose={close} />}
    </>
  );
}

/* ---------- batches ---------- */

function Batches({ onOpen, onPhotos }) {
  const { data, reload } = usePoll(() => api.batches(), [], 15000);
  if (!data) return <><div className="skel" /><div className="skel" /></>;
  const growing = data.find((b) => b.status === "growing");
  const transplant = async (b) => {
    if (!confirm(`Mark ${b.name} as transplanted? This closes the logs and creates the summary.`)) return;
    try { await api.transplant(b.id); reload(); } catch (e) { alert(e.message); }
  };
  const start = async () => { try { await api.newBatch(); reload(); } catch (e) { alert(e.message); } };
  return (
    <>
      <div className="row">
        <h2>Batches & summaries</h2>
        {!growing && <button className="btn" onClick={start}>+ Start new batch</button>}
      </div>
      {data.length === 0 && <div className="card empty"><b>🌱</b>No batches yet.</div>}
      {data.map((b) => (
        <div className="card" key={b.id}>
          <div className="row">
            <div>
              <h3 style={{ marginBottom: 2 }}>{b.name} <span className={`pill ${b.status}`}>{b.status}</span></h3>
              <p className="muted">Started {when(b.started_at)}{b.ended_at && ` · Ended ${when(b.ended_at)}`} · {b.status === "growing" ? "now on" : "lasted to"} Day {dayOf(b.started_at, b.ended_at || Date.now())}</p>
            </div>
            <div className="batch-actions">
              <button className="btn ghost" onClick={() => onOpen(b.id)}>View dashboard</button>
              <button className="btn ghost" onClick={() => onPhotos(b.id)}>Photos</button>
              {b.status === "growing" && <button className="btn" onClick={() => transplant(b)}>Mark as transplanted</button>}
            </div>
          </div>
          {b.summary ? (
            <div className="stats" style={{ marginTop: 14 }}>
              <Stat label="Growing period" value={`${b.summary.duration_days} d`} sub={`${b.summary.duration_hours} h`} />
              <Stat label="Avg humidity" value={fmt(b.summary.avg_humidity, "%")} sub={`${fmt(b.summary.min_humidity)}–${fmt(b.summary.max_humidity)}`} />
              <Stat label="Avg soil moisture" value={fmt(b.summary.avg_soil_moisture, "%")} sub={`${fmt(b.summary.min_soil_moisture)}–${fmt(b.summary.max_soil_moisture)}`} />
              <Stat label="Max height" value={fmt(b.summary.max_height_cm, " cm")} />
              <Stat label="Outdoor avg temp" value={fmt(b.summary.outdoor_avg_temp, "°C")} sub={`${fmt(b.summary.outdoor_avg_humidity)}% RH`} />
              <Stat label="Photos / readings" value={`${b.summary.images} / ${b.summary.readings}`} />
              {b.summary.final_analysis && <Stat label="Final tray" value={`${b.summary.final_analysis.ready_cells}/${b.summary.final_analysis.occupied_cells}`} sub="ready plants" />}
            </div>
          ) : <p className="muted" style={{ marginTop: 12 }}>The summary is generated when the batch is transplanted.</p>}
        </div>
      ))}
    </>
  );
}

/* ---------- shell ---------- */

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [batchId, setBatchId] = useState(null);
  const [auth, setAuth] = useState(null); // null | { wrong: boolean }
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const h = (e) => setAuth({ wrong: !!e.detail?.hadPassword });
    window.addEventListener("pecheye-auth", h);
    return () => window.removeEventListener("pecheye-auth", h);
  }, []);

  const login = (p) => { setPw(p); setAuth(null); setEpoch((n) => n + 1); };
  const go = (t, id = null) => { setTab(t); setBatchId(id); window.scrollTo({ top: 0 }); };

  return (
    <>
      <header className="topbar">
        <div className="in">
          <div className="brand">
            <div className="logo">🌱</div>
            <h1>PECH-EYE<small>Smart pechay nursery</small></h1>
          </div>
          {!auth && (
            <nav className="tabs">
              <button className={tab === "dashboard" ? "on" : ""} onClick={() => go("dashboard")}>{Icon.dash}Dashboard</button>
              <button className={tab === "photos" ? "on" : ""} onClick={() => go("photos")}>{Icon.photos}Photos</button>
              <button className={tab === "batches" ? "on" : ""} onClick={() => go("batches")}>{Icon.batch}Batches</button>
            </nav>
          )}
          <Clock />
        </div>
      </header>
      <main className="page" key={epoch}>
        {auth ? <Login wrong={auth.wrong} onSubmit={login} />
          : tab === "dashboard" ? <Dashboard batchId={batchId} key={batchId} onPhotos={(id) => go("photos", id)} />
          : tab === "photos" ? <Photos initialBatch={batchId} key={batchId} />
          : <Batches onOpen={(id) => go("dashboard", id)} onPhotos={(id) => go("photos", id)} />}
      </main>
    </>
  );
}
