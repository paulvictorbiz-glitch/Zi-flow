/* ---------- BoxTable ----------
   Full-screen dense table overlay for a single pipeline box (lane × stage).
   Built for hundreds of reels: thin one-line rows, search + sort, bulk
   multi-select (Move to editor / Duplicate for editor / Archive), and per-row
   quick actions. Reuses the existing store actions (moveStage / duplicateReel /
   archiveReel / deleteReel) — no new store surface. Reassign-to-editor is the
   drag-equivalent here, since the board is hidden behind the overlay.

   Props:
     laneName    display name of the box owner/lane
     stageLabel  display label of the stage (e.g. "Not started")
     stageKey    canonical stage key (e.g. "not_started")
     reels       array of reel objects currently in this box (live from parent)
     peopleList  roster people (for the editor pickers)
     actions     store actions
     canArchive / canDelete / canCreate  permission flags
     onClose     () => void
     onOpenReel  (reel) => void   opens the reel detail
*/
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import "../box-table.css";

const CARD_COLORS = ["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"];
const firstNameOf = (p) => (p?.name || "").trim().split(/\s+/)[0] || p?.short || p?.id || "";

export default function BoxTable({
  laneName, stageLabel, stageKey = "not_started", reels = [], peopleList = [],
  actions, canArchive = true, canDelete = false, canCreate = true,
  onClose, onOpenReel,
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("id");
  const [selected, setSelected] = useState(() => new Set());
  const [lastIdx, setLastIdx] = useState(null);

  // Editors that can receive a move/duplicate = non-reviewer, non-archived
  // people (mirrors the pipeline's personal-lane list). Reviewers live only in
  // the shared review lane, so they're excluded here.
  const editors = useMemo(
    () => (peopleList || []).filter(p => p && !p.archivedAt && p.role !== "reviewer"),
    [peopleList]);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Filtered + sorted rows. `id` sort is numeric on the REEL-NNN suffix.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = reels;
    if (q) {
      list = list.filter(r =>
        String(r.id || "").toLowerCase().includes(q) ||
        String(r.title || "").toLowerCase().includes(q));
    }
    const numId = (r) => { const m = /(\d+)$/.exec(r?.id || ""); return m ? parseInt(m[1], 10) : 0; };
    const cmp = {
      id: (a, b) => numId(a) - numId(b),
      title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
      newest: (a, b) => String(b.stageEnteredAt || "").localeCompare(String(a.stageEnteredAt || "")),
      color: (a, b) => String(a.tone || "cyan").localeCompare(String(b.tone || "cyan")),
      series: (a, b) => String(a.series || "").localeCompare(String(b.series || "")),
    }[sortKey] || (() => 0);
    return [...list].sort(cmp);
  }, [reels, query, sortKey]);

  // Prune the selection to ids still present (rows vanish after move/archive).
  const presentIds = useMemo(() => new Set(reels.map(r => r.id)), [reels]);
  const selectedPresent = useMemo(
    () => [...selected].filter(id => presentIds.has(id)),
    [selected, presentIds]);
  const selCount = selectedPresent.length;

  const clearSel = useCallback(() => { setSelected(new Set()); setLastIdx(null); }, []);

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) { clearSel(); return; }
    setSelected(new Set(rows.map(r => r.id)));
  };

  const toggleRow = (idx, e) => {
    const id = rows[idx].id;
    setSelected(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastIdx !== null) {
        const [lo, hi] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx];
        for (let i = lo; i <= hi; i++) next.add(rows[i].id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastIdx(idx);
  };

  // ----- bulk + per-row actions -----
  const bulkMove = (editorId) => {
    if (!editorId) return;
    selectedPresent.forEach(id => actions.moveStage(id, { lane: editorId, stage: stageKey }));
    clearSel();
  };
  const bulkDuplicate = (editorId) => {
    if (!editorId) return;
    const p = editors.find(e => e.id === editorId);
    selectedPresent.forEach(id => actions.duplicateReel(id, editorId, firstNameOf(p)));
    clearSel();
  };
  const bulkArchive = () => {
    if (!canArchive) return;
    if (!window.confirm(`Archive ${selCount} reel${selCount === 1 ? "" : "s"}? They leave the board but stay restorable.`)) return;
    selectedPresent.forEach(id => actions.archiveReel(id));
    clearSel();
  };
  const rowDuplicate = (id, editorId) => {
    if (!editorId) return;
    const p = editors.find(e => e.id === editorId);
    actions.duplicateReel(id, editorId, firstNameOf(p));
  };
  const rowArchive = (id) => { if (canArchive) actions.archiveReel(id); };
  const rowDelete = (id) => {
    if (!canDelete) return;
    if (window.confirm("Permanently delete this reel? The source hook/title is preserved and can be re-sent.")) actions.deleteReel(id);
  };

  return createPortal(
    <div className="bxt-overlay" onMouseDown={onClose}>
      <div className="bxt-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bxt-head">
          <div className="bxt-title">
            <strong>{laneName}</strong>
            <span className="bxt-sub">· {stageLabel} · {reels.length}</span>
          </div>
          <button className="bxt-x" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {/* Toolbar */}
        <div className="bxt-toolbar">
          <input
            className="bxt-search"
            type="text"
            placeholder="Search id or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <label className="bxt-sortlbl">Sort
            <select className="bxt-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="id">ID</option>
              <option value="title">Title</option>
              <option value="newest">Newest</option>
              <option value="color">Color</option>
              <option value="series">Series</option>
            </select>
          </label>
          <span className="bxt-count">{rows.length} shown</span>
        </div>

        {/* Bulk action bar */}
        {selCount > 0 && (
          <div className="bxt-bulk">
            <span className="bxt-bulk-count">{selCount} selected</span>
            <label className="bxt-bulk-lbl">Move to
              <select className="bxt-select" value="" onChange={(e) => bulkMove(e.target.value)}>
                <option value="">editor…</option>
                {editors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {canCreate && (
              <label className="bxt-bulk-lbl">Duplicate for
                <select className="bxt-select" value="" onChange={(e) => bulkDuplicate(e.target.value)}>
                  <option value="">editor…</option>
                  {editors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {canArchive && <button className="bxt-btn" onClick={bulkArchive}>Archive selected</button>}
            <button className="bxt-btn ghost" onClick={clearSel}>Clear</button>
          </div>
        )}

        {/* Table */}
        <div className="bxt-table">
          <div className="bxt-row bxt-row--head">
            <span className="bxt-c-check">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
            </span>
            <span className="bxt-c-color" />
            <span className="bxt-c-id">ID</span>
            <span className="bxt-c-title">Title</span>
            <span className="bxt-c-series">Series</span>
            <span className="bxt-c-actions">Actions</span>
          </div>
          <div className="bxt-body">
            {rows.length === 0 && <div className="bxt-empty">No reels{query ? " match this search" : ""}.</div>}
            {rows.map((r, idx) => {
              const color = CARD_COLORS.includes(r.tone) ? r.tone : "cyan";
              const isSel = selected.has(r.id);
              return (
                <div className={"bxt-row" + (isSel ? " is-sel" : "")} key={r.id}>
                  <span className="bxt-c-check">
                    <input type="checkbox" checked={isSel} onChange={(e) => toggleRow(idx, e.nativeEvent)} />
                  </span>
                  <span className="bxt-c-color">
                    <i className="bxt-dot" style={{ background: `var(--c-${color})` }} />
                  </span>
                  <button className="bxt-c-id bxt-link" onClick={() => onOpenReel?.(r)} title="Open reel">{r.id}</button>
                  <span className="bxt-c-title" title={r.title || ""}>{r.title || <em className="bxt-muted">untitled</em>}</span>
                  <span className="bxt-c-series">{r.series ? <span className="bxt-chip">⛓ {r.series}</span> : ""}</span>
                  <span className="bxt-c-actions">
                    <button className="bxt-act" onClick={() => onOpenReel?.(r)} title="Open">Open</button>
                    {canCreate && (
                      <select
                        className="bxt-act bxt-dup"
                        value=""
                        title="Duplicate an independent copy into an editor's Not Started box"
                        onChange={(e) => { rowDuplicate(r.id, e.target.value); e.target.value = ""; }}
                      >
                        <option value="">⧉ Dup…</option>
                        {editors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    {canArchive && <button className="bxt-act" onClick={() => rowArchive(r.id)} title="Archive">Archive</button>}
                    {canDelete && <button className="bxt-act danger" onClick={() => rowDelete(r.id)} title="Delete">Delete</button>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
