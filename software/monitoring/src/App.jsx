import { useEffect, useState } from "react";
import { setPw } from "./api.js";
import { useRoute } from "./lib.js";
import { Clock, Icon, Login, Logo } from "./ui.jsx";
import Home from "./pages/Home.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Photos from "./pages/Photos.jsx";
import Batches from "./pages/Batches.jsx";
import SensorHistory from "./pages/SensorHistory.jsx";

const NAV = [
  ["home", "home", "Home"],
  ["dashboard", "grid_view", "Dashboard"],
  ["photos", "photo_library", "Photos"],
  ["batches", "psychiatry", "Batches"],
];

export default function App() {
  const { page, sub, params } = useRoute();
  const [auth, setAuth] = useState(null); // null | { wrong: boolean }
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const h = (e) => setAuth({ wrong: !!e.detail?.hadPassword });
    window.addEventListener("pecheye-auth", h);
    return () => window.removeEventListener("pecheye-auth", h);
  }, []);

  const login = (p) => { setPw(p); setAuth(null); setEpoch((n) => n + 1); };

  return (
    <>
      <header className="topbar">
        <div className="in">
          <a className="brand" href="#/">
            <Logo />
            <h1>Pech-Eye<small>Smart Pechay Nursery</small></h1>
          </a>
          {!auth && (
            <nav className="tabs">
              {NAV.map(([key, icon, label]) => (
                <a key={key} href={`#/${key}`} className={page === key ? "on" : ""}><Icon name={icon} />{label}</a>
              ))}
            </nav>
          )}
          <Clock />
        </div>
      </header>
      <main className="page" key={epoch}>
        {auth ? <Login wrong={auth.wrong} onSubmit={login} />
          : page === "dashboard" ? <Dashboard batchId={params.batch} key={params.batch} />
          : page === "photos" ? <Photos params={params} />
          : page === "batches" ? <Batches />
          : page === "sensors" ? <SensorHistory kind={sub} key={sub} />
          : <Home />}
      </main>
    </>
  );
}
