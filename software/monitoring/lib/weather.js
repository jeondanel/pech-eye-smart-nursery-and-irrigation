import { sb } from "./supabase.js";

// OpenWeather free tier: "Current weather" + "5 day / 3 hour forecast" (1000 calls/day).
// We fetch at most once per maxAgeMin and store each snapshot, so the history is
// available for the batch summary even though no cron job is needed.
export async function ensureWeather(maxAgeMin = 30) {
  const key = process.env.OPENWEATHER_API_KEY;
  const { WEATHER_LAT: lat, WEATHER_LON: lon } = process.env;
  if (!key || !lat || !lon) return null;

  const { data: rows } = await sb.from("weather").select("*").order("ts", { ascending: false }).limit(1);
  const last = rows?.[0] || null;
  if (last && Date.now() - new Date(last.ts).getTime() < maxAgeMin * 60000) return last;

  try {
    const q = `lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
    const [cur, fc] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?${q}`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?${q}&cnt=8`), // next 24 h
    ]);
    if (!cur.ok) throw new Error(`OpenWeather ${cur.status}: ${await cur.text()}`);
    const c = await cur.json();
    const f = fc.ok ? await fc.json() : null;
    const pop = f?.list?.length ? Math.max(...f.list.map((x) => x.pop || 0)) * 100 : null;
    const row = {
      temp: c.main?.temp, feels_like: c.main?.feels_like, humidity: c.main?.humidity,
      pressure: c.main?.pressure, wind_speed: c.wind?.speed, clouds: c.clouds?.all,
      rain_1h: c.rain?.["1h"] ?? 0, rain_chance_24h: pop, description: c.weather?.[0]?.description,
    };
    const { data, error } = await sb.from("weather").insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    console.error("weather failed:", e.message);
    return last; // fall back to the last known snapshot
  }
}
