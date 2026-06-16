// Shared helpers for owner-gated admin API routes.
// Underscore prefix = not a Vercel route.

import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars not set");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ALLOWED_ORIGINS = new Set([
  "https://footagebrain.com",
  "https://www.footagebrain.com",
]);

export function setCors(res, req) {
  const origin = req?.headers?.origin || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://footagebrain.com";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Returns { supabase } or throws an error string the caller can return as 401/403. */
export async function verifyOwner(req) {
  const supabase = adminClient();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("No auth token"), { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw Object.assign(new Error("Invalid token"), { status: 401 });

  // The `people` RLS policy requires auth.role() = 'authenticated'.
  // Service role key sets role to 'service_role' which fails that check.
  // Fix: keep the service role key as the PostgREST apikey but override
  // Authorization with the caller's JWT so auth.role() returns 'authenticated'.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userClient = createClient(url, svcKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: person } = await userClient
    .from("people")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!person || person.role !== "owner") {
    throw Object.assign(new Error("Owner only"), { status: 403 });
  }

  return { supabase };
}

export function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
}

/**
 * Lightweight, NON-throwing caller classifier for quota-sensitive routes
 * (api/generate, api/tag-footage). Unlike verifyOwner() this never throws —
 * it just reports who's calling so the route can decide.
 *
 * Returns: { isDemo, role, anon }
 *   · anon=true  → no/invalid token (anonymous caller)
 *   · isDemo=true → the signed-in user's people.role === 'demo'
 *
 * Uses the verifyOwner JWT-as-apikey workaround so the `people` RLS
 * (auth.role() = 'authenticated') is satisfied.
 */
export async function classifyCaller(req) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return { isDemo: false, role: null, anon: true };

    const { data: { user }, error } = await adminClient().auth.getUser(token);
    if (error || !user) return { isDemo: false, role: null, anon: true };

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const userClient = createClient(url, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: person } = await userClient
      .from("people")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    return { isDemo: person?.role === "demo", role: person?.role || null, anon: false };
  } catch {
    // Fail-safe: treat as anonymous (no special demo handling). The route's
    // own auth/quota logic still applies.
    return { isDemo: false, role: null, anon: true };
  }
}

/**
 * Reads the `anthropic_enabled` kill switch from app_settings.
 * Returns true (fail-open) when the flag row is missing or unreadable so a
 * transient DB hiccup never silently breaks every AI feature. Only an explicit
 * { enabled: false } pauses Claude usage.
 */
export async function isAnthropicEnabled() {
  try {
    const { data, error } = await adminClient()
      .from("app_settings")
      .select("value")
      .eq("key", "anthropic_enabled")
      .maybeSingle();
    if (error || !data) return true;
    return data.value?.enabled !== false;
  } catch {
    return true;
  }
}

/** Standard 503 body for callers to return when Claude is paused. */
export const ANTHROPIC_PAUSED = {
  error: "Claude API is paused by the owner. Re-enable it on the Monitor page.",
  paused: true,
};
