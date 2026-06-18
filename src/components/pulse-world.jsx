/* PulseWorld — the Pulse tab's "World" view (the Classic/World toggle in
   pulse.jsx flips to this). Two stacked panels:

     1. World Monitor embed — an iframe to the ONLY frame-allowed worldmonitor
        path (embed.html). The full dashboard sends X-Frame-Options SAMEORIGIN,
        so we embed exactly this public path and nothing else. Defensive
        sandbox + no-referrer + lazy-load (no CSP exists in the app).
     2. Native geo feed — the free feeds we ingest ourselves (USGS earthquakes /
        FIRMS fires / ACLED conflict) grouped by eventType. "Refresh now"
        triggers a fresh ingest; new rows arrive live via the store's realtime
        channel, so we just surface the run summary in a local toast.

   Pure / controlled component (mirrors PulseFeed): it reads nothing from the
   store directly — the parent (src/pages/pulse.jsx) passes `events` (the geo
   subset of monitorEvents), `actions`, and `isOwner`. Each event row exposes an
   optional "Link" affordance the parent wires to PulseEventLink via onLinkEvent.

   Component export name is FROZEN: PulseWorld. */

import React, { useMemo, useRef, useState, useEffect } from "react";

const EMBED_SRC = "https://www.worldmonitor.app/embed.html";

/* How long to wait for the iframe to signal a successful load before we assume
   it was blocked. A cross-origin X-Frame-Options / CSP frame-ancestors refusal
   does NOT fire the iframe's onError handler (and usually never fires onLoad
   either) — the browser just paints a permanently blank frame. So onError alone
   can never reveal the fallback. We treat "no onLoad within this window" as a
   block and flip to the manual "open in a new tab" fallback. */
const EMBED_LOAD_TIMEOUT_MS = 8000;

/* The native geo feeds we ingest, in display order. eventType is the frozen
   geo column value emitted by api/ai/_world-feeds.js. */
const GEO_GROUPS = [
  { type: "earthquake", label: "Earthquakes", glyph: "◴", source: "USGS" },
  { type: "fire",       label: "Fires",       glyph: "▲", source: "FIRMS" },
  { type: "conflict",   label: "Conflict",    glyph: "✦", source: "ACLED" },
];
const GEO_TYPES = GEO_GROUPS.map((g) => g.type);

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/* "12.34, -56.78" — uses the frozen geo column name `lng` (NOT lon). */
function fmtCoords(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}

function GeoRow({ event, onLinkEvent, isOwner }) {
  const coords = fmtCoords(event.lat, event.lng);
  return (
    <div className="pulse-world-row" data-event-type={event.eventType}>
      <div className="pulse-world-row-main">
        <div className="pulse-world-row-head">
          <span className="pulse-world-metric">{event.metric || event.magnitude || ""}</span>
          <span className="pulse-world-row-title">
            {event.title || event.place || "(unnamed event)"}
          </span>
        </div>
        <div className="pulse-world-row-meta">
          {event.place && <span className="pulse-world-place">{event.place}</span>}
          {event.region && <span className="pulse-world-region">{event.region}</span>}
          {coords && <span className="pulse-world-coords">{coords}</span>}
          {event.publishedAt && (
            <span className="pulse-world-when">{fmtWhen(event.publishedAt)}</span>
          )}
        </div>
      </div>
      {isOwner && typeof onLinkEvent === "function" && (
        <button
          type="button"
          className="pulse-world-link-btn"
          title="Link this event to a reel / review card / location"
          onClick={() => onLinkEvent(event)}
        >🔗 Link</button>
      )}
    </div>
  );
}

export function PulseWorld({ events, actions, isOwner, onLinkEvent }) {
  const list = Array.isArray(events) ? events : [];
  /* 'pending' = waiting on first load; 'ok' = onLoad fired; 'blocked' = onError
     fired OR the load-timeout elapsed (the X-Frame-Options/CSP case). */
  const [embedState, setEmbedState] = useState("pending");
  const embedTimerRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null); // { kind: 'ok'|'err', msg }

  /* Load-timeout heuristic: a blocked cross-origin frame fires neither onError
     nor onLoad, so we arm a timer when the frame mounts and treat its expiry as
     a block. onLoad clears it (real load); onError clears it (explicit fail). */
  useEffect(() => {
    if (embedState !== "pending") return undefined;
    embedTimerRef.current = setTimeout(() => {
      setEmbedState((s) => (s === "pending" ? "blocked" : s));
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => {
      if (embedTimerRef.current) {
        clearTimeout(embedTimerRef.current);
        embedTimerRef.current = null;
      }
    };
  }, [embedState]);

  const clearEmbedTimer = () => {
    if (embedTimerRef.current) {
      clearTimeout(embedTimerRef.current);
      embedTimerRef.current = null;
    }
  };

  const retryEmbed = () => {
    clearEmbedTimer();
    setEmbedState("pending");
  };

  /* Group the geo events by eventType (only the three known feed types). */
  const groups = useMemo(() => {
    const byType = new Map();
    for (const e of list) {
      if (!GEO_TYPES.includes(e.eventType)) continue;
      if (!byType.has(e.eventType)) byType.set(e.eventType, []);
      byType.get(e.eventType).push(e);
    }
    // Newest first within each group.
    for (const arr of byType.values()) {
      arr.sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      });
    }
    return GEO_GROUPS.map((g) => ({ ...g, rows: byType.get(g.type) || [] }));
  }, [list]);

  const totalGeo = useMemo(
    () => groups.reduce((n, g) => n + g.rows.length, 0),
    [groups]
  );

  const refreshNow = async () => {
    if (refreshing) return;
    setToast(null);
    setRefreshing(true);
    try {
      const r = await actions?.triggerWorldIngest?.();
      if (r?.demo) {
        setToast({ kind: "ok", msg: "Demo mode — ingest skipped." });
      } else {
        const inserted = typeof r?.inserted === "number" ? r.inserted : 0;
        const errs = Array.isArray(r?.errors) ? r.errors.length : 0;
        setToast({
          kind: errs ? "err" : "ok",
          msg: `Ingested ${inserted} new event${inserted === 1 ? "" : "s"}` +
            (errs ? ` · ${errs} feed error${errs === 1 ? "" : "s"}` : ""),
        });
      }
    } catch (e) {
      setToast({ kind: "err", msg: e?.message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="pulse-world">
      {/* ── World Monitor embed ─────────────────────────────── */}
      <div className="pulse-world-embed-card">
        <div className="pulse-world-embed-head">
          <span className="pulse-world-embed-title">World Monitor</span>
          <a className="pulse-world-embed-open"
             href="https://www.worldmonitor.app/"
             target="_blank" rel="noreferrer">
            Open full dashboard ↗
          </a>
        </div>
        {embedState !== "blocked" ? (
          <iframe
            key="world-monitor-embed"
            className="pulse-world-embed-frame"
            src={EMBED_SRC}
            title="World Monitor"
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
            loading="lazy"
            /* onLoad = real load → cancel the block timer. onError = explicit
               failure. Neither fires on a cross-origin X-Frame-Options/CSP
               refusal, which is exactly why the timeout above is the real guard. */
            onLoad={() => { clearEmbedTimer(); setEmbedState("ok"); }}
            onError={() => { clearEmbedTimer(); setEmbedState("blocked"); }}
          />
        ) : (
          <div className="pulse-world-embed-fallback">
            World Monitor embed is unavailable right now (it may be blocking
            embedding).{" "}
            <a href="https://www.worldmonitor.app/" target="_blank" rel="noreferrer">
              Open it in a new tab
            </a>.{" "}
            <button
              type="button"
              className="pulse-world-embed-retry"
              onClick={retryEmbed}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* ── Native geo feed (USGS / FIRMS / ACLED) ──────────── */}
      <div className="pulse-world-feed-card">
        <div className="pulse-world-feed-head">
          <span className="pulse-world-feed-title">
            Live feeds <span className="pulse-world-feed-count">{totalGeo}</span>
          </span>
          {isOwner && (
            <button
              type="button"
              className="pulse-world-refresh"
              onClick={refreshNow}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          )}
        </div>

        {toast && (
          <div className={"pulse-world-toast pulse-world-toast--" + toast.kind}>
            {toast.msg}
          </div>
        )}

        {totalGeo === 0 ? (
          <div className="pulse-world-empty">
            No geo events yet.{isOwner ? " Hit “Refresh now” to pull the latest." : ""}
          </div>
        ) : (
          groups.map((g) =>
            g.rows.length === 0 ? null : (
              <div key={g.type} className="pulse-world-group">
                <div className="pulse-world-group-head">
                  <span className="pulse-world-group-glyph" aria-hidden="true">{g.glyph}</span>
                  <span className="pulse-world-group-label">{g.label}</span>
                  <span className="pulse-world-group-src">{g.source}</span>
                  <span className="pulse-world-group-count">{g.rows.length}</span>
                </div>
                {g.rows.map((event) => (
                  <GeoRow
                    key={event.id}
                    event={event}
                    onLinkEvent={onLinkEvent}
                    isOwner={isOwner}
                  />
                ))}
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}

export default PulseWorld;
