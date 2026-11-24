import { useCallback, useState } from "react";
import { api } from "../api.js";
import { Empty, Icon, Lightbox, Shot, Skel } from "../ui.jsx";
import { clockTime, dayOf, longDate, usePoll } from "../lib.js";

const TABS = [
  ["current", "Current Batch"],
  ["growing", "Growing Batch"],
  ["transplanted", "Transplanted Batch"],
];

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const dateTime = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

// Photos of one batch. mode "day": every photo grouped by day. "growth": the last photo of each day.
export function BatchPhotos({ batchId, mode, header }) {
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const { data, error } = usePoll(`images:${batchId}`, () => api.images(batchId), 20000);

  if (error && !data) return <div className="card"><Empty icon="cloud_off">Cannot load photos ({error.message}).</Empty></div>;
  if (!data) return <Skel h={240} />;

  const { batch } = data;
  if (!batch) return <div className="card"><Empty icon="potted_plant">No batch is being monitored. Start one from the <a className="link" href="#/dashboard">Dashboard</a>.</Empty></div>;
  const start = batch.started_at;
  const days = [];
  data.images.forEach((im) => {
    const d = dayOf(start, im.ts);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, ts: im.ts, items: [] });
    days[days.length - 1].items.push(im);
  });
  // The lightbox walks through exactly the photos shown on screen.
  const images = mode === "growth" ? days.map((g) => g.items[0]) : data.images;

  return (
    <>
      {header?.(batch, data.images.length)}
      {images.length === 0 ? <div className="card"><Empty icon="photo_camera">No photos for this batch yet.</Empty></div>
        : mode === "growth" ? (
          <>
            <p className="muted small">The latest photo of each day, to follow how {batch.name} is growing.</p>
            <div className="gallery">
              {images.map((im, i) => (
                <Shot key={im.id} im={im} onOpen={() => setOpen(i)}
                  label={`Day ${dayOf(start, im.ts)}${im.analysis ? ` · ${im.canopy_pct}% green` : ""}`} />
              ))}
            </div>
          </>
        ) : days.map((g) => (
          <section key={g.day}>
            <div className="sec-title day-title">Day {g.day} <span>· {longDate(g.ts)} · {plural(g.items.length, "photo")}</span></div>
            <div className="gallery">
              {g.items.map((im) => (
                <Shot key={im.id} im={im} label={clockTime(im.ts)} onOpen={() => setOpen(images.indexOf(im))} />
              ))}
            </div>
          </section>
        ))}
      {open !== null && <Lightbox images={images} index={open} start={start} onIndex={setOpen} onClose={close} />}
    </>
  );
}

function TransplantedList() {
  const { data, error } = usePoll("batches", () => api.batches(), 60000);
  if (error && !data) return <div className="card"><Empty icon="cloud_off">Cannot load batches ({error.message}).</Empty></div>;
  if (!data) return <Skel h={200} />;
  const done = data.filter((b) => b.status === "transplanted");
  return (
    <>
      <p className="muted small">Photo gallery per batch</p>
      {done.length === 0 ? <div className="card"><Empty icon="potted_plant">No transplanted batches yet.</Empty></div> : (
        <div className="batch-cards">
          {done.map((b) => (
            <a key={b.id} className="batch-card" href={`#/photos?tab=transplanted&batch=${b.id}`}>
              <div className="cover">
                {b.cover ? <img src={b.cover} alt="" loading="lazy" /> : <Icon name="image" />}
                <div className="cover-text"><b>{b.name}</b><small>Transplanted</small></div>
                <span className="go-btn"><Icon name="arrow_outward" /></span>
              </div>
              <small className="date">Date: {dateTime(b.ended_at)}</small>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export default function Photos({ params }) {
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : "current";
  const current = usePoll("batches", () => api.batches(), 60000).data?.find((b) => b.status === "growing");

  return (
    <>
      <div className="page-head">
        <h2>Photos</h2>
        {current && <p className="muted small">{current.name} · started {longDate(current.started_at)}</p>}
      </div>

      <nav className="seg" aria-label="Photo views">
        {TABS.map(([k, label]) => <a key={k} href={`#/photos?tab=${k}`} className={tab === k ? "on" : ""}>{label}</a>)}
      </nav>

      {tab === "current" && <BatchPhotos key="current" mode="day" header={(_b, n) => <p className="muted small">{plural(n, "photo")}</p>} />}
      {tab === "growing" && <BatchPhotos key="growing" mode="growth" />}
      {tab === "transplanted" && (params.batch
        ? <BatchPhotos key={params.batch} batchId={params.batch} mode="day" header={(b, n) => (
            <div className="row">
              <p className="small">{b.name} · {plural(n, "Photo")} · transplanted {b.ended_at ? longDate(b.ended_at) : "-"}</p>
              <a className="link" href="#/photos?tab=transplanted"><Icon name="arrow_back" />All batches</a>
            </div>
          )} />
        : <TransplantedList />)}
    </>
  );
}
