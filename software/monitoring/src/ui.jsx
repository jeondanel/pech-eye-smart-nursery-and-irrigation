import { useEffect, useState } from "react";
import { applyTheme, dayOf, useNow, useTheme } from "./lib.js";

// Google Material Symbols (Rounded), loaded in index.html. Names: https://fonts.google.com/icons
export const Icon = ({ name, className = "", fill = false }) => (
  <span className={`ms ${fill ? "fill" : ""} ${className}`} aria-hidden="true">{name}</span>
);

// public/logo-light-mode.png and public/logo-dark-mode.png, picked by the theme.
// If the file is missing, a leaf icon is shown instead.
export function Logo({ size = 36 }) {
  const theme = useTheme();
  const src = `/logo-${theme}-mode.png`;
  const [failed, setFailed] = useState(null);
  return (
    <span className="logo" style={{ width: size, height: size }}>
      {failed === src ? <Icon name="eco" /> : <img src={src} alt="" onError={() => setFailed(src)} />}
    </span>
  );
}

export function ThemeToggle() {
  const dark = useTheme() === "dark";
  return (
    <button className="theme-btn" onClick={() => applyTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      <Icon name={dark ? "light_mode" : "dark_mode"} />
    </button>
  );
}

// Small round status light, e.g. camera online/offline.
export const StatusDot = ({ on, label }) => (
  <span className={`status-dot ${on ? "on" : "off"}`}><i />{label}</span>
);

export function Clock() {
  const now = useNow(1000);
  return (
    <div className="clock" aria-live="off">
      <b>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</b>
      <small>{now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</small>
    </div>
  );
}

export function Stat({ label, value, sub, tone, href }) {
  const inner = (
    <>
      <div className="label">{label}{href && <Icon name="arrow_outward" className="go" />}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </>
  );
  return href
    ? <a className={`card stat link-card ${tone || ""}`} href={href}>{inner}</a>
    : <div className={`card stat ${tone || ""}`}>{inner}</div>;
}

export const Empty = ({ icon, children }) => (
  <div className="empty"><Icon name={icon} />{children}</div>
);

export const Skel = ({ h = 90 }) => <div className="skel" style={{ height: h }} />;

export function Login({ wrong, busy, onSubmit }) {
  const [p, setP] = useState("");
  return (
    <form className="card login" onSubmit={(e) => { e.preventDefault(); onSubmit(p); }}>
      <Logo size={64} />
      <h2>Pech-Eye</h2>
      <p className="muted">Enter the dashboard password to continue.</p>
      <input type="password" autoFocus autoComplete="current-password" placeholder="Password" value={p} onChange={(e) => setP(e.target.value)} />
      {wrong && <div className="err">Wrong password. Try again.</div>}
      <button className="btn block" type="submit" disabled={busy}>{busy ? "Checking..." : "Open dashboard"}</button>
    </form>
  );
}

// Full-screen photo viewer. images are newest first; left = previous, right = next.
export function Lightbox({ images, index, start, onIndex, onClose }) {
  const im = images[index];
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [index, images.length, onClose, onIndex]);
  if (!im) return null;
  const day = start ? dayOf(start, im.ts) : null;
  const ts = new Date(im.ts);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lb-in" onClick={(e) => e.stopPropagation()}>
        <div className="lb-top">
          {day ? `DAY ${day}` : "PHOTO"} - {ts.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, {ts.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        <div className="lb-img">
          <img src={im.url} alt={`Tray photo${day ? `, Day ${day}` : ""}`} />
          <button className="lb-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="lb-bot">
          <button className="lb-nav" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label="Previous photo"><Icon name="west" /></button>
          <span>
            {im.analysis ? `${im.analysis.stage_label || (im.ready ? "Full of green" : "Growing")}, ${im.canopy_pct}% green` : "not analyzed"} - {index + 1} of {images.length} - <a href={im.url} target="_blank" rel="noreferrer">Full Size</a>
          </span>
          <button className="lb-nav" disabled={index >= images.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next photo"><Icon name="east" /></button>
        </div>
      </div>
    </div>
  );
}

// Photo card used in the galleries: green frame, time pill, expand button.
export function Shot({ im, label, onOpen }) {
  return (
    <button className="shot" onClick={onOpen}>
      <img src={im.url} loading="lazy" alt={`Tray photo, ${label}`} />
      <span className="expand"><Icon name="open_in_full" /></span>
      <span className="cap">{label}</span>
    </button>
  );
}
