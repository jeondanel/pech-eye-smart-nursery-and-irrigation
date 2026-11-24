import { useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { api } from "../api.js";
import { Empty, Icon, Skel } from "../ui.jsx";
import { SENSORS, clockTimeSec, dayKey, fmt, fullDate, rangeLabel, sensorStatus, shortDate, useChart, usePoll, water, when } from "../lib.js";

const RANGES = [7, 14, 30];
const axisOf = (c) => ({ tick: { fill: c.tick, fontSize: 11, fontFamily: "Poppins" }, stroke: c.axis, tickLine: false });

function RangePicker({ days, setDays, from }) {
  return (
    <div className="range">
      <div className="pills">
        {RANGES.map((d) => <button key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>{d} Days</button>)}
      </div>
      <span className="range-label">{rangeLabel(from, Date.now())}</span>
    </div>
  );
}

function StatBox({ label, value, sub }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

const groupBy = (rows, keyFn) => {
  const m = new Map();
  rows.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
};
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ---------- temperature / humidity / soil ---------- */

function SensorPage({ cfg, data, days, setDays }) {
  const c = useChart(), axis = axisOf(c);
  const noun = cfg.title.toLowerCase();
  const rows = data.readings.filter((r) => r[cfg.key] != null);
  const period = `Last ${days} days`;

  let current = null, mean = null, hi = null, lo = null;
  if (rows.length) {
    current = rows[rows.length - 1];
    mean = avg(rows.map((r) => r[cfg.key]));
    hi = rows.reduce((a, b) => (b[cfg.key] > a[cfg.key] ? b : a));
    lo = rows.reduce((a, b) => (b[cfg.key] < a[cfg.key] ? b : a));
  }

  // Chart: daily averages, or hourly when there are only one or two days of data.
  const byDay = groupBy(rows, (r) => dayKey(r.ts));
  const hourly = byDay.size <= 2;
  const buckets = hourly
    ? groupBy(rows, (r) => { const d = new Date(r.ts); d.setMinutes(0, 0, 0); return d.getTime(); })
    : byDay;
  const chart = [...buckets].map(([k, rs]) => ({
    label: hourly ? when(k) : shortDate(k),
    value: +avg(rs.map((r) => r[cfg.key])).toFixed(1),
  }));

  // Table: one reading per hour (the last one in that hour), newest first, grouped by day.
  const tableDays = [...byDay].reverse().map(([k, rs]) => {
    const perHour = [...groupBy(rs, (r) => new Date(r.ts).getHours()).values()].map((h) => h[h.length - 1]);
    return { day: k, rows: perHour.reverse() };
  });

  return (
    <>
      <div className="page-head">
        <h2>{cfg.title} History</h2>
        <p className="muted small">Inside the nursery chamber.</p>
      </div>
      <div className="stats four">
        <StatBox label={`Current ${noun}`} value={fmt(current?.[cfg.key], ` ${cfg.unit}`)} sub={current ? `as of ${when(current.ts)}` : "No data"} />
        <StatBox label={`Average ${noun}`} value={fmt(mean, ` ${cfg.unit}`)} sub={period} />
        <StatBox label={`Highest ${noun}`} value={fmt(hi?.[cfg.key], ` ${cfg.unit}`)} sub={hi ? when(hi.ts) : period} />
        <StatBox label={`Lowest ${noun}`} value={fmt(lo?.[cfg.key], ` ${cfg.unit}`)} sub={lo ? when(lo.ts) : period} />
      </div>

      <div className="card chart-box">
        {chart.length === 0 ? <Empty icon="monitoring">No {noun} readings in this period.</Empty> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <XAxis dataKey="label" {...axis} minTickGap={24} tickMargin={8} />
              <YAxis {...axis} domain={["auto", "auto"]} width={46} tickFormatter={(v) => Math.round(v)} />
              <Tooltip contentStyle={c.tooltip} formatter={(v) => [`${v} ${cfg.unit}`, `Avg ${noun}`]} />
              <Line isAnimationActive={false} type="linear" dataKey="value" stroke={c.lines[1]} strokeWidth={1.3} dot={{ r: 4, fill: c.dot, stroke: "none" }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="caption">{hourly ? "Hourly" : "Daily"} average {noun} for the last {days} days.</p>

      <div className="page-head">
        <h2>Historical Readings</h2>
        <p className="muted small">Filter by time period.</p>
      </div>
      <RangePicker days={days} setDays={setDays} from={data.from} />

      {tableDays.length === 0 && <div className="card"><Empty icon="table_rows">No readings in this period.</Empty></div>}
      {tableDays.map(({ day, rows: rs }) => (
        <div className="day-table" key={day}>
          <div className="day-head">{fullDate(day)}</div>
          <table>
            <thead><tr><th>Time</th><th className="c">{cfg.title}</th><th className="r">Status</th></tr></thead>
            <tbody>
              {rs.map((r) => {
                const st = sensorStatus(cfg, r[cfg.key]);
                return (
                  <tr key={r.ts}>
                    <td className="t">{clockTimeSec(r.ts)}</td>
                    <td className="c v">{fmt(r[cfg.key], ` ${cfg.unit}`)}</td>
                    <td className={`r st ${st.tone}`}>{st.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/* ---------- mist reservoir ---------- */

function ReservoirPage({ data, days, setDays }) {
  const c = useChart(), axis = axisOf(c);
  const { readings, runs } = data;
  const last = [...readings].reverse().find((r) => r.reservoir_low != null);
  const metered = runs.some((r) => r.water_ml != null);
  const total = metered ? runs.reduce((a, r) => a + (r.water_ml || 0), 0) : null;
  const period = `Last ${days} days`;

  // One bar pair per day: share of readings with the reservoir OK, and water used.
  const okByDay = groupBy(readings.filter((r) => r.reservoir_low != null), (r) => dayKey(r.ts));
  const runsByDay = groupBy(runs, (r) => dayKey(r.started_at));
  const chart = [];
  for (let d = new Date(data.from); dayKey(d) <= dayKey(Date.now()); d.setDate(d.getDate() + 1)) {
    const k = dayKey(d), rs = okByDay.get(k), us = runsByDay.get(k);
    if (!rs && !us) continue;
    chart.push({
      label: shortDate(k),
      ok: rs ? Math.round((rs.filter((r) => !r.reservoir_low).length / rs.length) * 100) : null,
      used: us && metered ? Math.round(us.reduce((a, r) => a + (r.water_ml || 0), 0)) : null,
      runs: us?.length || 0,
    });
  }

  return (
    <>
      <div className="page-head">
        <h2>Mist Reservoir</h2>
        <p className="muted small">Mist reservoir level and water use.</p>
      </div>
      <div className="stats four">
        <StatBox label="Current reservoir level" value={last ? (last.reservoir_low ? "LOW" : "OK") : "—"} sub={last ? `Float switch, ${when(last.ts)}` : "No data"} />
        <StatBox label="Misting done" value={runs.length} sub={period} />
        <StatBox label="Average water consumption per day" value={metered ? water(total / days) : "—"} sub={metered ? period : "Set MIST_ML_PER_MIN on the server"} />
        <StatBox label="Total water consumption" value={metered ? water(total) : "—"} sub={period} />
      </div>

      <div className="card chart-box">
        {chart.length === 0 ? <Empty icon="water_drop">No reservoir data in this period.</Empty> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart} margin={{ top: 10, right: 0, left: -12, bottom: 0 }} barGap={6}>
              <XAxis dataKey="label" {...axis} tickMargin={8} />
              <YAxis yAxisId="pct" {...axis} domain={[0, 100]} width={46} unit="%" />
              <YAxis yAxisId="right" orientation="right" {...axis} width={70} unit={metered ? " mL" : ""} allowDecimals={false} />
              <Tooltip contentStyle={c.tooltip} cursor={{ fill: c.cursor }}
                formatter={(v, name) => [name === "Reservoir OK" ? `${v}% of readings` : metered ? `${v} mL` : v, name]} />
              <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontFamily: "Poppins", fontSize: 12, paddingTop: 10 }} />
              <Bar isAnimationActive={false} yAxisId="pct" dataKey="ok" name="Reservoir OK" fill={c.bars[0]} radius={[3, 3, 0, 0]} maxBarSize={40} />
              {metered
                ? <Bar isAnimationActive={false} yAxisId="right" dataKey="used" name="Water consumed" fill={c.bars[1]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                : <Bar isAnimationActive={false} yAxisId="right" dataKey="runs" name="Misting runs" fill={c.bars[1]} radius={[3, 3, 0, 0]} maxBarSize={40} />}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="page-head">
        <h2>Historical Readings</h2>
        <p className="muted small">Misting runs, filtered by time period.</p>
      </div>
      <RangePicker days={days} setDays={setDays} from={data.from} />

      <div className="day-table">
        <table>
          <thead><tr><th>Date</th><th className="r">Time</th><th className="r">Duration</th><th className="r">Water consumed</th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={4} className="none">No misting recorded in this period.</td></tr>}
            {runs.map((r) => (
              <tr key={r.started_at}>
                <td className="t">{shortDate(r.started_at)}, {new Date(r.started_at).getFullYear()}</td>
                <td className="r t">{clockTimeSec(r.started_at)}</td>
                <td className="r v">{Math.round(r.duration_s)} s</td>
                <td className="r v">{water(r.water_ml)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- route ---------- */

export default function SensorHistory({ kind }) {
  const [days, setDays] = useState(7);
  const { data, error } = usePoll(`history:${days}`, () => api.history(days), 60000);
  const cfg = SENSORS[kind];

  return (
    <>
      <a className="back" href="#/dashboard"><Icon name="arrow_back" />Dashboard</a>
      {error && !data ? <div className="card"><Empty icon="cloud_off">Cannot load history ({error.message}).</Empty></div>
        : !data ? <><Skel /><Skel h={280} /></>
        : kind === "reservoir" ? <ReservoirPage data={data} days={days} setDays={setDays} />
        : cfg ? <SensorPage cfg={cfg} data={data} days={days} setDays={setDays} />
        : <div className="card"><Empty icon="help">Unknown sensor.</Empty></div>}
    </>
  );
}

