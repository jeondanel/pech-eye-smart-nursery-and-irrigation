import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { Empty, Icon, Skel, Stat } from "../ui.jsx";
import { SENSORS, ago, dayOf, every, fmt, irrigationDecision, longDate, sensorStatus, useNow, usePoll, when } from "../lib.js";

/* ---------- trends ---------- */

const TRENDS = [
  { title: "Temperature", key: "temperature", unit: "°C", color: "#B6D455", href: "#/sensors/temperature" },
  { title: "Humidity", key: "humidity", unit: "%", color: "#8ABB63", href: "#/sensors/humidity" },
  { title: "Soil moisture", key: "soil_moisture", unit: "%", color: "#DFF3A0", href: "#/sensors/soil" },
];

export const tooltipStyle = { background: "#1f2820", border: "1px solid #2f3b2f", borderRadius: 10, color: "#eef3e6", fontFamily: "Poppins" };

function Trends({ batch }) {
  const { data } = usePoll(() => api.readings(batch), [batch], 60000);
  if (!data) return <Skel h={220} />;
  const rows = data.map((r) => ({ ...r, time: when(r.ts) }));
  const shown = TRENDS.filter((c) => rows.some((r) => r[c.key] != null));
  if (shown.length === 0) {
    return <div className="card"><Empty icon="sensors">No sensor readings yet. Charts appear as soon as the sensor node starts reporting.</Empty></div>;
  }
  return (
    <div className="two">
      {shown.map((c) => (
        <a className="card chart-card" key={c.key} href={c.href}>
          <div className="row head"><h3>{c.title}</h3><Icon name="arrow_outward" className="go" /></div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <XAxis dataKey="time" minTickGap={60} tickMargin={6} />
              <YAxis domain={["auto", "auto"]} width={46} tickFormatter={(v) => Math.round(v)} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(v, c.unit), c.title]} />
              <Line isAnimationActive={false} type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={1.6} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </a>
      ))}
    </div>
  );
}

/* ---------- tray analysis ---------- */

const STATE_COLOR = { empty: "var(--cell-empty)", growing: "var(--cell-growing)", ready: "var(--cell-ready)" };

function TrayGrid({ analysis }) {
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${analysis.cols}, 1fr)` }}>
        {analysis.cells.map((c, i) => (
          <div key={i} className="cell" style={{ background: STATE_COLOR[c] }}
            title={`Row ${Math.floor(i / analysis.cols) + 1}, Col ${(i % analysis.cols) + 1}: ${c}${analysis.cover ? ` (${analysis.cover[i]}% green)` : ""}`} />
        ))}
      </div>
      <div className="legend">
        {Object.entries(STATE_COLOR).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}
      </div>
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
      <Icon name="photo_camera" className="camctl-ic" />
      <div>
        <b>{pending ? "Photo requested" : "Take a photo now"}</b>
        <span className="muted">
          {pending
            ? <>Requested {ago(pending.requested_at)}. The camera takes it on its next check-in{checkSeconds ? <> (every {every(checkSeconds)})</> : null}; the photo appears here automatically.</>
            : <>The camera checks in{checkSeconds ? <> every {every(checkSeconds)}</> : " regularly"} and takes the photo then.</>}
        </span>
        <span className={`muted small ${offline ? "warn-t" : ""}`}>
          {lastSeen ? <>Camera last checked in {ago(lastSeen)}{offline ? " - it may be offline or out of power." : "."}</> : "The camera hasn't checked in yet."}
        </span>
      </div>
      {pending
        ? <button className="btn ghost" disabled={busy} onClick={() => act(api.cancelPhoto)}>Cancel request</button>
        : <button className="btn" disabled={busy} onClick={() => act(api.requestPhoto)}>{busy ? "Requesting..." : "Take photo"}</button>}
    </div>
  );
}

/* ---------- page ---------- */

export default function Dashboard({ batchId }) {
  const { data, error, reload } = usePoll(() => api.dashboard(batchId), [batchId]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error && !data) {
    return (
      <div className="card">
        <Empty icon="cloud_off">Cannot reach the server ({error.message}).</Empty>
        <div className="center"><button className="btn ghost" onClick={reload}>Try again</button></div>
      </div>
    );
  }
  if (!data) return <><Skel /><Skel h={150} /><Skel /></>;

  const { batch, latestReading: r, recentImages, latestAnalyzed } = data;
  const w = data.weather;
  const decision = irrigationDecision(w, r);
  const shown = selected || latestAnalyzed || recentImages[0];
  const a = shown?.analysis;
  const live = r && (Date.now() - new Date(r.ts)) / 60000 < 15;
  const reservoirLow = r?.reservoir_low === true;
  const photosHref = batch.status === "growing" ? "#/photos" : `#/photos?tab=transplanted&batch=${batch.id}`;
  const tone = (cfg, v) => ({ low: "info", high: "warn" })[sensorStatus(cfg, v)?.tone] || "";

  const analyze = async () => {
    setBusy(true);
    try { setSelected(await api.analyze(shown.id)); reload(); } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="card hero">
        <div>
          <p className="eyebrow">{batch.status === "growing" ? "Current Batch" : "Batch"}</p>
          <h2>{batch.name} <span className="day">Day {dayOf(batch.started_at, batch.ended_at || Date.now())}</span></h2>
          <p className="muted small">Started {longDate(batch.started_at)}{batch.ended_at && ` · transplanted ${longDate(batch.ended_at)}`}</p>
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
          <Icon name="water_drop" fill />
          <div><b>Mist reservoir is LOW</b><span>The float switch reports low water. Refill the reservoir; the mist and pump stay locked until then.</span></div>
        </div>
      )}

      <div className={`banner ${decision.tone}`}>
        <Icon name={decision.icon} fill />
        <div><b>{decision.title}{decision.tone === "grey" ? " . . ." : ""}</b><span>{decision.text}</span></div>
      </div>

      <div className="sec-title">Nursery Chamber</div>
      <div className="stats">
        <Stat label="Temperature" href="#/sensors/temperature" value={fmt(r?.temperature, "°C")} tone={tone(SENSORS.temperature, r?.temperature)} />
        <Stat label="Humidity" href="#/sensors/humidity" value={fmt(r?.humidity, "%")} tone={tone(SENSORS.humidity, r?.humidity)} />
        <Stat label="Soil Moisture" href="#/sensors/soil" value={fmt(r?.soil_moisture, "%", 0)} sub={r?.soil_raw != null ? `ADC ${r.soil_raw}` : ""} tone={tone(SENSORS.soil, r?.soil_moisture)} />
        <Stat label="Mist Reservoir" href="#/sensors/reservoir"
          value={r?.reservoir_low == null ? "—" : reservoirLow ? "LOW" : "OK"}
          tone={r?.reservoir_low == null ? "" : reservoirLow ? "bad" : "ok"}
          sub={reservoirLow ? "refill needed" : r?.reservoir_low === false ? "water sufficient" : ""} />
      </div>

      <div className="sec-title">Outdoor Weather</div>
      <div className="stats">
        <Stat label="Temperature" value={fmt(w?.temp, "°C")} sub={w ? w.description : "weather not configured"} />
        <Stat label="Humidity" value={w?.humidity == null ? "—" : `${Math.round(w.humidity)}%`} />
        <Stat label="Rain Chance (24 h)" value={w?.rain_chance_24h == null ? "—" : `${Math.round(w.rain_chance_24h)}%`} tone={w?.rain_chance_24h >= 50 ? "info" : ""} sub={w ? `wind ${fmt(w.wind_speed, " m/s")}` : ""} />
      </div>

      <div className="sec-title">Trends</div>
      <Trends batch={batchId} />

      <div className="sec-title">Tray Monitoring</div>
      <div className="stats">
        <Stat label="Readiness" value={latestAnalyzed ? (latestAnalyzed.ready ? "READY" : `${latestAnalyzed.ready_cells}/${latestAnalyzed.occupied_cells}`) : "—"} tone={latestAnalyzed?.ready ? "ok" : ""} sub="ready / occupied holes" />
        <Stat label="Photos" value={data.imageCount} href={photosHref} />
      </div>

      <CameraControl camera={data.camera} onChange={reload} />

      <div className="two">
        <div className="card">
          <div className="row head">
            <h3>Recent Pictures</h3>
            {data.imageCount > 0 && <a className="link" href={photosHref}>View all {data.imageCount} <Icon name="arrow_forward" /></a>}
          </div>
          {recentImages.length === 0 ? <Empty icon="photo_camera">No pictures yet. Photos appear here once the camera node uploads.</Empty> : (
            <div className="thumbs">
              {recentImages.map((im) => (
                <img key={im.id} src={im.url} loading="lazy" alt={`Tray photo, Day ${dayOf(batch.started_at, im.ts)}, ${when(im.ts)}`}
                  title={`Day ${dayOf(batch.started_at, im.ts)} · ${when(im.ts)}`} className={shown?.id === im.id ? "sel" : ""} onClick={() => setSelected(im)} />
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3>Tray Analysis {shown && <small className="muted">· Day {dayOf(batch.started_at, shown.ts)} · {when(shown.ts)}</small>}</h3>
          {!shown && <Empty icon="eco">Analysis shows up after the first photo.</Empty>}
          {shown && <img src={shown.url} className="big" alt="Selected tray" />}
          {shown && <button className="btn ghost block" onClick={analyze} disabled={busy}>{busy ? "Analyzing..." : a ? "Re-analyze" : "Analyze this photo"}</button>}
          {a && (
            <>
              <div className="metrics">
                <div><b>{a.ready_cells}</b>ready</div>
                <div><b>{a.occupied_cells}</b>occupied</div>
                <div><b>{a.total_cells}</b>holes</div>
                <div><b>{fmt(a.canopy_pct, "%")}</b>canopy</div>
              </div>
              <p className="result">{a.ready ? <b className="chip ready"><Icon name="check_circle" fill />Ready for transplant</b> : <b className="chip notready">Not Ready Yet</b>}</p>
              <TrayGrid analysis={a} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
