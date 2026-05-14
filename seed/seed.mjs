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

/* ---------- Source data ---------- */
const REELS = [
  { id: "IDEA-088", title: "Temple bell close-up", stage: "idea", owner: "alex", lane: "alex", state: "ok", age: "3d", due: null, fb: 4, refs: 1, blocker: null, next: "Pull selects and write logline", downstream: null, grouping: "not_started", note: "4 selects already pulled from FootageBrain.", foot: "Discovery", tone: "cyan",
    stage_entered_at: ago(3 * DAY), due_at: null },
  { id: "IDEA-091", title: "River ghat crowd", stage: "idea", owner: "alex", lane: "alex", state: "warn", age: "1d", due: null, fb: 0, refs: 2, blocker: "Needs FootageBrain pull", next: "Run semantic search · ghat crowd", downstream: null, grouping: "not_started", foot: "Triage queue", tone: "cyan",
    stage_entered_at: ago(1 * DAY), due_at: null },
  { id: "IDEA-079", title: "Market vendor smile", stage: "idea", owner: "paul", lane: "paul", state: "warn", age: "11d", due: null, fb: 0, refs: 0, blocker: "Stale — owner triage", next: "Triage: kill, defer, or greenlight", downstream: null, grouping: "not_started", foot: "Stale — triage", tone: "warn",
    stage_entered_at: ago(11 * DAY), due_at: null },
  { id: "REEL-204", title: "Kathmandu chaos", stage: "selected", owner: "alex", lane: "alex", state: "ok", age: "queued 4h", due: "Thu 17:00", fb: 12, refs: 3, blocker: null, next: "Start main edit", downstream: "Jay variant slot · Fri 09:00", grouping: "not_started", note: "12 Labs pull attached · ready for main edit.", foot: "0/5 variants", tone: "cyan",
    stage_entered_at: ago(4 * HOUR), due_at: nextWday(4, 17) },
  { id: "REEL-201", title: "Temple crowd sequence", stage: "main", owner: "alex", lane: "alex", state: "warn", age: "6h 28m", due: "today 14:00", fb: 8, refs: 4, blocker: "Waiting on owner hook decision A/B", blocker_role: "owner", next: "Ping Paul for hook pick", downstream: "Variant lane idle risk · 3h 20m", grouping: "in_progress", note: "Blocked by owner hook decision. 8 selects attached.", foot: "Needs decision", tone: "warn",
    stage_entered_at: ago(6 * HOUR + 28 * MIN), due_at: todayAt(14) },
  { id: "REEL-198", title: "Boudha kora walk", stage: "main", owner: "alex", lane: "alex", state: "block", age: "19h over", due: "yest 17:00", fb: 6, refs: 2, blocker: "Hook A/B unresolved · main overrun", blocker_role: "owner", next: "Escalate hook call", downstream: "Friday post window slips +1d", grouping: "in_progress", note: "Hook A/B unresolved. Music choice locked.", foot: "Main edit overrun", tone: "block",
    stage_entered_at: ago(36 * HOUR), due_at: yestAt(17) },
  { id: "REEL-206", title: "Street food smoke", stage: "main", owner: "alex", lane: "alex", state: "ok", age: "on track", due: "today 22:00", fb: 9, refs: 5, blocker: null, next: "Lock music bed", downstream: null, grouping: "in_progress", foot: "On schedule", tone: "cyan", status: "22h left",
    stage_entered_at: ago(2 * HOUR), due_at: todayAt(22) },
  { id: "REEL-195", title: "Sunrise prayer flags", stage: "review", owner: "paul", lane: "paul", state: "warn", age: "3h 10m wait", due: "today 18:00", fb: 5, refs: 3, blocker: "Awaiting owner approval + handoff notes", blocker_role: "owner", next: "Approve or send back", downstream: "Caption pass queued for Leroy", grouping: "in_progress", note: "Export v3 attached. Needs approval + handoff notes.", links: ["frame.io / review", "drive / source"], foot: "Review queue", tone: "warn",
    stage_entered_at: ago(3 * HOUR + 10 * MIN), due_at: todayAt(18) },
  { id: "REEL-192", title: "Old Patan alleys", stage: "review", owner: "paul", lane: "paul", state: "block", age: "28h wait", due: "yest 14:00", fb: 7, refs: 4, blocker: "Review SLA breached · downstream blocked", blocker_role: "owner", next: "Sign off — variant lane idle", downstream: "Jay idle now · Friday slot at risk", grouping: "in_progress", note: "Downstream blocked. Variant lane idle risk.", links: ["frame.io / review", "ig / draft"], foot: "SLA breached", tone: "block",
    stage_entered_at: ago(28 * HOUR), due_at: yestAt(14) },
  { id: "REEL-180", title: "Himalaya flyover · 5-var pack", stage: "variants", owner: "sam", lane: "sam", state: "ok", age: "22h left", due: "Fri 12:00", fb: 0, refs: 6, blocker: null, next: "Package variants C, D, E", downstream: "Ready bucket · Fri 14:00", grouping: "in_progress", variant_progress: { done: 2, total: 5 }, note: "2/5 done. Main + brief attached.", links: ["drive / source set", "captions doc"], foot: "Packaging", tone: "cyan",
    stage_entered_at: ago(8 * HOUR), due_at: nextWday(5, 12) },
  { id: "REEL-175", title: "Pashupati monks · variants", stage: "variants", owner: "sam", lane: "sam", state: "warn", age: "idle 3h", due: "Sat 18:00", fb: 0, refs: 2, blocker: "Awaiting brief from Judy", blocker_role: "skilled", next: "Ping Judy for variant brief", downstream: null, grouping: "in_progress", variant_progress: { done: 0, total: 5 }, note: "Awaiting brief from Judy.", foot: "Waiting on brief", tone: "warn",
    stage_entered_at: ago(3 * HOUR), due_at: nextWday(6, 18) },
  { id: "REEL-188", title: "Lalitpur dusk", stage: "ready", owner: "paul", lane: "paul", state: "ok", age: "scheduled", due: "today 18:00", fb: 0, refs: 2, blocker: null, next: "Confirm caption", downstream: null, grouping: "in_progress", foot: "Scheduled 18:00", tone: "ok", status: "post 2h",
    stage_entered_at: ago(2 * HOUR), due_at: todayAt(18) },
  { id: "REEL-178", title: "Annapurna teaser", stage: "ready", owner: "paul", lane: "paul", state: "ok", age: "scheduled", due: "tomorrow 09:00", fb: 0, refs: 3, blocker: null, next: "Hold for post window", downstream: null, grouping: "in_progress", foot: "Held for window", tone: "cyan", status: "tmrw 9am",
    stage_entered_at: ago(10 * HOUR), due_at: tmrwAt(9) },
  { id: "REEL-170", title: "Boudha drone — 5-var pack", stage: "ready", owner: "sam", lane: "sam", state: "ok", age: "scheduled", due: "today 22:00", fb: 0, refs: 5, blocker: null, next: "Confirm export bundle", downstream: null, grouping: "completed", variant_progress: { done: 5, total: 5 }, note: "All 5 variants packaged. Captions reviewed.", foot: "Scheduled 22:00", tone: "ok", status: "post 6h",
    stage_entered_at: ago(20 * HOUR), due_at: todayAt(22) },
  { id: "REEL-166", title: "Pashupati monks at dawn", stage: "posted", owner: "paul", lane: "paul", state: "ok", age: "12d ago", due: null, fb: 0, refs: 0, blocker: null, next: "Analytics review", downstream: null, grouping: "completed",
    stage_entered_at: ago(12 * DAY), due_at: null },
  { id: "REEL-161", title: "Patan square crowd", stage: "posted", owner: "paul", lane: "paul", state: "ok", age: "16d ago", due: null, fb: 0, refs: 0, blocker: null, next: "Analytics review", downstream: null, grouping: "completed",
    stage_entered_at: ago(16 * DAY), due_at: null },
];

const REVIEW_LANE_CARDS = [
  { id: "REEL-195-RV", parent_id: "REEL-195", title: "Sunrise prayer flags · caption pass", stage: "review", lane: "review", owner: "maya", state: "ok", note: "Sub-review for captions. Routes back to Paul on close.", foot: "Reviewing", tone: "cyan", status: "1h 10m" },
  { id: "REEL-188-RV", parent_id: "REEL-188", title: "Lalitpur dusk · final caption", stage: "ready", lane: "review", owner: "maya", state: "ok", foot: "Closed 10:42", tone: "ok", status: "cleared" },
];

const TASKS = [
  { id: "T-301", from_person: "alex", to_person: "paul", type: "Decision",       reel_id: "REEL-201", instruction: "Pick hook A vs B for temple crowd sequence",   due: "today 14:00", state: "open · 3h SLA", due_at: todayAt(14) },
  { id: "T-302", from_person: "alex", to_person: "sam",  type: "Variant pack",   reel_id: "REEL-201", instruction: "Package 5 variants once hook is locked",       due: "Fri 12:00",   state: "queued",        due_at: nextWday(5, 12) },
  { id: "T-303", from_person: "paul", to_person: "maya", type: "Caption review", reel_id: "REEL-195", instruction: "Verify caption style on prayer flags cut",     due: "today 18:00", state: "open",          due_at: todayAt(18) },
  { id: "T-304", from_person: "alex", to_person: "paul", type: "Source upload",  reel_id: "REEL-198", instruction: "Upload remaining drone source from Boudha shoot", due: "today",   state: "open",          due_at: todayAt(23, 59) },
  { id: "T-305", from_person: "sam",  to_person: "alex", type: "Brief",          reel_id: "REEL-175", instruction: "Need allowed-changes for Pashupati variants",  due: "today",       state: "open",          due_at: todayAt(23, 59) },
  { id: "T-306", from_person: "paul", to_person: "alex", type: "Thumbnail",      reel_id: "REEL-188", instruction: "Pick thumbnail frame for Lalitpur dusk",       due: "today 17:30", state: "open",          due_at: todayAt(17, 30) },
];

/* ---------- Upsert ---------- */
async function run() {
  console.log("Seeding reels...");
  let { error } = await supabase.from("reels").upsert(REELS, { onConflict: "id" });
  if (error) throw error;

  console.log("Seeding review_lane_cards...");
  ({ error } = await supabase.from("review_lane_cards").upsert(REVIEW_LANE_CARDS, { onConflict: "id" }));
  if (error) throw error;

  console.log("Seeding tasks...");
  ({ error } = await supabase.from("tasks").upsert(TASKS, { onConflict: "id" }));
  if (error) throw error;

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
