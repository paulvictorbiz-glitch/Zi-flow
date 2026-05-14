/* =========================================================
   One-shot seed: pushes today's fixture data into Supabase.

   Run with:
     npm run seed

   Re-running is safe — upserts by primary key. Timestamps are
   recomputed each run relative to `now()`, so re-seeding gives
   you the "fresh" version of the dashboard where everything's
   age matches the labels you remember from the demo.
   ========================================================= */

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
/* Prefer the service-role key so RLS doesn't block the seed.
   Falls back to the anon key for the historical case where RLS
   was permissive — that path now errors out at first write. */
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Make sure .env.local exists and you ran via `npm run seed`.");
  process.exit(1);
}
const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("Auth mode: " + (usingServiceRole ? "service_role (bypasses RLS)" : "anon (RLS-gated)"));
const supabase = createClient(url, key, { auth: { persistSession: false } });

/* ---------- Timestamp helpers (Node side) ---------- */
const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;

const ago      = (ms)         => new Date(NOW - ms).toISOString();
const fromNow  = (ms)         => new Date(NOW + ms).toISOString();
const todayAt  = (hh, mm = 0) => { const d = new Date(NOW); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const yestAt   = (hh, mm = 0) => new Date(new Date(todayAt(hh, mm)).getTime() - DAY).toISOString();
const tmrwAt   = (hh, mm = 0) => new Date(new Date(todayAt(hh, mm)).getTime() + DAY).toISOString();
/* Next occurrence of `weekday` (0=Sun … 6=Sat) at the given time.
   If today matches the weekday and the time hasn't passed yet,
   use today; otherwise jump to next week. */
const nextWday = (weekday, hh, mm = 0) => {
  const d = new Date(NOW);
  d.setHours(hh, mm, 0, 0);
  const delta = (weekday + 7 - d.getDay()) % 7;
  if (delta === 0 && d.getTime() < NOW) d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + delta);
  return d.toISOString();
};

/* ---------- Source data ----------
   Intentionally empty. The placeholder seed reels were retired when
   the project moved to operator-created reels with sequential IDs
   (REEL-000+). `npm run seed` is now a no-op for these three tables
   — it does not (re)insert anything. Leaving the script in place so
   the infrastructure stays wired up if real fixtures are added later. */
const REELS = [];
const REVIEW_LANE_CARDS = [];
const TASKS = [];

/* ---------- Upsert ---------- */
async function upsertIfAny(table, rows) {
  if (!rows.length) {
    console.log("Skipping " + table + " (empty).");
    return;
  }
  console.log("Seeding " + table + "...");
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function run() {
  await upsertIfAny("reels", REELS);
  await upsertIfAny("review_lane_cards", REVIEW_LANE_CARDS);
  await upsertIfAny("tasks", TASKS);

  console.log("");
  console.log("Seed complete.");
  console.log("  reels:             " + REELS.length);
  console.log("  review_lane_cards: " + REVIEW_LANE_CARDS.length);
  console.log("  tasks:             " + TASKS.length);
}

run().catch(e => {
  console.error("Seed failed:");
  console.error(e);
  process.exit(1);
});
