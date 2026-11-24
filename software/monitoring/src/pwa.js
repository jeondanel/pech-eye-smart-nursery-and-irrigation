import { useEffect, useState } from "react";

// Installing the dashboard as an app (PWA).
// Chrome / Edge / Android fire "beforeinstallprompt", which we keep so our own button can open
// the browser's install dialog. iPhone/iPad Safari has no such dialog: there the user taps
// Share -> "Add to Home Screen", so we show those steps instead.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

export const isInstalled = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function initPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

function state() {
  const installed = isInstalled();
  const ios = !installed && isIOS();
  // "ios" = show the Add to Home Screen steps; "prompt" = our button opens the install dialog.
  const mode = installed ? null : deferred ? "prompt" : ios ? "ios" : null;
  return { installed, mode };
}

export function usePwa() {
  const [s, set] = useState(state);
  useEffect(() => {
    const f = () => set(state());
    listeners.add(f);
    f();
    return () => listeners.delete(f);
  }, []);
  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === "accepted";
  };
  return { ...s, install };
}

// The after-login popup: "Not now" hides it for a week (the Dashboard card is always there).
const SNOOZE_KEY = "pecheye_install_snooze";
export const installSnoozed = () => {
  try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch { return false; }
};
export const snoozeInstall = () => {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * 86400000)); } catch { /* private mode */ }
};
