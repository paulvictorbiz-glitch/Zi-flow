/* Second Supabase client — points at the MicroSaaS Scout project
   (rqkzstyvqfmcsxdyogij), completely separate from FootageBrain's DB.
   Read-only from the browser: uses the anon key; RLS on the Scout DB
   allows anon SELECT on products/dossiers/sources. Shortlist writes are
   locked to authenticated only (Scout Supabase migration 0004).

   persistSession: false — we don't want Scout's auth state to bleed into
   the FootageBrain session stored in localStorage. storageKey namespaced
   separately just in case. */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SCOUT_SUPABASE_URL;
const key = import.meta.env.VITE_SCOUT_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Scout Supabase env vars missing. Check .env.local for " +
    "VITE_SCOUT_SUPABASE_URL and VITE_SCOUT_SUPABASE_ANON_KEY."
  );
}

export const scoutSupabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "scout_sb",
  },
});
