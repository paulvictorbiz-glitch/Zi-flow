#!/usr/bin/env node
/**
 * Read-only check: probe the live DB to infer which migrations are applied.
 * Does NOT write anything. Used to validate the backfill list before marking.
 *
 *   node --env-file=.env.local scripts/verify-migrations.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Probe a table: does selecting `col` (or *) succeed?
async function tableHas(table, col = "*") {
  const { error } = await sb.from(table).select(col).limit(1);
  if (!error) return true;
  // 42P01 undefined_table, 42703 undefined_column, PGRST205 unknown table
  if (/does not exist|Could not find|undefined|42P01|42703|PGRST20[0-9]/i.test(error.message)) return false;
  return `? (${error.message})`;
}
async function rpcExists(fn, args) {
  const { error } = await sb.rpc(fn, args);
  if (!error) return true;
  if (/Could not find the function|does not exist|PGRST202/i.test(error.message)) return false;
  return true; // function exists but errored on dummy args = still "applied"
}

// migration -> probe. `data:true` means seed/data-only (can't schema-probe).
const checks = {
  "0001_init.sql":                 () => tableHas("reels"),
  "0002_auth_and_people.sql":      () => tableHas("people"),
  "0003_realtime.sql":             { data: true, note: "realtime publication" },
  "0004_reel_blueprint.sql":       () => tableHas("reels", "script"),
  "0005_reel_detail_blob.sql":     () => tableHas("reels", "detail"),
  "0006_sla_timestamps.sql":       () => tableHas("reels", "due_at"),
  "0007_rename_people.sql":        { data: true, note: "rename/data" },
  "0008_archive.sql":              () => tableHas("reels", "archived_at"),
  "0009_attached_footage.sql":     () => tableHas("attached_footage_items"),
  "0010_stage_canonicalize.sql":   { data: true, note: "data normalize" },
  "0011_reset_reels.sql":          { data: true, note: "DATA RESET — never re-run" },
  "0012_delete_stuck_seed_reels.sql": { data: true, note: "DATA DELETE — never re-run" },
  "0013_generated_drafts.sql":     () => tableHas("generated_drafts"),
  "0014_app_settings.sql":         () => tableHas("app_settings"),
  "0015_fix_jay_email.sql":        { data: true, note: "data fix" },
  "0015_update_jay_email.sql":     { data: true, note: "data fix" },
  "0016_clear_stale_user_ids.sql": { data: true, note: "data fix" },
  "0017_sync_canonical_people.sql":{ data: true, note: "data sync" },
  "0018_service_role_people_access.sql": { data: true, note: "RLS policy" },
  "0019_capcut_activity.sql":      () => tableHas("capcut_activity"),
  "0020_reel_extensions.sql":      () => tableHas("reels", "status_color"),
  "0021_daily_tasks.sql":          () => tableHas("daily_tasks"),
  "0022_resources.sql":            () => tableHas("resource_columns"),
  "0023_footage_framerate.sql":    () => tableHas("attached_footage_items", "frame_rate"),
  "0024_footage_transcripts.sql":  () => tableHas("attached_footage_items", "full_transcript"),
  "0025_edit_sessions.sql":        () => tableHas("edit_sessions"),
  "0026_vision_tags.sql":          () => tableHas("attached_footage_items", "vision_tags"),
  "0027_social_connections.sql":   { data: true, note: "app_settings seed" },
  "0028_social_connection_health.sql": { data: true, note: "app_settings seed" },
  "0029_locations.sql":            () => tableHas("locations"),
  "0030_youtube_oauth_note.sql":   { data: true, note: "note/seed" },
  "0031_whatsapp_messages.sql":    () => tableHas("whatsapp_messages"),
  "0032_whatsapp_social_connection.sql": { data: true, note: "app_settings seed" },
  "0033_locations_row_color.sql":  () => tableHas("locations", "row_color"),
  "0034_resource_row_color.sql":   () => tableHas("resource_rows", "row_color"),
  "0035_location_reel_links.sql":  () => tableHas("locations", "reel_links"),
  "0036_daily_tasks_notes.sql":    () => tableHas("daily_tasks", "notes"),
  "0036_location_photos.sql":      () => tableHas("location_photos"),
  "0037_processing_jobs.sql":      () => tableHas("processing_jobs"),
  "0038_resource_row_hidden.sql":  () => tableHas("resource_rows", "hidden"),
  "0039_ai_brain.sql":             () => tableHas("ai_notes"),
  "0040_match_faq_pairs_rpc.sql":  () => rpcExists("match_faq_pairs", { query_embedding: null, match_count: 1 }),
  "0041_faq_vector_1024.sql":      { data: true, note: "index + fn rebuild (probe 0040)" },
  "0042_workflow_insights.sql":    () => tableHas("workflow_insights"),
  "0043_anthropic_killswitch.sql": { data: true, note: "app_settings seed" },
};

const present = [], absent = [], dataOnly = [], unknown = [];
for (const [version, check] of Object.entries(checks)) {
  if (typeof check === "object" && check.data) { dataOnly.push([version, check.note]); continue; }
  const r = await check();
  if (r === true) present.push(version);
  else if (r === false) absent.push(version);
  else unknown.push([version, r]);
}

const pad = (s) => s.padEnd(36);
console.log("\n  SCHEMA-VERIFIED PRESENT (safe to mark applied):");
present.forEach((v) => console.log("    ✓ " + v));
if (absent.length) {
  console.log("\n  ⚠ SCHEMA OBJECT MISSING (likely NOT applied — do NOT mark, apply it instead):");
  absent.forEach((v) => console.log("    ✗ " + v));
}
if (unknown.length) {
  console.log("\n  ? COULD NOT DETERMINE:");
  unknown.forEach(([v, r]) => console.log("    ? " + pad(v) + r));
}
console.log("\n  DATA/SEED-ONLY (can't schema-probe — assume applied if site works, NEVER re-run resets):");
dataOnly.forEach(([v, note]) => console.log("    • " + pad(v) + note));
console.log(`\n  ${present.length} verified present · ${absent.length} missing · ${dataOnly.length} data-only\n`);
