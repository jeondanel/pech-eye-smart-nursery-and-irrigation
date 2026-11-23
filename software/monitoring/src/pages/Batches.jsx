import { api } from "../api.js";
import { Empty, Icon, Skel, Stat } from "../ui.jsx";
import { dayOf, fmt, usePoll, water, when } from "../lib.js";

export default function Batches() {
  const { data, reload } = usePoll(() => api.batches(), [], 15000);
  if (!data) return <><Skel /><Skel /></>;
  const growing = data.find((b) => b.status === "growing");

  const transplant = async (b) => {
    if (!confirm(`Mark ${b.name} as transplanted? This closes the logs and creates the summary.`)) return;
    try { await api.transplant(b.id); reload(); } catch (e) { alert(e.message); }
  };
  const start = async () => { try { await api.newBatch(); reload(); } catch (e) { alert(e.message); } };

  return (
    <>
      <div className="row">
        <div className="page-head">
          <h2>Batches</h2>
          <p className="muted small">Every growing cycle and its summary.</p>
        </div>
        {!growing && <button className="btn" onClick={start}><Icon name="add" />Start new batch</button>}
      </div>

      {data.length === 0 && <div className="card"><Empty icon="potted_plant">No batches yet.</Empty></div>}
      {data.map((b) => {
        const s = b.summary;
        return (
          <div className="card" key={b.id}>
            <div className="row">
              <div>
                <h3 className="batch-title">{b.name} <span className={`pill ${b.status}`}>{b.status}</span></h3>
                <p className="muted small">
                  Started {when(b.started_at)}{b.ended_at && ` · Ended ${when(b.ended_at)}`} · {b.status === "growing" ? "now on" : "lasted to"} Day {dayOf(b.started_at, b.ended_at || Date.now())}
                </p>
              </div>
              <div className="batch-actions">
                <a className="btn ghost" href={`#/dashboard?batch=${b.id}`}>Dashboard</a>
                <a className="btn ghost" href={b.status === "growing" ? "#/photos" : `#/photos?tab=transplanted&batch=${b.id}`}>Photos</a>
                {b.status === "growing" && <button className="btn" onClick={() => transplant(b)}>Mark as transplanted</button>}
              </div>
            </div>
            {s ? (
              <div className="stats summary">
                <Stat label="Growing period" value={`${s.duration_days} d`} sub={`${s.duration_hours} h`} />
                <Stat label="Avg temperature" value={fmt(s.avg_temperature, "°C")} sub={s.min_temperature != null ? `${fmt(s.min_temperature)} to ${fmt(s.max_temperature)}` : ""} />
                <Stat label="Avg humidity" value={fmt(s.avg_humidity, "%")} sub={s.min_humidity != null ? `${fmt(s.min_humidity)} to ${fmt(s.max_humidity)}` : ""} />
                <Stat label="Avg soil moisture" value={fmt(s.avg_soil_moisture, "%")} sub={s.min_soil_moisture != null ? `${fmt(s.min_soil_moisture)} to ${fmt(s.max_soil_moisture)}` : ""} />
                {s.mist_runs != null && <Stat label="Misting" value={s.mist_runs} sub={s.water_ml ? `${water(s.water_ml)} used` : "runs"} />}
                <Stat label="Outdoor avg temp" value={fmt(s.outdoor_avg_temp, "°C")} sub={`${fmt(s.outdoor_avg_humidity)}% RH`} />
                <Stat label="Photos / readings" value={`${s.images} / ${s.readings}`} />
                {s.final_analysis && <Stat label="Final tray" value={`${s.final_analysis.ready_cells}/${s.final_analysis.occupied_cells}`} sub="ready plants" />}
              </div>
            ) : <p className="muted small summary-note">The summary is generated when the batch is transplanted.</p>}
          </div>
        );
      })}
    </>
  );
}
