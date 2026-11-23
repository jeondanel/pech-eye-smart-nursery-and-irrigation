import { createClient } from "@supabase/supabase-js";

// SERVICE ROLE key: server-side only. Never expose it in the React code.
export const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
export const BUCKET = "tray-images";

export function ok({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Supabase returns at most 1000 rows per request; this pages through all of them.
export async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await makeQuery(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export const imageUrl = (file) => sb.storage.from(BUCKET).getPublicUrl(file).data.publicUrl;

// The batch being monitored, or null until someone presses "Start monitoring".
export async function activeBatch() {
  return ok(await sb.from("batches").select("*").eq("status", "growing").limit(1))[0] || null;
}
