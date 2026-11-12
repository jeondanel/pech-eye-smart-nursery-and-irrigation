// Local-only: runs the same API on http://localhost:3001 (Vite proxies /api to it).
import app from "./lib/app.js";
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`PECH-EYE API on :${port}`));
