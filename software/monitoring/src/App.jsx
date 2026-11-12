import { useCallback, useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { api } from "./api.js";

const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}${unit}`);
const when = (iso) => new Date(iso).toLocaleString();

function usePoll(fn, deps, ms = 10000) {
  const [state, set] = useState({ data: null, error: null });
  const run = useCallback(() => fn().then((data) => set({ data, error: null })).catch((error) => set((s) => ({ ...s, error }))), deps); // eslint-disable-line
  useEffect(() => { run(); const t = setInterval(run, ms); return () => clearInterval(t); }, [run, ms]);
  return { ...state, reload: run };
}

function Stat({ label, value, sub }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

const STATE_COLOR = { empty: "#d9d9d9", growing: "#9ccc65", ready: "#2e7d32" };

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
          <span key={k}><i style={{ background: c }} /> {k}</span>
        ))}
      </div>
    </div>
  );
}

function Charts({ batch }) {
  const { data } = usePoll(() => api.readings(batch), [batch]);
  if (!data) return null;
  const rows = data.map((r) => ({ ...r, time: new Date(r.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  const chart = (title, lines) => (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted">No readings yet — sensors not connected.</p> : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" minTickGap={40} fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip /><Legend />
            {lines.map(([k, name, color]) => <Line key={k} type="monotone" dataKey={k} name={name} stroke={color} dot={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
  return (
    <div className="two">
      {chart("Humidity & soil moisture (%)", [["humidity", "Humidity", "#1e88e5"], ["soil_moisture", "Soil moisture", "#6d4c41"]])}
      {chart("Plant height (cm) — ultrasonic", [["height_cm", "Height", "#2e7d32"]])}
    </div>
  );
}

function Dashboard({ batchId }) {
  const { data, error, reload } = usePoll(() => api.dashboard(batchId), [batchId]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  if (error && !data) return <p className="error">Cannot reach server: {error.message}</p>;
  if (!data) return <p>Loading…</p>;
  const { batch, latestReading: r, recentImages, latestAnalyzed } = data;
  // Same rules as the sensor node's decision engine (firmware evaluateIrrigationDecision)
  const w = data.weather;
  const decision = !w || !r ? ["—", "waiting for weather + sensor data"]
    : (w.rain_chance_24h >= 50 || w.rain_1h > 0.5) ? ["LOCKOUT", "rain risk — defer irrigation"]
    : (r.temperature > 32 && r.humidity < 60) ? ["OVERRIDE", "heat stress — mist recommended"]
    : ["PERMITTED", "clear weather — normal schedule"];
  const shown = selected || latestAnalyzed || recentImages[0];
  const a = shown?.analysis;

  const analyze = async () => {
    setBusy(true);
    try { setSelected(await api.analyze(shown.id)); reload(); } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="stats">
        <Stat label="Batch" value={batch.name} sub={batch.status === "growing" ? `Day ${data.daysGrowing.toFixed(1)}` : "Transplanted"} />
        <Stat label="Humidity" value={fmt(r?.humidity, "%")} sub={r ? when(r.ts) : "no sensor data"} />
        <Stat label="Chamber temp" value={fmt(r?.temperature, "°C")} />
        <Stat label="Mist reservoir" value={r?.reservoir_low == null ? "—" : r.reservoir_low ? "LOW ⚠️" : "OK 💧"} sub={r?.reservoir_low ? "refill needed" : ""} />
        <Stat label="Soil moisture" value={fmt(r?.soil_moisture, "%")} />
        <Stat label="Plant height" value={fmt(r?.height_cm, " cm")} />
        <Stat label="Photos" value={data.imageCount} />
        <Stat label="Outdoor weather" value={fmt(data.weather?.temp, "°C")} sub={data.weather ? `${data.weather.description}, ${data.weather.humidity}% RH` : "OpenWeather not configured"} />
        <Stat label="Rain chance (24h)" value={data.weather?.rain_chance_24h == null ? "—" : `${Math.round(data.weather.rain_chance_24h)}%`} sub={data.weather ? `wind ${fmt(data.weather.wind_speed, " m/s")}` : ""} />
        <Stat label="Irrigation decision" value={decision[0]} sub={decision[1]} />
        <Stat label="Readiness" value={latestAnalyzed ? (latestAnalyzed.ready ? "READY ✅" : `${latestAnalyzed.ready_cells}/${latestAnalyzed.occupied_cells}`) : "—"} sub="ready plants / occupied holes" />
      </div>

      <Charts batch={batchId} />

      <div className="two">
        <div className="card">
          <h3>Recent pictures</h3>
          {recentImages.length === 0 ? <p className="muted">No pictures yet. Once the ESP32-S3-CAM uploads, they appear here.</p> : (
            <div className="thumbs">
              {recentImages.map((im) => (
                <img key={im.id} src={im.url} loading="lazy" title={when(im.ts)} className={shown?.id === im.id ? "sel" : ""} onClick={() => setSelected(im)} />
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3>ExG tray analysis {shown && <small className="muted">— {when(shown.ts)}</small>}</h3>
          {shown && <img src={shown.url} className="big" />}
          {shown && <button onClick={analyze} disabled={busy}>{busy ? "Analyzing…" : a ? "Re-analyze" : "Analyze this photo"}</button>}
          {a && (
            <>
              <p>
                <b>{a.ready_cells}</b> ready · <b>{a.occupied_cells}</b> occupied · <b>{a.total_cells}</b> holes · canopy <b>{fmt(a.canopy_pct, "%")}</b>
                {" "}→ {a.ready ? <b className="ok">Ready for transplant</b> : <b>Not ready yet</b>}
              </p>
              <TrayGrid analysis={a} />
              {a.notes && <p className="muted">{a.notes}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Batches({ onOpen }) {
  const { data, reload } = usePoll(() => api.batches(), [], 15000);
  if (!data) return <p>Loading…</p>;
  const growing = data.find((b) => b.status === "growing");
  const transplant = async (b) => {
    if (!confirm(`Mark ${b.name} as transplanted? This closes the logs and creates the summary.`)) return;
    try { await api.transplant(b.id); reload(); } catch (e) { alert(e.message); }
  };
  const start = async () => { try { await api.newBatch(); reload(); } catch (e) { alert(e.message); } };
  return (
    <>
      {!growing && <button onClick={start}>Start new batch</button>}
      {data.map((b) => (
        <div className="card" key={b.id}>
          <div className="row">
            <h3>{b.name} <span className={`pill ${b.status}`}>{b.status}</span></h3>
            <div>
              <button className="ghost" onClick={() => onOpen(b.id)}>View dashboard</button>{" "}
              {b.status === "growing" && <button onClick={() => transplant(b)}>Mark as transplanted</button>}
            </div>
          </div>
          <p className="muted">Started {when(b.started_at)}{b.ended_at && ` · Ended ${when(b.ended_at)}`}</p>
          {b.summary ? (
            <div className="stats">
              <Stat label="Growing period" value={`${b.summary.duration_days} days`} sub={`${b.summary.duration_hours} h`} />
              <Stat label="Avg humidity" value={fmt(b.summary.avg_humidity, "%")} sub={`${fmt(b.summary.min_humidity)}–${fmt(b.summary.max_humidity)}`} />
              <Stat label="Avg soil moisture" value={fmt(b.summary.avg_soil_moisture, "%")} sub={`${fmt(b.summary.min_soil_moisture)}–${fmt(b.summary.max_soil_moisture)}`} />
              <Stat label="Max height" value={fmt(b.summary.max_height_cm, " cm")} />
              <Stat label="Outdoor avg temp" value={fmt(b.summary.outdoor_avg_temp, "°C")} sub={`${fmt(b.summary.outdoor_avg_humidity)}% RH`} />
              <Stat label="Photos / readings" value={`${b.summary.images} / ${b.summary.readings}`} />
              {b.summary.final_analysis && <Stat label="Final tray" value={`${b.summary.final_analysis.ready_cells}/${b.summary.final_analysis.occupied_cells} ready`} />}
            </div>
          ) : <p className="muted">Summary is generated when the batch is transplanted.</p>}
        </div>
      ))}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [batchId, setBatchId] = useState(null);
  return (
    <div className="app">
      <header>
        <h1>🌱 PECH-EYE</h1>
        <nav>
          <button className={tab === "dashboard" ? "on" : ""} onClick={() => { setTab("dashboard"); setBatchId(null); }}>Dashboard</button>
          <button className={tab === "batches" ? "on" : ""} onClick={() => setTab("batches")}>Batches & summaries</button>
        </nav>
      </header>
      {tab === "dashboard" ? <Dashboard batchId={batchId} key={batchId} /> : <Batches onOpen={(id) => { setBatchId(id); setTab("dashboard"); }} />}
    </div>
  );
}
