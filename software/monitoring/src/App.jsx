import { useEffect, useState } from "react";
import { api, setPw } from "./api.js";
import { useRoute } from "./lib.js";
import { Clock, Icon, Login, Logo, ThemeToggle } from "./ui.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Photos from "./pages/Photos.jsx";
import Batches from "./pages/Batches.jsx";
import Record from "./pages/Record.jsx";
import SensorHistory from "./pages/SensorHistory.jsx";

const NAV = [
  ["dashboard", "grid_view", "Dashboard"],
  ["photos", "photo_library", "Photos"],
  ["batches", "psychiatry", "Batches"],
];

export default function App() {
  const { page, sub, params } = useRoute();
  // Locked on every open/reload; the password lives in memory only (see api.js).
  const [auth, setAuth] = useState({ locked: true, wrong: false, busy: false });

  useEffect(() => {
    const h = () => setAuth({ locked: true, wrong: false, busy: false });
    window.addEventListener("pecheye-auth", h);
    return () => window.removeEventListener("pecheye-auth", h);
  }, []);

  const login = async (p) => {
    setPw(p);
    setAuth({ locked: true, wrong: false, busy: true });
    try { await api.session(); setAuth({ locked: false }); }
    catch { setAuth({ locked: true, wrong: true, busy: false }); }
  };

  // Ended batches open as a stand-alone record page without the navigation bar.
  const record = page === "records" && sub;

  return (
    <>
      <header className="topbar">
        <div className="in">
          <a className="brand" href="#/dashboard">
            <Logo />
            <h1>Pech-Eye</h1>
          </a>
          {!auth.locked && !record && (
            <nav className="tabs">
              {NAV.map(([key, icon, label]) => (
                <a key={key} href={`#/${key}`} className={page === key ? "on" : ""}><Icon name={icon} />{label}</a>
              ))}
            </nav>
          )}
          <Clock />
        </div>
      </header>
      <main className={`page ${record ? "no-nav" : ""}`}>
        {auth.locked ? <Login wrong={auth.wrong} busy={auth.busy} onSubmit={login} />
          : record ? <Record id={sub} key={sub} />
          : page === "photos" ? <Photos params={params} />
          : page === "batches" ? <Batches />
          : page === "sensors" ? <SensorHistory kind={sub} key={sub} />
          : <Dashboard />}
      </main>
      <ThemeToggle />
    </>
  );
}
