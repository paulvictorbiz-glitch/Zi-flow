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
import { useWorkflow } from "../store/store.jsx";
import { PulseFilters } from "../components/pulse-filters.jsx";
import { PulseFeed } from "../components/pulse-feed.jsx";
import { PulseEntryModal } from "../components/pulse-entry-modal.jsx";
import { PulseSources } from "../components/pulse-sources.jsx";

/* Default filter state. `section` and `status` use 'all' as the
   "no filter" sentinel; `platform` and `severity` use null. */
const DEFAULT_FILTERS = {
  section:  "all",
  platform: null,
  severity: null,
  status:   "all",
  q:        "",
};

export function Pulse() {
  const { person } = useAuth();
  const isOwner = person?.role === "owner";

  const { monitorEvents, monitorSources, actions } = useWorkflow();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [modalOpen, setModalOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");

  /* ── Memoised filtered list ──────────────────────────────
     monitorEvents may be undefined (loading) — guard with an
     empty array for the memo, but render the loading state
     separately below using the raw value. */
  const filtered = useMemo(() => {
    const rows = Array.isArray(monitorEvents) ? monitorEvents : [];
    const q = (filters.q || "").trim().toLowerCase();

    return rows.filter(row => {
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

  return (
    <div className="pulse-root">
      <div className="pulse-header">
        <div className="pulse-header-text">
          <h2 className="pulse-title">Pulse</h2>
          <p className="pulse-subtitle">Algorithm updates · Policy changes · World news</p>
        </div>
        <div className="pulse-header-actions">
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
        </div>
      </div>

      <div className="pulse-filters">
        <PulseFilters
          value={filters}
          onChange={setFilters}
          person={person}
        />
      </div>

      <div className="pulse-feed">
        {loading && <div className="pulse-empty">Loading pulse…</div>}
        {!loading && filtered.length === 0 && (
          <div className="pulse-empty">No pulse entries match the current filters.</div>
        )}
        {!loading && filtered.length > 0 && (
          <PulseFeed
            items={filtered}
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
    </div>
  );
}
