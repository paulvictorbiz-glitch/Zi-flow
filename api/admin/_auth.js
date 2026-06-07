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

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
