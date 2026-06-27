// Owner-controlled kill switches for features that consume free OpenRouter quota.
// Each flag defaults to false (enabled). Set to true to block that feature.
//
// Stored in app_settings under key "free_llm_gates":
//   { global: bool, reel_deconstruct: bool, content_forge: bool,
//     footage_tag: bool, workflow_insights: bool }
//
// localStorage key "fb_free_llm_gates" acts as a fast sync cache so guards at
// button-click time are instant (no await). Updated on every save and on every
// async loadGates() call.

import { supabase } from './supabase-client.js';

const SETTING_KEY = 'free_llm_gates';
const LS_KEY = 'fb_free_llm_gates';
const USAGE_LS_KEY = 'fb_free_llm_usage';

function readLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function writeLS(g) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(g)); } catch { /* quota */ }
}

// Synchronous check from the localStorage cache — safe to call in click handlers.
export function isBlockedSync(featureKey) {
  const g = readLS();
  return !!(g.global || g[featureKey]);
}

// Load from Supabase, refreshes localStorage. Returns the gates object.
export async function loadGates() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    const gates = data?.value ?? {};
    writeLS(gates);
    return gates;
  } catch {
    return readLS();
  }
}

// Persist to Supabase and update localStorage immediately.
export async function saveGates(gates) {
  writeLS(gates);
  await supabase.from('app_settings').upsert({
    key: SETTING_KEY,
    value: gates,
    updated_at: new Date().toISOString(),
  });
}

// True when the feature is blocked by the global kill OR its own flag.
export function isBlocked(gates, featureKey) {
  if (!gates) return false;
  return !!(gates.global || gates[featureKey]);
}

export const GATE_FEATURES = [
  // `model` = the lead free model each feature's fallback chain tries first.
  // `color` = donut/legend swatch. Every feature here burns a FREE LLM tier.
  { key: 'reel_deconstruct',  label: 'Reel DNA — Analyze',    desc: 'narrative LLM pass · Hetzner backend',      model: 'llama-3.3-70b:free',        color: '#5fb3d4' },
  { key: 'content_forge',     label: 'Content Forge',          desc: 'discover + expand hooks · Hetzner backend', model: 'llama-3.3-70b:free',        color: '#7ed4a8' },
  { key: 'footage_tag',       label: 'Footage Vision Tagging', desc: 'thumbnail AI tags · /api/tag-footage',      model: 'llama-3.2-11b-vision:free', color: '#e0a458' },
  { key: 'workflow_insights', label: 'Workflow Insights',       desc: 'Parse now · /api/ai/suggest',               model: 'llama-3.3-70b:free',        color: '#c08fe0' },
  { key: 'news_ingest',       label: 'Pulse — News ingest',     desc: 'RSS summarize · Refresh now',               model: 'llama-3.3-70b:free',        color: '#d47e9c' },
  { key: 'idea_generator',    label: 'Idea Generator (free)',   desc: 'OpenRouter draft · /api/generate',          model: 'llama-3.3-70b:free',        color: '#8fa8e0' },
  { key: 'scout',             label: 'Scout — Refresh',         desc: 'dossier gen · Scout backend (own key)',     model: 'openrouter:free · scout',   color: '#b0d45f' },
];

// ── Per-feature usage tracking ────────────────────────────────────────────
// Lightweight, browser-local call counters so the owner can SEE which feature
// is burning the shared free quota (and on which model). Counts every free-LLM
// call that actually proceeds (recorded at each guarded call site, after the
// gate passes). Local-only by design — no shared table, no extra network — so
// it reflects calls made from THIS browser since `since`. Reset any time.
// UTC day string (YYYY-MM-DD) — matches OpenRouter's 00:00-UTC quota reset.
function utcDayStr(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString().slice(0, 10);
}
function readUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_LS_KEY) || '{}');
    return {
      counts: u.counts || {}, since: u.since || null,
      day: u.day || null, dayCounts: u.dayCounts || {},
    };
  } catch {
    return { counts: {}, since: null, day: null, dayCounts: {} };
  }
}
function writeUsage(u) {
  try { localStorage.setItem(USAGE_LS_KEY, JSON.stringify(u)); } catch { /* quota */ }
}

// Increment the call counter for a feature. Sync + instant — call right after
// the gate passes, mirroring isBlockedSync's no-await contract.
export function recordUsage(featureKey) {
  const u = readUsage();
  u.counts[featureKey] = (u.counts[featureKey] || 0) + 1;
  if (!u.since) u.since = new Date().toISOString();
  // Daily bucket (UTC) for "today / cap" bars; rolls over (resets) at 00:00 UTC.
  const today = utcDayStr();
  if (u.day !== today) { u.day = today; u.dayCounts = {}; }
  u.dayCounts[featureKey] = (u.dayCounts[featureKey] || 0) + 1;
  writeUsage(u);
}

// Returns { counts: {featureKey: n}, since: iso|null } for the donut.
export function loadUsage() {
  return readUsage();
}

// Today's per-feature counts (UTC day). Returns empty counts when the stored
// bucket is stale (a new UTC day began) so a "today / cap" bar resets at 00:00.
export function loadDailyUsage() {
  const u = readUsage();
  const today = utcDayStr();
  if (u.day !== today) return { day: today, counts: {} };
  return { day: u.day, counts: u.dayCounts };
}

export function resetUsage() {
  writeUsage({ counts: {}, since: null });
}
