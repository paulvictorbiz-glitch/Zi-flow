#!/usr/bin/env node
/**
 * READ-ONLY diagnostic for the IG sync "missing URLs" issue (v2).
 *   node --env-file=.env.local scripts/ig-sync-diagnose.mjs
 * Pure SELECTs — no writes.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// 1. Total ig_ingest_log rows + breakdown by issue_type (all-time)
const { data: allLogs, error: e1 } = await sb
  .from("ig_ingest_log")
  .select("issue_type, detail, conversation_id, message_id, run_id, occurred_at")
  .order("occurred_at", { ascending: false })
  .limit(500);
if (e1) { console.error("ingest_log:", e1.message); process.exit(1); }
console.log(`\n=== ig_ingest_log: ${allLogs.length} rows (all-time, capped 500) ===`);
const byType = {};
for (const l of allLogs) (byType[l.issue_type] ||= []).push(l);
for (const t of Object.keys(byType).sort((a, b) => byType[b].length - byType[a].length)) {
  console.log(`\n-- ${t}: ${byType[t].length}`);
  for (const l of byType[t].slice(0, 6))
    console.log(`   run=${(l.run_id||"").slice(0,8)} conv=${l.conversation_id||"-"} mid=${l.message_id||"-"}  ${l.detail||""}`);
  if (byType[t].length > 6) console.log(`   ...(+${byType[t].length - 6} more)`);
}

// 2. How many distinct runs are those logs spread across?
const runsWithLogs = new Set(allLogs.map((l) => l.run_id));
console.log(`\n   spread across ${runsWithLogs.size} distinct runs`);

// 3. reel_dna ig_dm capture stats — how many reels do we actually have?
const { count: dmCount, error: e2 } = await sb
  .from("reel_dna")
  .select("*", { count: "exact", head: true })
  .eq("source", "ig_dm");
if (e2) console.error("reel_dna count:", e2.message);
else console.log(`\n=== reel_dna source=ig_dm: ${dmCount} rows total ===`);

// 4. Distinct conversations actually captured vs the 3 seen
const { data: convSample, error: e3 } = await sb
  .from("reel_dna")
  .select("external_ref, platform, reel_url, created_at")
  .eq("source", "ig_dm")
  .order("created_at", { ascending: false })
  .limit(10);
if (!e3 && convSample) {
  console.log(`\n=== 10 most recent ig_dm reel_dna rows ===`);
  for (const r of convSample)
    console.log(`   ${r.created_at?.slice(0,19)}  ${r.platform}  ext=${(r.external_ref||"").slice(0,24)}  ${(r.reel_url||"").slice(0,60)}`);
}
console.log("");
