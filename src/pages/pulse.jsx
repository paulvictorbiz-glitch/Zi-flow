/* =========================================================
   Pulse — owner-only live monitor for social-platform algorithm
   updates, policy changes, and world/political news that may
   impact the team's content pipeline.

   This is the page-level skeleton: header + subtab/filter row +
   feed body. The heavy lifting (filter UI, feed item rendering,
   add-entry modal) lives in sibling components written by the
   impl-components team. The store layer (monitorEvents +
   actions.createMonitorEvent / updateMonitorEvent /
   deleteMonitorEvent) is owned by team-b.

   Schema enum locks (must match the DB / store contract):
     category : 'algo' | 'news'
     status   : 'new' | 'read' | 'archived'   ('starred' is a UI lens, not DB status)
     severity : 'info' | 'watch' | 'high'
     sourceType on create : 'manual'
   ========================================================= */

import React, { useMemo, useState, useCallback } from "react";
import "./pulse.css";
import { DPill } from "../components/components.jsx";
import { useAuth } from "../auth.jsx";
import { useIsOwner } from "../lib/permissions.jsx";
import { useWorkflow } from "../store/store.jsx";
import { PulseFilters } from "../components/pulse-filters.jsx";
import { PulseComprehensive, PULSE_LAYOUTS } from "../components/pulse-comprehensive.jsx";
import { PulseEntryModal } from "../components/pulse-entry-modal.jsx";
import { PulseSources } from "../components/pulse-sources.jsx";
import { PulseWorld } from "../components/pulse-world.jsx";
import { PulseEventLink } from "../components/pulse-event-link.jsx";
import { isBlockedSync, recordUsage } from "../lib/free-llm-gates.js";

/* Default filter state. `section` and `status` use 'all' as the
   "no filter" sentinel; `platform` and `severity` use null. */
const DEFAULT_FILTERS = {
  section:  "all",
  platform: null,
  severity: null,
  status:   "all",
  q:        "",
};

/* ── Classic ⇄ World view toggle ──────────────────────────
   The Pulse page has two views: the existing "Classic" news/algo
   feed and the new "World" monitor (embed iframe + native geo
   feeds). The choice persists across reloads. Mirrors the helix
   view toggle in landing.jsx. */
const PULSE_VIEW_KEY = "pulse_view";
function loadPulseView() {
  try { return localStorage.getItem(PULSE_VIEW_KEY) === "world" ? "world" : "classic"; }
  catch { return "classic"; }
}

/* ── Classic layout switcher (timeline / cards / table / board) ──
   The Classic feed can be rendered in any of four layouts. Choice
   persists across reloads, independent of the Classic/World view. */
const PULSE_LAYOUT_KEY = "pulse_layout";
const PULSE_LAYOUT_KEYS = PULSE_LAYOUTS.map((l) => l.k);
function loadPulseLayout() {
  try {
    const v = localStorage.getItem(PULSE_LAYOUT_KEY);
    return PULSE_LAYOUT_KEYS.includes(v) ? v : "timeline";
  } catch { return "timeline"; }
}

export function Pulse() {
  const { person } = useAuth();
  const isOwner = useIsOwner();

  const {
    monitorEvents,
    monitorSources,
    reels,
    reviewLaneCards,
    locations,
    eventLinks,
    actions,
  } = useWorkflow();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [modalOpen, setModalOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const [linkingEvent, setLinkingEvent] = useState(null);

  /* Classic ⇄ World view. Persisted to localStorage. */
  const [pulseView, setPulseView] = useState(loadPulseView);
  const setView = useCallback((v) => {
    const next = v === "world" ? "world" : "classic";
    setPulseView(next);
    try { localStorage.setItem(PULSE_VIEW_KEY, next); } catch (_) {}
  }, []);

  /* Classic feed layout (timeline / magazine / table / kanban). */
  const [layout, setLayout] = useState(loadPulseLayout);
  const setLayoutPersist = useCallback((v) => {
    const next = PULSE_LAYOUT_KEYS.includes(v) ? v : "timeline";
    setLayout(next);
    try { localStorage.setItem(PULSE_LAYOUT_KEY, next); } catch (_) {}
  }, []);

  /* ── Memoised filtered list ──────────────────────────────
     monitorEvents may be undefined (loading) — guard with an
     empty array for the memo, but render the loading state
     separately below using the raw value. */
  const filtered = useMemo(() => {
    const rows = Array.isArray(monitorEvents) ? monitorEvents : [];
    const q = (filters.q || "").trim().toLowerCase();

    return rows.filter(row => {
      // Geo events (source_type='geo') belong to the World view only — keep
      // the Classic news/algo feed behaviorally unchanged.
      if (row.sourceType === "geo") return false;

      // section: 'all' skips, else match category
      if (filters.section !== "all" && row.category !== filters.section) return false;

      // platform: null skips
      if (filters.platform && row.platform !== filters.platform) return false;

      // severity: null skips
      if (filters.severity && row.severity !== filters.severity) return false;

      // status lens: 'all' skips; 'starred' is a UI lens (starred===true);
      // any other value matches the DB status field.
      if (filters.status !== "all") {
        if (filters.status === "starred") {
          if (row.starred !== true) return false;
        } else if (row.status !== filters.status) {
          return false;
        }
      }

      // q: case-insensitive substring over title + summary
      if (q) {
        const hay = (
          (row.title || "") + " " + (row.summary || "")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [monitorEvents, filters]);

  /* ── Action callbacks for the feed ──────────────────────── */
  const onMarkRead = useCallback((id) => {
    actions?.updateMonitorEvent?.(id, { status: "read" });
  }, [actions]);

  const onToggleStar = useCallback((id, current) => {
    actions?.updateMonitorEvent?.(id, { starred: !current });
  }, [actions]);

  const onArchive = useCallback((id) => {
    actions?.updateMonitorEvent?.(id, { status: "archived" });
  }, [actions]);

  /* Generic patch save from the inline detail editor (tags, severity, status). */
  const onSave = useCallback((id, patch) => {
    actions?.updateMonitorEvent?.(id, patch);
  }, [actions]);

  const onTrash = useCallback((id) => {
    if (!isOwner) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this pulse entry permanently?")) return;
    actions?.deleteMonitorEvent?.(id);
  }, [actions, isOwner]);

  /* ── Modal submit ───────────────────────────────────────── */
  const handleCreate = useCallback((draft) => {
    if (!draft) return;
    // Lock down the enums regardless of what the modal hands us.
    const category = draft.category === "news" ? "news" : "algo";
    const payload = {
      ...draft,
      sourceType:  "manual",
      status:      "new",
      starred:     false,
      category,
      createdBy:   person?.id,
      publishedAt: new Date().toISOString(),
    };
    actions?.createMonitorEvent?.(payload);
    setModalOpen(false);
  }, [actions, person?.id]);

  /* ── Refresh now: run the news-monitor ingest on demand ──── */
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    if (isBlockedSync("news_ingest")) {
      setToast("News ingest is disabled — enable it in Monitor → Free LLM Gates.");
      setTimeout(() => setToast(""), 6000);
      return;
    }
    recordUsage("news_ingest");
    setRefreshing(true);
    setToast("");
    try {
      const r = await actions?.triggerNewsIngest?.();
      if (r?.demo) {
        setToast("Demo mode — ingest disabled.");
      } else {
        const n = r?.inserted ?? 0;
        const errs = r?.errors?.length ? ` · ${r.errors.length} feed error(s)` : "";
        setToast(n > 0 ? `+${n} new article${n === 1 ? "" : "s"}${errs}` : `No new articles${errs}`);
      }
    } catch (e) {
      setToast(e?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
      // New rows stream in via realtime; clear the toast after a moment.
      setTimeout(() => setToast(""), 6000);
    }
  }, [actions, refreshing]);

  /* ── Non-owner gate (secondary defense) ─────────────────── */
  if (!isOwner) {
    return (
      <div className="pulse-root">
        <div className="pulse-header">
          <h2 className="pulse-title">Pulse</h2>
          <p className="pulse-subtitle">Algorithm updates · Policy changes · World news</p>
        </div>
        <div className="pulse-empty">Pulse is owner-only. Ask Paul for access.</div>
      </div>
    );
  }

  /* ── Loading state ──────────────────────────────────────── */
  const loading = monitorEvents == null;

  const isWorld = pulseView === "world";

  return (
    <div className="pulse-root">
      <div className="pulse-header">
        <div className="pulse-header-text">
          <h2 className="pulse-title">Pulse</h2>
          <p className="pulse-subtitle">Algorithm updates · Policy changes · World news</p>
        </div>
        <div className="pulse-header-actions">
          {/* Classic ⇄ World view toggle (plain aria-pressed buttons —
              DPill has no aria-pressed support; mirrors landing.jsx). */}
          <div className="pulse-viewtoggle" role="group" aria-label="Pulse view">
            <button type="button"
                    className={"pulse-viewtoggle-btn" + (!isWorld ? " is-on" : "")}
                    aria-pressed={!isWorld}
                    onClick={() => setView("classic")}>Classic</button>
            <button type="button"
                    className={"pulse-viewtoggle-btn" + (isWorld ? " is-on" : "")}
                    aria-pressed={isWorld}
                    onClick={() => setView("world")}>World</button>
          </div>

          {/* Classic-only header actions. */}
          {!isWorld && (
            <>
              {toast && <span className="pulse-toast">{toast}</span>}
              <DPill onClick={() => setSourcesOpen(true)}>
                Sources{Array.isArray(monitorSources) && monitorSources.length ? ` (${monitorSources.length})` : ""}
              </DPill>
              <DPill active={refreshing} onClick={handleRefresh}>
                {refreshing ? "Refreshing…" : "↻ Refresh now"}
              </DPill>
              <DPill primary solid onClick={() => setModalOpen(true)}>
                + Add entry
              </DPill>
            </>
          )}
        </div>
      </div>

      {isWorld ? (
        <PulseWorld
          events={monitorEvents}
          actions={actions}
          isOwner={isOwner}
          onLinkEvent={setLinkingEvent}
        />
      ) : (
        <>
          <div className="pulse-filters">
            <PulseFilters
              value={filters}
              onChange={setFilters}
              person={person}
            />
          </div>

          {/* Layout switcher — same filtered list, four ways to view it. */}
          <div className="pc-layoutbar">
            <span className="pc-layoutbar-label">Layout</span>
            <div className="pc-layout-switch" role="group" aria-label="Feed layout">
              {PULSE_LAYOUTS.map((l) => (
                <button key={l.k} type="button"
                  className={"pc-layout-btn" + (layout === l.k ? " is-on" : "")}
                  aria-pressed={layout === l.k}
                  onClick={() => setLayoutPersist(l.k)}>{l.l}</button>
              ))}
            </div>
            {!loading && (
              <span className="pc-layoutbar-count">
                {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </div>

          <div className="pulse-feed" data-layout={layout}>
            {loading && <div className="pulse-empty">Loading pulse…</div>}
            {!loading && filtered.length === 0 && (
              <div className="pulse-empty">No pulse entries match the current filters.</div>
            )}
            {!loading && filtered.length > 0 && (
              <PulseComprehensive
                items={filtered}
                layout={layout}
                onSave={onSave}
                onMarkRead={onMarkRead}
                onToggleStar={onToggleStar}
                onArchive={onArchive}
                onTrash={onTrash}
                isOwner={isOwner}
              />
            )}
          </div>

          <PulseEntryModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSubmit={handleCreate}
            person={person}
          />

          <PulseSources
            open={sourcesOpen}
            onClose={() => setSourcesOpen(false)}
            sources={monitorSources}
            actions={actions}
            person={person}
          />
        </>
      )}

      <PulseEventLink
        event={linkingEvent}
        reels={reels}
        reviewLaneCards={reviewLaneCards}
        locations={locations}
        eventLinks={eventLinks}
        actions={actions}
        isOwner={isOwner}
        onClose={() => setLinkingEvent(null)}
      />
    </div>
  );
}
