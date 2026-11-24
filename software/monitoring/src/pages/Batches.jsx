import { useCallback, useState } from "react";
import { api } from "../api.js";
import { Dialog, Empty, Icon, Skel } from "../ui.jsx";
import { dayOf, fullDate, longDate, usePoll } from "../lib.js";
import { BatchActions } from "./Dashboard.jsx";

// "Batch 6" -> 6 (same numbering as the server).
const num = (b) => Number(/^Batch (\d+)$/.exec(b.name)?.[1]) || 0;

export const STATUS_LABEL ={ growing: "Monitoring", transplanted: "Transplanted", stopped: "Stopped" };

// Ended batches: deletable right away when nothing was recorded, otherwise 30 days after they ended
// (the server enforces the same rule and sends the unlock date as deletable_from).
// latest: the highest-numbered batch, whose name the next batch reuses once it is deleted.
function DeleteBatch({ batch, latest, onDone }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const close = useCallback(() => { setAsk(false); setErr(null); }, []);
  const unlocked = batch.deletable_from && Date.now() >= new Date(batch.deletable_from);
  const del = async () => {
    setBusy(true); setErr(null);
    try { await api.deleteBatch(batch.id); setAsk(false); onDone(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <button className="btn danger" disabled={!unlocked} onClick={() => setAsk(true)}
        title={unlocked ? "" : `Batches with records can be deleted 30 days after they end (from ${fullDate(batch.deletable_from)}).`}>
        <Icon name="delete" />{unlocked ? "Delete" : `Delete from ${longDate(batch.deletable_from)}`}
      </button>
      {ask && (
        <Dialog icon="delete" tone="bad" title={`Delete ${batch.name}?`} onClose={close}>
          <p className="muted">
            {batch.empty
              ? "Nothing was recorded for this batch."
              : "Its sensor readings, misting log, alerts and photos are deleted for good."}
            {latest && <>{" "}The name {batch.name} will be used by the next batch you start.</>}
          </p>
          {err && <div className="err">{err}</div>}
          <div className="modal-actions">
            <button className="btn ghost" autoFocus onClick={close}>Cancel</button>
            <button className="btn danger" disabled={busy} onClick={del}>{busy ? "Deleting..." : "Delete"}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export default function Batches() {
  const { data, error, reload } = usePoll("batches", () => api.batches(), 15000);
  if (error && !data) return <div className="card"><Empty icon="cloud_off">Cannot load batches ({error.message}).</Empty></div>;
  if (!data) return <><Skel /><Skel /></>;
  const top = Math.max(0, ...data.map(num));

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
                  {!growing && b.empty && " · nothing recorded"}
                </p>
                {b.notes && <p className="muted small">Note: {b.notes}</p>}
              </div>
              {growing
                ? <div className="batch-actions"><a className="btn ghost" href="#/dashboard">Dashboard</a><BatchActions batch={b} onDone={reload} /></div>
                : (
                  <div className="batch-actions">
                    <a className="btn ghost" href={`#/records/${b.id}`}>View record <Icon name="arrow_forward" /></a>
                    <DeleteBatch batch={b} latest={num(b) === top} onDone={reload} />
                  </div>
                )}
            </div>
          </div>
        );
      })}
    </>
  );
}
