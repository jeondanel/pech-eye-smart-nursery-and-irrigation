import { useCallback, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { Empty, Icon, Lightbox, Skel, Stat, StatusDot } from "../ui.jsx";
import { MIN_TRANSPLANT_DAY, SENSORS, ago, dayOf, fmt, longDate, sensorStatus, useChart, usePoll, when } from "../lib.js";

const tone = (cfg, v) => ({ low: "info", high: "warn" })[sensorStatus(cfg, v)?.tone] || "";

/* ---------- trends (also used on the record page) ---------- */

const TRENDS = [
  { title: "Temperature", key: "temperature", unit: "°C", href: "#/sensors/temperature" },
  { title: "Humidity", key: "humidity", unit: "%", href: "#/sensors/humidity" },
  { title: "Soil moisture", key: "soil_moisture", unit: "%", href: "#/sensors/soil" },
];

export function Trends({ batch, links = true }) {
  const c = useChart();
  const { data } = usePoll(() => api.readings(batch), [batch], 60000);
  if (!data) return <Skel h={220} />;
  const rows = data.map((r) => ({ ...r, time: when(r.ts) }));
  const shown = TRENDS.filter((t) => rows.some((r) => r[t.key] != null));
  if (shown.length === 0) return <div className="card"><Empty icon="sensors">No sensor readings for this batch.</Empty></div>;
  return (
    <div className="two">
      {shown.map((t) => {
        const Box = links ? "a" : "div";
        return (
          <Box className="card chart-card" key={t.key} href={links ? t.href : undefined}>
            <div className="row head"><h3>{t.title}</h3>{links && <Icon name="arrow_outward" className="go" />}</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="time" minTickGap={60} tickMargin={6} stroke={c.axis} />
                <YAxis domain={["auto", "auto"]} width={46} tickFormatter={(v) => Math.round(v)} stroke={c.axis} />
                <Tooltip contentStyle={c.tooltip} formatter={(v) => [fmt(v, t.unit), t.title]} />
                <Line isAnimationActive={false} type="monotone" dataKey={t.key} stroke={c.lines[TRENDS.indexOf(t)]} strokeWidth={1.6} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        );
      })}
    </div>
  );
}

/* ---------- tray analysis ---------- */

const STATE_COLOR = { empty: "var(--cell-empty)", growing: "var(--cell-growing)", ready: "var(--cell-ready)" };
const STATE_NAME = { empty: "no green", growing: "some green", ready: "full green" };

// Older analyses (before the stage rules) have no stage_label.
export const stageOf = (a) => a?.stage_label || (a?.ready ? "Full of green" : "Growing");

export function TrayGrid({ analysis }) {
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${analysis.cols}, 1fr)` }}>
        {analysis.cells.map((c, i) => (
          <div key={i} className="cell" style={{ background: STATE_COLOR[c] }}
            title={`Row ${Math.floor(i / analysis.cols) + 1}, Col ${(i % analysis.cols) + 1}: ${STATE_NAME[c]}${analysis.cover ? ` (${analysis.cover[i]}% green)` : ""}`} />
        ))}
      </div>
      <div className="legend">
        {Object.entries(STATE_COLOR).map(([k, c]) => <span key={k}><i style={{ background: c }} />{STATE_NAME[k]}</span>)}
      </div>
    </div>
  );
}

// Pops up once per photo when the tray is full of green.
function ReadyAlert({ image, batch }) {
  const key = "pecheye_ready_seen";
  const seen = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const [open, setOpen] = useState(() => seen() !== String(image.id));
  if (!open) return null;
  const close = () => { try { localStorage.setItem(key, String(image.id)); } catch { /* ignore */ } setOpen(false); };
  return (
    <div className="modal-bg" role="alertdialog" aria-modal="true" aria-labelledby="ready-title">
      <div className="card modal">
        <Icon name="notifications_active" fill className="modal-ic" />
        <h2 id="ready-title">Check the tray for transplantation</h2>
        <p className="muted">
          The {when(image.ts)} photo of {batch.name} is full of green ({fmt(image.canopy_pct, "%")} of the tray) with no soil showing.
          {dayOf(batch.started_at) < MIN_TRANSPLANT_DAY && <> Transplanting unlocks on Day {MIN_TRANSPLANT_DAY}.</>}
        </p>
        <button className="btn block" onClick={close} autoFocus>OK, I will check it</button>
      </div>
    </div>
  );
}

/* ---------- camera ---------- */

function CameraControl({ camera, onChange }) {
  const [busy, setBusy] = useState(false);
  if (!camera) return null;
  const { pending, lastSeen, checkSeconds } = camera;
  const online = !!lastSeen && Date.now() - new Date(lastSeen) < (checkSeconds || 300) * 3000 + 120000;
  const act = async (fn) => { setBusy(true); try { await fn(); onChange(); } catch (e) { alert(e.message); } setBusy(false); };

  return (
    <div className="card camctl">
      <Icon name="photo_camera" className="camctl-ic" />
      <div>
        <b>{pending ? "Photo requested" : "Take a photo now"}</b>
        <StatusDot on={online} label={online ? "Camera online" : "Camera offline"} />
      </div>
      {pending
        ? <button className="btn ghost" disabled={busy} onClick={() => act(api.cancelPhoto)}>Cancel request</button>
        : <button className="btn" disabled={busy} onClick={() => act(api.requestPhoto)}>{busy ? "Requesting..." : "Take photo"}</button>}
    </div>
  );
}

/* ---------- batch actions (also used on the Batches page) ---------- */

export function BatchActions({ batch, onDone }) {
  const [busy, setBusy] = useState(false);
  const day = dayOf(batch.started_at);
  const canTransplant = day >= MIN_TRANSPLANT_DAY;
  const run = async (fn) => { setBusy(true); try { await fn(); onDone(); } catch (e) { alert(e.message); } setBusy(false); };

  const transplant = () => {
    if (confirm(`Mark ${batch.name} as transplanted? This ends the batch and saves its summary.`)) run(() => api.transplant(batch.id));
  };
  const stop = () => {
    const reason = prompt(`Stop monitoring ${batch.name}? It ends the batch and saves its record.\n\nReason (optional), e.g. "plants died":`);
    if (reason !== null) run(() => api.stopBatch(batch.id, reason.trim() || null));
  };

  return (
    <div className="batch-actions">
      <button className="btn" onClick={transplant} disabled={busy || !canTransplant}
        title={canTransplant ? "" : `Available from Day ${MIN_TRANSPLANT_DAY}`}>
        <Icon name="move_down" />{canTransplant ? "Mark as transplanted" : `Transplant from Day ${MIN_TRANSPLANT_DAY}`}
      </button>
      <button className="btn danger" onClick={stop} disabled={busy}><Icon name="stop_circle" />Stop monitoring</button>
    </div>
  );
}

/* ---------- page ---------- */

function Climate({ r, withSoil }) {
  const low = r?.reservoir_low === true;
  return (
    <>
      <div className="sec-title">Nursery Chamber</div>
      <div className="stats">
        <Stat label="Temperature" href="#/sensors/temperature" value={fmt(r?.temperature, "°C")} tone={tone(SENSORS.temperature, r?.temperature)} />
        <Stat label="Humidity" href="#/sensors/humidity" value={fmt(r?.humidity, "%")} tone={tone(SENSORS.humidity, r?.humidity)} />
        {withSoil && <>
          <Stat label="Soil Moisture" href="#/sensors/soil" value={fmt(r?.soil_moisture, "%", 0)} sub={r?.soil_raw != null ? `ADC ${r.soil_raw}` : ""} tone={tone(SENSORS.soil, r?.soil_moisture)} />
          <Stat label="Mist Reservoir" href="#/sensors/reservoir"
            value={r?.reservoir_low == null ? "—" : low ? "LOW" : "OK"} tone={r?.reservoir_low == null ? "" : low ? "bad" : "ok"}
            sub={low ? "refill needed" : r?.reservoir_low === false ? "water sufficient" : ""} />
        </>}
      </div>
    </>
  );
}

function Weather({ w }) {
  return (
    <>
      <div className="sec-title">Outdoor Weather</div>
      <div className="stats">
        <Stat label="Temperature" value={fmt(w?.temp, "°C")} sub={w ? w.description : "weather not configured"} />
        <Stat label="Humidity" value={w?.humidity == null ? "—" : `${Math.round(w.humidity)}%`} />
        <Stat label="Rain Chance (24 h)" value={w?.rain_chance_24h == null ? "—" : `${Math.round(w.rain_chance_24h)}%`} tone={w?.rain_chance_24h >= 50 ? "info" : ""} sub={w ? `wind ${fmt(w.wind_speed, " m/s")}` : ""} />
      </div>
    </>
  );
}

function StartMonitoring({ onDone }) {
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { await api.startBatch(); onDone(); } catch (e) { alert(e.message); } setBusy(false); };
  return (
    <div className="card start">
      <Icon name="potted_plant" className="start-ic" />
      <div>
        <h2>No batch is being monitored</h2>
        <p className="muted">Sow the tray, then start monitoring. Soil moisture, misting and tray photos are recorded from then on.</p>
      </div>
      <button className="btn" onClick={start} disabled={busy}><Icon name="play_arrow" />{busy ? "Starting..." : "Start monitoring"}</button>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, reload } = usePoll(() => api.dashboard(), []);
  const [analyzed, setAnalyzed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);

  if (error && !data) {
    return (
      <div className="card">
        <Empty icon="cloud_off">Cannot reach the server ({error.message}).</Empty>
        <div className="center"><button className="btn ghost" onClick={reload}>Try again</button></div>
      </div>
    );
  }
  if (!data) return <><Skel /><Skel h={150} /><Skel /></>;

  const { batch, latestReading: r, weather: w } = data;
  if (!batch) {
    return <><StartMonitoring onDone={reload} /><Climate r={r} /><Weather w={w} /></>;
  }

  const { recentImages, latestAnalyzed } = data;
  const latest = recentImages[0];
  const shown = analyzed?.id === latest?.id ? analyzed : latestAnalyzed?.id === latest?.id ? latestAnalyzed : latest;
  const a = shown?.analysis;
  const live = r && (Date.now() - new Date(r.ts)) / 60000 < 15;

  const analyze = async () => {
    setBusy(true);
    try { setAnalyzed(await api.analyze(shown.id)); reload(); } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="card hero">
        <div>
          <p className="eyebrow">Current Batch</p>
          <h2>{batch.name} <span className="day">Day {data.day}</span></h2>
          <p className="muted small">Started {longDate(batch.started_at)}</p>
          <div className="chips">
            {r
              ? <span className={`chip ${live ? "live" : "warn"}`}><i className="dot" />{live ? "Sensors live" : "Sensors offline"} · {ago(r.ts)}</span>
              : <span className="chip grey"><i className="dot" />No sensor data</span>}
          </div>
        </div>
        <BatchActions batch={batch} onDone={reload} />
      </div>

      {latestAnalyzed?.ready && (
        <>
          <div className="banner ok">
            <Icon name="notifications_active" fill />
            <div><b>Check the tray for transplantation</b><span>The latest analyzed photo ({when(latestAnalyzed.ts)}) is full of green.</span></div>
          </div>
          <ReadyAlert key={latestAnalyzed.id} image={latestAnalyzed} batch={batch} />
        </>
      )}

      {r?.reservoir_low && (
        <div className="banner bad">
          <Icon name="water_drop" fill />
          <div><b>Mist reservoir is LOW</b><span>The float switch reports low water. Refill the reservoir; the mist and pump stay locked until then.</span></div>
        </div>
      )}

      <Climate r={r} withSoil />
      <Weather w={w} />

      <div className="sec-title">Trends</div>
      <Trends />

      <div className="sec-title">Tray Monitoring</div>
      <div className="stats">
        <Stat label="Tray Stage" value={latestAnalyzed ? stageOf(latestAnalyzed.analysis) : "—"} tone={latestAnalyzed?.ready ? "ok" : ""}
          sub={latestAnalyzed ? `${fmt(latestAnalyzed.canopy_pct, "%")} green` : "no analyzed photo yet"} />
        <Stat label="Photos" value={data.imageCount} href="#/photos" />
      </div>

      <CameraControl camera={data.camera} onChange={reload} />

      <div className="two">
        <div className="card photo-card">
          <h3>Recent Picture {latest && <small className="muted">· Day {dayOf(batch.started_at, latest.ts)} · {when(latest.ts)}</small>}</h3>
          {!latest ? <Empty icon="photo_camera">No pictures yet. Photos appear here once the camera uploads.</Empty> : (
            <>
              <button className="frame" onClick={() => setOpen(0)} aria-label="Open the latest photo">
                <img src={latest.url} alt={`Latest tray photo, ${when(latest.ts)}`} />
              </button>
              <a className="btn ghost block" href="#/photos">View all {data.imageCount} photos <Icon name="arrow_forward" /></a>
            </>
          )}
        </div>
        <div className="card photo-card">
          <h3>Tray Analysis</h3>
          {!shown ? <Empty icon="eco">Analysis shows up after the first photo.</Empty> : (
            <>
              <div className="frame"><img src={shown.url} alt="Analyzed tray" /></div>
              <button className="btn ghost block" onClick={analyze} disabled={busy}>{busy ? "Analyzing..." : a ? "Re-analyze" : "Analyze this photo"}</button>
            </>
          )}
          {a && (
            <>
              <div className="metrics">
                <div><b>{stageOf(a)}</b>stage</div>
                <div><b>{fmt(a.canopy_pct, "%")}</b>green</div>
                <div><b>{a.occupied_cells}/{a.total_cells}</b>holes with green</div>
              </div>
              <TrayGrid analysis={a} />
            </>
          )}
        </div>
      </div>

      {open !== null && <Lightbox images={recentImages} index={open} start={batch.started_at} onIndex={setOpen} onClose={close} />}
    </>
  );
}
