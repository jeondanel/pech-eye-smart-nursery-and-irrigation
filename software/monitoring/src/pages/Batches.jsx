import { api } from "../api.js";
import { Empty, Icon, Skel } from "../ui.jsx";
import { dayOf, longDate, usePoll } from "../lib.js";
import { BatchActions } from "./Dashboard.jsx";

export const STATUS_LABEL = { growing: "Monitoring", transplanted: "Transplanted", stopped: "Stopped" };

export default function Batches() {
  const { data, error, reload } = usePoll(() => api.batches(), [], 15000);
  if (error && !data) return <div className="card"><Empty icon="cloud_off">Cannot load batches ({error.message}).</Empty></div>;
  if (!data) return <><Skel /><Skel /></>;

  return (
    <>
      <div className="page-head">
        <h2>Batches</h2>
        <p className="muted small">The current batch opens on the Dashboard; ended batches open as records.</p>
      </div>

      {data.length === 0 && (
        <div className="card"><Empty icon="potted_plant">No batches yet. Press <b>Start monitoring</b> on the <a className="link" href="#/dashboard">Dashboard</a>.</Empty></div>
      )}
      {data.map((b) => {
        const growing = b.status === "growing";
        return (
          <div className="card" key={b.id}>
            <div className="row">
              <div>
                <h3 className="batch-title">{b.name} <span className={`pill ${b.status}`}>{STATUS_LABEL[b.status]}</span></h3>
                <p className="muted small">
                  Started {longDate(b.started_at)}{b.ended_at && ` · ended ${longDate(b.ended_at)}`} · {growing ? "now on" : "lasted to"} Day {dayOf(b.started_at, b.ended_at || Date.now())}
                </p>
                {b.notes && <p className="muted small">Note: {b.notes}</p>}
              </div>
              {growing
                ? <div className="batch-actions"><a className="btn ghost" href="#/dashboard">Dashboard</a><BatchActions batch={b} onDone={reload} /></div>
                : <a className="btn ghost" href={`#/records/${b.id}`}>View record <Icon name="arrow_forward" /></a>}
            </div>
          </div>
        );
      })}
    </>
  );
}
