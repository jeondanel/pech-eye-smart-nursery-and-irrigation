import { useCallback, useEffect, useState } from "react";
import { applyTheme, dayOf, useNow, useTheme } from "./lib.js";
import { snoozeInstall, usePwa } from "./pwa.js";

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

// aboveNav: on phones the tab bar sits at the bottom, so the button floats above it.
export function ThemeToggle({ aboveNav }) {
  const dark = useTheme() === "dark";
  return (
    <button className={`theme-btn ${aboveNav ? "above-nav" : ""}`} onClick={() => applyTheme(dark ? "light" : "dark")}
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

// Themed pop-up (instead of the browser's alert/confirm/prompt). Escape or a click outside closes it.
export function Dialog({ icon, tone = "", title, children, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        {icon && <Icon name={icon} fill className={`modal-ic ${tone}`} />}
        <h2 id="dlg-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// How to install when our button can't open the browser's install dialog.
const InstallSteps = ({ mode }) => (
  <p className="muted small">
    {mode === "ios" && <>Tap <Icon name="ios_share" className="inline-ic" /> <b>Share</b> in Safari, then <b>Add to Home Screen</b>.</>}
    {mode === "manual" && <>Open the browser menu <Icon name="more_vert" className="inline-ic" /> and choose <b>Install app</b> or <b>Add to Home screen</b>.</>}
    {mode === "insecure" && <>Installing needs the secure (https) address of the dashboard. Open the online site, then install it from there.</>}
  </p>
);

// Shown once after logging in (unless installed or snoozed).
export function InstallPopup({ onClose }) {
  const { mode, install } = usePwa();
  if (!mode) return null;
  const later = () => { snoozeInstall(); onClose(); };
  return (
    <Dialog icon="install_mobile" title="Install Pech-Eye" onClose={later}>
      <p className="muted">Add the dashboard to your home screen to open it like an app, full screen and one tap away.</p>
      {mode !== "prompt" && <InstallSteps mode={mode} />}
      <div className="modal-actions">
        <button className="btn ghost" onClick={later}>Not now</button>
        {mode === "prompt"
          ? <button className="btn" autoFocus onClick={async () => { await install(); onClose(); }}><Icon name="download" />Install</button>
          : <button className="btn" autoFocus onClick={onClose}>OK</button>}
      </div>
    </Dialog>
  );
}

// Card at the very bottom of the Dashboard; hidden only once the app is installed (opened from the icon).
// One tappable row: opens the browser's install dialog, or a pop-up with the steps.
export function InstallCard() {
  const { mode, install } = usePwa();
  const [steps, setSteps] = useState(false);
  const close = useCallback(() => setSteps(false), []);
  if (!mode) return null;
  return (
    <>
      <button className="card install-row" onClick={() => (mode === "prompt" ? install() : setSteps(true))}>
        <span className="install-tile"><Icon name="smartphone" /></span>
        <span className="install-text">
          <b>Install PWA</b>
          <small>Install app for iOS &amp; Android</small>
        </span>
        <Icon name="chevron_right" className="install-go" />
      </button>
      {steps && (
        <Dialog icon="install_mobile" title="Install Pech-Eye" onClose={close}>
          <InstallSteps mode={mode} />
          <button className="btn block" autoFocus onClick={close}>OK</button>
        </Dialog>
      )}
    </>
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
