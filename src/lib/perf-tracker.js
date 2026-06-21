/* =========================================================
   perf-tracker.js — frontend Web-Vitals collector (D2)

   Goal: capture real-user performance ONCE per session and
   write a single `perf_samples` row when the page is hidden /
   unloaded. Deliberately NOT chatty — the ~15-concurrent-user
   scaling work (store.jsx windowed boot, trimmed realtime)
   must not regress, so this fires exactly one insert per
   session, on visibilitychange→hidden / pagehide, via a
   keepalive beacon (so it survives the unload).

   What we collect:
     · Web Vitals via the `web-vitals` package:
         onLCP  → lcp_ms
         onINP  → inp_ms
         onCLS  → cls
         onTTFB → ttfb_ms
         onFCP  → (folded into the buffer; not a frozen column,
                   kept only as a sanity signal, dropped on write)
     · Total page load via the Navigation Timing API:
         performance.getEntriesByType('navigation')[0] →
           duration (or loadEventEnd - startTime) → load_ms

   Attribution:
     person_id is the `people` slot id ("paul" / "alex" / …).
     auth.jsx's `useAuth()` is a React hook and can't run outside
     the provider tree (and we're told to init from main.jsx and
     NOT edit auth.jsx/app.jsx). So we resolve person_id the SAME
     way AuthProvider does internally — look up the `people` row by
     the signed-in auth user's id (people.user_id) — and cache it.
     If the user isn't signed in / not yet claimed, person_id is
     null and the row is still written (anonymous boot sample).

   Frozen perf_samples columns written:
     [id, person_id, path, load_ms, lcp_ms, inp_ms, cls, ttfb_ms,
      ua, created_at]
     (id / created_at are DB-defaulted, so we omit them from the
      payload and let Postgres fill them.)

   Degrade silently if:
     · web-vitals can't be imported,
     · the perf_samples table doesn't exist / insert is rejected
       (e.g. migration 0086 not yet applied),
     · the browser lacks sendBeacon / Navigation Timing.
   ========================================================= */

import { supabase } from "./supabase-client.js";

/* Single-init + single-flush guards. Module-level so even an
   accidental double init (React StrictMode double-invoke, HMR)
   can't produce two collectors or two rows. */
let _initialized = false;
let _flushed = false;

/* The rolling buffer of this session's metrics. One object, one row. */
const _metrics = {
  lcp_ms: null,
  inp_ms: null,
  cls: null,
  ttfb_ms: null,
  fcp_ms: null, // sanity-only, dropped before write (not a frozen column)
  load_ms: null,
};

/* Cached attribution — resolved once on sign-in, read at flush. */
let _personId = null;

/* Round a millisecond metric to an integer; pass through null. */
function _ms(v) {
  return v == null || Number.isNaN(v) ? null : Math.round(v);
}

/* Total page load from the Navigation Timing API. Prefer the
   PerformanceNavigationTiming `duration` (== loadEventEnd in the
   navigation entry); fall back to loadEventEnd - startTime. */
function _readNavigationLoad() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return null;
    const dur = nav.duration || (nav.loadEventEnd - nav.startTime);
    return dur > 0 ? _ms(dur) : null;
  } catch {
    return null;
  }
}

/* Resolve the person slot id for the current auth user, the same
   query AuthProvider runs. Cached; degrades to null silently. */
async function _resolvePersonId() {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;
    if (!userId) { _personId = null; return; }
    const { data, error } = await supabase
      .from("people")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return; // silent
    _personId = data?.id || null;
  } catch {
    /* silent */
  }
}

/* Build the frozen-column payload. id + created_at are DB-defaulted. */
function _buildRow() {
  return {
    person_id: _personId,
    path: (typeof location !== "undefined" ? location.pathname : null),
    load_ms: _metrics.load_ms,
    lcp_ms: _metrics.lcp_ms,
    inp_ms: _metrics.inp_ms,
    cls: _metrics.cls,
    ttfb_ms: _metrics.ttfb_ms,
    ua: (typeof navigator !== "undefined" ? navigator.userAgent : null),
  };
}

/* Flush EXACTLY ONCE per session. The unload-safe write path is
   fetch(..., { keepalive:true }) — it survives the page going away
   AND can carry the apikey / Authorization headers PostgREST
   requires (navigator.sendBeacon can't set custom headers, so it
   can't satisfy PostgREST auth — hence keepalive-fetch is primary,
   with a plain supabase insert as a non-unload fallback). All
   failures are swallowed. */
function _flush() {
  if (_flushed) return;
  _flushed = true;

  // Make sure we have the final load number even if the load event
  // landed after init.
  if (_metrics.load_ms == null) _metrics.load_ms = _readNavigationLoad();

  let row;
  try {
    row = _buildRow();
  } catch {
    return; // silent
  }

  // Primary path: fetch with keepalive — unload-safe AND can carry the
  // apikey / Authorization headers PostgREST requires.
  try {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (url && key && typeof fetch === "function") {
      let token = key;
      try {
        const rawKey = Object.keys(window.localStorage)
          .find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        const parsed = rawKey ? JSON.parse(window.localStorage.getItem(rawKey)) : null;
        if (parsed?.access_token) token = parsed.access_token;
      } catch { /* use anon key */ }

      fetch(`${url}/rest/v1/perf_samples`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "apikey": key,
          "Authorization": `Bearer ${token}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(row),
      }).catch(() => { /* silent — table may not exist yet */ });
      return;
    }
  } catch {
    /* silent — fall through to supabase insert */
  }

  // Fallback path: async supabase insert (not unload-safe, but covers
  // non-unload flush triggers / missing fetch). Swallowed.
  try {
    supabase.from("perf_samples").insert(row).then(
      () => {},
      () => {}
    );
  } catch {
    /* silent */
  }
}

/* Wire the one-shot flush to the page-hidden / unload signals.
   visibilitychange→hidden is the reliable mobile/bfcache signal;
   pagehide covers desktop navigation/close. Both funnel through the
   _flushed guard so only one row is ever written. */
function _wireFlushTriggers() {
  try {
    const onHidden = () => {
      if (document.visibilityState === "hidden") _flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", _flush);
  } catch {
    /* silent — no flush triggers available */
  }
}

/* Public init. Call ONCE (from main.jsx). Idempotent + silent. */
export function initPerfTracker() {
  if (_initialized) return;
  _initialized = true;

  // No-op outside the browser (SSR/build) or when Performance is absent.
  if (typeof window === "undefined" || typeof performance === "undefined") return;

  // Resolve attribution eagerly (and on auth changes) so person_id is
  // already cached by the time we flush at unload.
  _resolvePersonId();
  try {
    supabase.auth.onAuthStateChange(() => { _resolvePersonId(); });
  } catch { /* silent */ }

  // Subscribe to Web Vitals. Dynamic import so a missing/broken
  // web-vitals package degrades to "no vitals" rather than crashing boot.
  import("web-vitals")
    .then(({ onLCP, onINP, onCLS, onTTFB, onFCP }) => {
      try {
        onLCP((m) => { _metrics.lcp_ms = _ms(m.value); });
        onINP((m) => { _metrics.inp_ms = _ms(m.value); });
        onCLS((m) => {
          // CLS is unitless; keep a few decimals, don't round to int.
          _metrics.cls = m.value == null ? null : Math.round(m.value * 1000) / 1000;
        });
        onTTFB((m) => { _metrics.ttfb_ms = _ms(m.value); });
        if (typeof onFCP === "function") onFCP((m) => { _metrics.fcp_ms = _ms(m.value); });
      } catch {
        /* silent — partial vitals still flush */
      }
    })
    .catch(() => { /* web-vitals unavailable — degrade silently */ });

  // Seed the load number now; refreshed again at flush time.
  _metrics.load_ms = _readNavigationLoad();

  _wireFlushTriggers();
}

export default initPerfTracker;
