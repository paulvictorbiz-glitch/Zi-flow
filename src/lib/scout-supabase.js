/* Second Supabase client — points at the MicroSaaS Scout project
   (rqkzstyvqfmcsxdyogij), completely separate from FootageBrain's DB.
   Read-only from the browser: uses the anon key; RLS on the Scout DB
   allows anon SELECT on products/dossiers/sources. Shortlist writes are
   locked to authenticated only (Scout Supabase migration 0004).

   persistSession: false — we don't want Scout's auth state to bleed into
   the FootageBrain session stored in localStorage. storageKey namespaced
   separately just in case. */

import { createClient } from "@supabase/supabase-js";

// Header-safety: the browser's fetch (and undici) reject any header value with a
// code point above U+00FF — "String contains non ISO-8859-1 code point". Supabase
// keys are legitimately pure ASCII, so a bad byte (smart-quote, NBSP, BOM,
// zero-width char pasted into a Vercel env var) is always dirt. Strip surrounding
// whitespace and drop any non-ASCII byte so createClient can never throw at boot.
function asciiClean(v) {
  if (typeof v !== "string") return v;
  // eslint-disable-next-line no-control-regex
  return v.trim().replace(/[^\x00-\x7F]/g, "");
}

const url = asciiClean(import.meta.env.VITE_SCOUT_SUPABASE_URL);
const key = asciiClean(import.meta.env.VITE_SCOUT_SUPABASE_ANON_KEY);

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

/* ---- Shortlist / product write helpers (anon key; gated by the Scout DB RLS:
   shortlist allows anon CRUD, products allows anon UPDATE/DELETE per migration
   0004). Every call degrades to {ok:false} instead of throwing. ---- */

export async function fetchShortlist() {
  try {
    const { data, error } = await scoutSupabase.from("shortlist").select("*").limit(2000);
    if (error) throw error;
    const byProduct = {};
    for (const s of data || []) byProduct[String(s.product_id)] = s;
    return byProduct;
  } catch (err) {
    console.error("[scout] fetchShortlist failed:", err?.message || err);
    return {};
  }
}

export async function toggleStar(productId, starred) {
  try {
    const { error } = await scoutSupabase
      .from("shortlist")
      .upsert(
        { product_id: productId, starred, updated_at: new Date().toISOString() },
        { onConflict: "product_id" }
      );
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error("[scout] toggleStar failed:", err?.message || err);
    return { ok: false };
  }
}

export async function setArchived(productId, archived) {
  try {
    const { error } = await scoutSupabase
      .from("products")
      .update({ archived })
      .eq("id", productId);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error("[scout] setArchived failed:", err?.message || err);
    return { ok: false };
  }
}

export async function deleteProduct(productId) {
  try {
    const { error } = await scoutSupabase.from("products").delete().eq("id", productId);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error("[scout] deleteProduct failed:", err?.message || err);
    return { ok: false };
  }
}
