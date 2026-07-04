/* =========================================================
   useMonitorStatus — shared infrastructure-status fetch.

   Lifted out of pages/monitor.jsx so the live Monitor cards can be
   mounted in more than one place (the Monitor tab AND the /space HUD)
   off a single source of truth: the /api/monitor/status poll + the
   per-section last-good merge + the localStorage cache.

   Behaviour is byte-identical to the original Monitor() fetch:
   render the cached payload immediately, only hit the API when the
   cache is older than the poll window, merge per-section so a transient
   provider blip never blanks a card, and re-poll on an interval.
   ========================================================= */
import { useState, useEffect, useCallback, useRef } from "react";

export const MON_POLL_MS   = 60 * 60 * 1000;   // 60 min — provider APIs are rate-limited
export const MON_CACHE_KEY = "mon.cache.v1";    // last successful /api/monitor/status payload

/* The provider sub-fetches that make up a status payload. Each can fail
   independently without the others failing — merge per-section and keep the
   last-good value rather than letting one blip blank a whole card. */
const STATUS_SECTIONS = ["supabase", "hetzner", "gcp", "os", "worldMonitor"];

/* A section is "usable" when it actually carried data — configured and no
   error. An unconfigured or errored section is a blip we replace with last-good. */
function sectionUsable(s) {
  return !!s && s.configured !== false && !s.error;
}

/* Merge a fresh payload over the previous one, preserving last-good for any
   section that came back unusable this tick (flagging it _stale). */
export function mergeStatus(prev, next) {
  if (!next) return prev;
  const merged = { ...next };
  for (const k of STATUS_SECTIONS) {
    if (!sectionUsable(next[k]) && sectionUsable(prev?.[k])) {
      merged[k] = { ...prev[k], _stale: true };
    }
  }
  return merged;
}

/* Strip transient _stale flags before caching so a since-recovered section
   doesn't render as stale on the next cold mount. */
export function stripStale(d) {
  if (!d) return d;
  const out = { ...d };
  for (const k of STATUS_SECTIONS) {
    if (out[k]?._stale) {
      const { _stale, ...rest } = out[k];
      out[k] = rest;
    }
  }
  return out;
}

/**
 * @param {{ onThresholds?: (merged:any)=>void }} [opts]
 *   onThresholds fires with the merged payload after each successful load —
 *   used by the Monitor tab to raise its in-app threshold toast. The HUD
 *   omits it.
 * @returns {{ data, loading, error, lastFetch:Date|null, fromCache:boolean, refresh:()=>Promise<void> }}
 */
export function useMonitorStatus({ onThresholds, enabled = true } = {}) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [fromCache, setFromCache] = useState(false);

  // Mirror the latest merged data into a ref so load() can read it as the
  // "previous" payload without re-creating the callback on every change.
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Keep the threshold callback in a ref so its identity churn never
  // re-subscribes the poll.
  const onThreshRef = useRef(onThresholds);
  useEffect(() => { onThreshRef.current = onThresholds; }, [onThresholds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/monitor/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const now = Date.now();
      const merged = mergeStatus(dataRef.current, d);
      setData(merged);
      setLastFetch(new Date(now));
      setFromCache(false);
      setError(null);
      try { localStorage.setItem(MON_CACHE_KEY, JSON.stringify({ ts: now, payload: stripStale(merged) })); } catch (_) {}
      onThreshRef.current?.(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount (when enabled): render the cached payload immediately, then only
  // hit the API if the cache is older than the poll window (or absent).
  useEffect(() => {
    if (!enabled) return;
    let stale = true;
    try {
      const raw = localStorage.getItem(MON_CACHE_KEY);
      if (raw) {
        const { ts, payload } = JSON.parse(raw);
        if (payload) {
          setData(payload);
          setLastFetch(new Date(ts));
          setFromCache(true);
          setLoading(false);
          stale = Date.now() - ts > MON_POLL_MS;
        }
      }
    } catch (_) {}
    if (stale) load();
  // run when enabling
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(load, MON_POLL_MS);
    return () => clearInterval(id);
  }, [load, enabled]);

  return { data, loading, error, lastFetch, fromCache, refresh: load };
}
