import { api } from "../api.js";
import { Empty, Icon, Skel, Stat } from "../ui.jsx";
import { dayOf, fmt, longDate, usePoll, water } from "../lib.js";
import { BatchPhotos } from "./Photos.jsx";
import { Trends, stageOf } from "./Dashboard.jsx";
import { STATUS_LABEL } from "./Batches.jsx";

// Stand-alone page (no navigation bar) for a batch that has ended.
export default function Record({ id }) {
  const { data, error } = usePoll(() => api.images(id), [id], 60000);

  if (error && !data) return <><Back /><div className="card"><Empty icon="cloud_off">Cannot load this record ({error.message}).</Empty></div></>;
  if (!data) return <><Back /><Skel /><Skel h={220} /></>;

  const b = data.batch;
  if (b.status === "growing") { window.location.hash = "#/dashboard"; return null; }
  const s = b.summary;

  return (
    <>
      <Back />
      <div className="card hero">
        <div>
          <p className="eyebrow">Batch Record</p>
          <h2>{b.name} <span className={`pill ${b.status}`}>{STATUS_LABEL[b.status]}</span></h2>
          <p className="muted small">
            {longDate(b.started_at)} to {longDate(b.ended_at)} · Day 1 to Day {dayOf(b.started_at, b.ended_at)}
          </p>
          {b.notes && <p className="muted small">Note: {b.notes}</p>}
        </div>
      </div>

      {s && (
        <>
          <div className="sec-title">Summary</div>
          <div className="stats">
            <Stat label="Growing period" value={`${dayOf(b.started_at, b.ended_at)} days`} sub={`${s.duration_hours} h`} />
            <Stat label="Avg temperature" value={fmt(s.avg_temperature, "°C")} sub={s.min_temperature != null ? `${fmt(s.min_temperature)} to ${fmt(s.max_temperature)}` : ""} />
            <Stat label="Avg humidity" value={fmt(s.avg_humidity, "%")} sub={s.min_humidity != null ? `${fmt(s.min_humidity)} to ${fmt(s.max_humidity)}` : ""} />
            <Stat label="Avg soil moisture" value={fmt(s.avg_soil_moisture, "%")} sub={s.min_soil_moisture != null ? `${fmt(s.min_soil_moisture)} to ${fmt(s.max_soil_moisture)}` : ""} />
            {s.mist_runs != null && <Stat label="Misting" value={s.mist_runs} sub={s.water_ml ? `${water(s.water_ml)} used` : "runs"} />}
            <Stat label="Outdoor avg temp" value={fmt(s.outdoor_avg_temp, "°C")} sub={`${fmt(s.outdoor_avg_humidity)}% RH`} />
            <Stat label="Photos / readings" value={`${s.images} / ${s.readings}`} />
            {s.final_analysis && <Stat label="Final tray" value={stageOf(s.final_analysis)} sub={`${fmt(s.final_analysis.canopy_pct, "%")} green`} />}
          </div>
        </>
      )}

      <div className="sec-title">Sensor Trends</div>
      <Trends batch={b.id} links={false} />

      <div className="sec-title">Photos</div>
      <BatchPhotos batchId={b.id} mode="day" />
    </>
  );
}

const Back = () => <a className="back" href="#/batches"><Icon name="arrow_back" />Batches</a>;
