/* Singleton Supabase client. Reads URL + anon key from
   .env.local via Vite's import.meta.env. Importing this from
   multiple modules returns the same instance — Supabase JS
   handles auth + realtime channels internally, so we want
   exactly one. */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Surfaced loudly so a missing .env.local doesn't hide as
  // a silent "no data" board.
  throw new Error(
    "Supabase env vars missing. Check .env.local for " +
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(url, key);
