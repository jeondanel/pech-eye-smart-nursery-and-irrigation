// Fake sensor readings so you can test before sensors are wired.
// Local:  npm run simulate            Deployed: BASE_URL=https://your-app.vercel.app npm run simulate
const base = process.env.BASE_URL || "http://localhost:3001";
let t = 0;
async function tick() {
  t++;
  const body = {
    soil_moisture: +(55 + 15 * Math.sin(t / 8) + Math.random() * 3).toFixed(1),
    humidity: +(70 + 10 * Math.sin(t / 12) + Math.random() * 2).toFixed(1),
    temperature: +(27 + 3 * Math.sin(t / 20) + Math.random()).toFixed(1),
    distance_cm: +Math.max(5, 28 - t * 0.15 + Math.random()).toFixed(1),
    reservoir_low: t % 40 >= 30, // float switch: low for 10 of every 40 ticks
  };
  const r = await fetch(`${base}/api/ingest/reading`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.DEVICE_API_KEY },
    body: JSON.stringify(body),
  });
  console.log(r.status, body);
}
setInterval(() => tick().catch(console.error), 3000);
