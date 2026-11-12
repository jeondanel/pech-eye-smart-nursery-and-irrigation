// Tray analyzer based on the Excess Green Index (ExG), no AI involved.
//   ExG = 2g - r - b   where r,g,b are chromatic coordinates (R/(R+G+B), ...)
// A pixel counts as "plant" when ExG > EXG_THRESHOLD. The photo is split into a
// ROWS x COLS grid (72 holes = 6 x 12) and each hole gets a green-coverage %.
import jpeg from "jpeg-js";

const ROWS = Number(process.env.TRAY_ROWS || 6);
const COLS = Number(process.env.TRAY_COLS || 12);
const EXG_THRESHOLD = Number(process.env.EXG_THRESHOLD || 0.1);
const EMPTY_COVER = Number(process.env.EMPTY_COVER || 0.05);   // below this = empty hole
const READY_COVER = Number(process.env.READY_COVER || 0.5);    // at/above this = ready seedling
const READY_RATIO = Number(process.env.READY_THRESHOLD || 0.8); // share of planted holes that must be ready
// Region of the photo that contains the tray, as fractions "x,y,w,h" (default: whole frame).
const [CX, CY, CW, CH] = (process.env.TRAY_CROP || "0,0,1,1").split(",").map(Number);

export async function analyzeTray(jpegBuffer) {
  const img = jpeg.decode(jpegBuffer, { useTArray: true, maxMemoryUsageInMB: 512 });
  const { width, height, data } = img;
  const x0 = Math.floor(CX * width), y0 = Math.floor(CY * height);
  const w = Math.floor(CW * width), h = Math.floor(CH * height);

  const green = new Array(ROWS * COLS).fill(0);
  const total = new Array(ROWS * COLS).fill(0);

  for (let y = y0; y < y0 + h && y < height; y++) {
    const row = Math.min(ROWS - 1, Math.floor(((y - y0) / h) * ROWS));
    for (let x = x0; x < x0 + w && x < width; x++) {
      const col = Math.min(COLS - 1, Math.floor(((x - x0) / w) * COLS));
      const cell = row * COLS + col;
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const s = r + g + b;
      total[cell]++;
      if (s > 30 && (2 * g - r - b) / s > EXG_THRESHOLD) green[cell]++;
    }
  }

  const cover = green.map((gcount, i) => (total[i] ? gcount / total[i] : 0));
  const cells = cover.map((c) => (c < EMPTY_COVER ? "empty" : c >= READY_COVER ? "ready" : "growing"));
  const ready = cells.filter((c) => c === "ready").length;
  const occupied = cells.filter((c) => c !== "empty").length;
  const ratio = occupied ? ready / occupied : 0;
  const canopy = (green.reduce((a, b) => a + b, 0) / Math.max(1, total.reduce((a, b) => a + b, 0))) * 100;

  return {
    method: "exg", source: "exg",
    rows: ROWS, cols: COLS, cells,
    cover: cover.map((c) => +(c * 100).toFixed(1)),   // per-hole green coverage %
    canopy_pct: +canopy.toFixed(1),
    notes: `ExG > ${EXG_THRESHOLD}; hole empty < ${EMPTY_COVER * 100}% green, ready >= ${READY_COVER * 100}% green.`,
    ready_cells: ready, occupied_cells: occupied, total_cells: cells.length,
    ready_ratio: ratio, ready: occupied > 0 && ratio >= READY_RATIO,
  };
}
