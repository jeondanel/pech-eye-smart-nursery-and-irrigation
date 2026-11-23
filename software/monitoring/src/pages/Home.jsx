import { api } from "../api.js";
import { Icon, Logo } from "../ui.jsx";
import { dayOf, fmt, usePoll } from "../lib.js";

const LINKS = [
  ["#/dashboard", "dashboard", "Dashboard", "Live nursery overview"],
  ["#/photos", "photo_library", "Photos", "Tray pictures by day"],
  ["#/batches", "potted_plant", "Batches", "Growing cycles and summaries"],
  ["#/sensors/temperature", "device_thermostat", "Temperature", "Chamber history"],
  ["#/sensors/humidity", "humidity_percentage", "Humidity", "Chamber history"],
  ["#/sensors/soil", "grass", "Soil Moisture", "Tray soil history"],
  ["#/sensors/reservoir", "water_drop", "Mist Reservoir", "Level and water use"],
];

export default function Home() {
  const { data } = usePoll(() => api.dashboard(), [], 30000);
  const b = data?.batch, r = data?.latestReading;

  return (
    <>
      <div className="card welcome">
        <Logo size={72} />
        <div>
          <p className="eyebrow">Smart Pechay Nursery</p>
          <h2>Pech-Eye</h2>
          <p className="muted">
            {b ? <>{b.name} is on <b>Day {dayOf(b.started_at)}</b>. Chamber {fmt(r?.temperature, "°C")}, {fmt(r?.humidity, "%")} humidity, reservoir {r?.reservoir_low == null ? "—" : r.reservoir_low ? "LOW" : "OK"}.</> : "Loading the nursery status..."}
          </p>
        </div>
      </div>

      <div className="tiles">
        {LINKS.map(([href, icon, title, sub]) => (
          <a key={href} className="card tile" href={href}>
            <Icon name={icon} className="tile-ic" />
            <div><b>{title}</b><small>{sub}</small></div>
            <Icon name="arrow_forward" className="go" />
          </a>
        ))}
      </div>
    </>
  );
}
