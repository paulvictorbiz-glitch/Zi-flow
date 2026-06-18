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

/* Auth options are spelled out explicitly (rather than relying on
   supabase-js defaults) so "keep me signed in" can't silently regress:

     · persistSession    — write the session to storage so a returning
                           visitor is restored without re-typing creds.
     · autoRefreshToken  — rotate the short-lived access token in the
                           background; the long-lived refresh token keeps
                           the session alive across days/weeks.
     · storage           — localStorage (survives tab/browser close).
                           NOTE: localStorage is per-origin, so the app
                           must always be reached on ONE canonical host
                           (footagebrain.com). A www↔apex split makes a
                           session saved on one host look "logged out" on
                           the other — handled by the redirect in
                           vercel.json, not here.
     · storageKey        — left at the supabase default on purpose so
                           sessions already saved in users' browsers stay
                           valid (changing it would log everyone out once).
     · detectSessionInUrl — finish OAuth/magic-link redirects.

   Guarded for non-browser (SSR/build) contexts where localStorage is
   undefined. */
const hasWindow = typeof window !== "undefined";

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: hasWindow ? window.localStorage : undefined,
  },
});
