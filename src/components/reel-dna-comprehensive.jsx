/* =========================================================
   ReelDnaComprehensive — the (now sole) Reel DNA view.

   Layout: a single global search box + a Grid ⇄ Gallery sub-toggle.
     · Grid    — the editable DnaTable spreadsheet, with per-column
                 filter headers and a "⤢ Card" affordance on each row
                 that opens the rich UnifiedDnaCard in a centered modal
                 (so assets can be attached without leaving the grid).
     · Gallery — a grid of rich UnifiedDnaCards (attach pickers, inline
                 create, pull-from-pipeline) in-line.

   The old left facet rail (Classic ⇄ Comprehensive leftover) is gone;
   filtering is the global search (both sub-views) + the Grid column
   headers. Pure presentation + local filter state; all persistence
   flows back through the `actions`/callbacks the page passes down.
   ========================================================= */

import React, { useMemo, useState, useEffect, useRef } from "react";
import { DnaTable, resolveTags } from "../pages/reel-dna.jsx";
import { UnifiedDnaCard } from "./unified-dna-card.jsx";
import { ReelPreviewModal } from "./reel-preview-modal.jsx";
import { resolveBrief } from "../lib/reel-dna.jsx";
import { useWorkflow } from "../store/store.jsx";
import {
  emptyColumnFilters, applyColumnFilters, searchHaystack,
  RD_HIDEABLE_COLUMNS,
} from "../lib/reel-dna-filters.jsx";

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function downloadReelDnaCsv(items) {
  const headers = ["URL", "Platform", "Captured", "Location", "Music", "Font", "SFX", "Story / Pacing", "Notes"];
  const rows = items.map((item) => {
    const tags = resolveTags(item);
    return [
      item.reelUrl || "",
      item.platform || "",
      item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "",
      tags.location,
      tags.music,
      tags.font,
      tags.sfx,
      tags.story,
      item.quickNotes || "",
    ].map(csvEscape).join(",");
  });
  const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "reel-dna.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
   Columns menu — a dropdown to hide/show the 8 hideable spreadsheet columns
   (Feature A). Mirrors the gallery-only "Hide assets" affordance's placement in
   .rdc-contentbar, gated to the Grid sub-view. Absolute-positioned inside a
   position:relative wrapper (the contentbar has no overflow/transform, so NO
   portal is needed); closes on outside-click + Esc. Reads/writes the per-user
   `hiddenReelDnaCols` pref via the store actions passed in. */
function ColumnsMenu({ hiddenCols, onToggle, onShowAll }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const hiddenSet = new Set(Array.isArray(hiddenCols) ? hiddenCols : []);
  const hiddenCount = RD_HIDEABLE_COLUMNS.filter((c) => hiddenSet.has(c.key)).length;
  return (
    <span className="rdc-columns" ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={"rdc-columns-btn" + (hiddenCount ? " is-on" : "")}
        aria-haspopup="true"
        aria-expanded={open}
        title="Show / hide spreadsheet columns"
        onClick={() => setOpen((o) => !o)}
      >
        ▦ Columns{hiddenCount ? ` · ${hiddenCount} hidden` : ""}
      </button>
      {open && (
        <div className="rdc-columns-menu" role="menu">
          {RD_HIDEABLE_COLUMNS.map((c) => {
            const shown = !hiddenSet.has(c.key);
            return (
              <label key={c.key} className="rdc-columns-item">
                <input type="checkbox" checked={shown} onChange={() => onToggle(c.key)} />
                <span>{c.label}</span>
              </label>
            );
          })}
          <button type="button" className="rdc-columns-showall" onClick={() => { onShowAll(); }}>
            Show all
          </button>
        </div>
      )}
    </span>
  );
}

export function ReelDnaComprehensive({
  items, now, actions, onView, onDeconstruct, onSend, onBack, onDelete, onOpenAssets, isOwner,
}) {
  const list = Array.isArray(items) ? items : [];
  // Per-user column-hide + visited-link prefs come from the store (contracts
  // C1 + C5). DnaTable stays a pure renderer — it receives these as props.
  const {
    hiddenReelDnaCols, visitedReelDnaIds, lastVisitedReelDnaId,
    actions: storeActions,
  } = useWorkflow();
  const hiddenCols = Array.isArray(hiddenReelDnaCols) ? hiddenReelDnaCols : [];
  const visitedIds = Array.isArray(visitedReelDnaIds) ? visitedReelDnaIds : [];

  // Defensive wrappers — the store actions (contracts C1/C5) are owned by TEAM
  // STORE; guard so a not-yet-landed action can never crash a click handler.
  const toggleCol  = (key) => storeActions?.toggleReelDnaCol?.(key);
  const showAllCols = () => storeActions?.setReelDnaCols?.([]);
  const markVisited = (id) => storeActions?.markReelDnaVisited?.(id);

  const [sub, setSub] = useState("grid"); // grid | gallery
  const [q, setQ] = useState("");          // single global search (both sub-views)
  const [colFilters, setColFilters] = useState(emptyColumnFilters); // Grid column headers
  const [modalId, setModalId] = useState(null); // row → centered UnifiedDnaCard modal
  const [previewItem, setPreviewItem] = useState(null); // row link → in-app reel preview
  const [hideAllAssets, setHideAllAssets] = useState(false); // Gallery: hide every card's assets (session state)
  const [favOnly, setFavOnly] = useState(false);   // ★ show only starred rows
  const [colorFilter, setColorFilter] = useState(null); // hex → show only rows with that color tag

  const onColFilter = (key, value) => setColFilters((f) => ({ ...f, [key]: value }));
  const clearColFilters = () => setColFilters(emptyColumnFilters());

  // Global search first, then the column-header filters. Column filters apply to
  // both sub-views (the header only renders in Grid, but an active filter still
  // narrows Gallery — predictable across the toggle).
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((it) => searchHaystack(it, resolveBrief(it)).includes(needle));
  }, [list, q]);
  const columnFiltered = useMemo(() => applyColumnFilters(searched, colFilters), [searched, colFilters]);

  // Distinct color tags actually in use across the pool — drives the swatch
  // filter row (only colors that exist are offered, so it stays tidy).
  const colorsInUse = useMemo(() => {
    const out = [];
    for (const it of list) if (it.rowColor && !out.includes(it.rowColor)) out.push(it.rowColor);
    return out;
  }, [list]);

  // Star/color quick-filters layer on top of search + column filters.
  const filtered = useMemo(() => {
    let out = columnFiltered;
    if (favOnly) out = out.filter((it) => it.favorite);
    if (colorFilter) out = out.filter((it) => it.rowColor === colorFilter);
    return out;
  }, [columnFiltered, favOnly, colorFilter]);

  const modalItem = useMemo(
    () => (modalId ? list.find((d) => d.id === modalId) || null : null),
    [modalId, list]
  );

  return (
    <div className="rdc-root rdc-root--solo">
      <section className="rdc-content">
        <div className="rdc-contentbar">
          <input
            className="rdc-search"
            type="search"
            value={q}
            placeholder="Search everything…"
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="rdc-result-count">
            {filtered.length} of {list.length} reel{list.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="rdc-csv-btn"
            title="Download visible rows as CSV"
            onClick={() => downloadReelDnaCsv(filtered)}
          >
            ↓ CSV
          </button>
          {sub === "grid" && (
            <ColumnsMenu
              hiddenCols={hiddenCols}
              onToggle={toggleCol}
              onShowAll={showAllCols}
            />
          )}
          {sub === "gallery" && (
            <button
              type="button"
              className={"rdc-hide-assets-btn" + (hideAllAssets ? " is-on" : "")}
              aria-pressed={hideAllAssets}
              title={hideAllAssets ? "Show assets on all cards" : "Hide assets on all cards"}
              onClick={() => setHideAllAssets((v) => !v)}
            >
              {hideAllAssets ? "▤ Show assets" : "▥ Hide assets"}
            </button>
          )}
          <div className="rdc-subswitch" role="group" aria-label="Comprehensive layout">
            <button type="button" className={"rdc-sub-btn" + (sub === "grid" ? " is-on" : "")}
              aria-pressed={sub === "grid"} onClick={() => setSub("grid")}>▦ Grid</button>
            <button type="button" className={"rdc-sub-btn" + (sub === "gallery" ? " is-on" : "")}
              aria-pressed={sub === "gallery"} onClick={() => setSub("gallery")}>▤ Gallery</button>
          </div>
        </div>

        {/* Grid ALWAYS renders DnaTable so the <thead> column-filter row stays
            mounted/editable even at zero results — DnaTable shows its own
            full-width "no reels match" <tr> notice inside <tbody>. The standalone
            empty <div> is kept for Gallery only (no headers to preserve there). */}
        {sub === "grid" ? (
          <DnaTable items={filtered} now={now} actions={actions}
                    onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onBack={onBack} onDelete={onDelete}
                    onOpenAssets={onOpenAssets} onOpenCard={(it) => setModalId(it.id)}
                    colFilters={colFilters} onColFilter={onColFilter} onClearColFilters={clearColFilters}
                    favOnly={favOnly} onFavFilter={setFavOnly}
                    colorFilter={colorFilter} onColorFilter={setColorFilter} colorsInUse={colorsInUse}
                    hiddenCols={hiddenCols}
                    onOpenPreview={(it) => setPreviewItem(it)}
                    onLinkClick={(it) => markVisited(it.id)}
                    visitedReelDnaIds={visitedIds}
                    lastVisitedReelDnaId={lastVisitedReelDnaId ?? null} />
        ) : filtered.length === 0 ? (
          <div className="rd-empty">No reels match these filters.</div>
        ) : (
          <div className="rd-grid">
            {filtered.map((item) => (
              <UnifiedDnaCard key={item.id} item={item} now={now} actions={actions}
                       onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onDelete={onDelete}
                       onOpenAssets={onOpenAssets} isOwner={isOwner}
                       hideAssetsOverride={hideAllAssets} />
            ))}
          </div>
        )}
      </section>

      {/* Row → centered modal with the rich card so the user can attach assets. */}
      {modalItem && (
        <div className="rdc-modal-overlay" onClick={() => setModalId(null)}>
          <div className="rdc-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="rdc-modal-close" title="Close" onClick={() => setModalId(null)}>✕</button>
            <UnifiedDnaCard item={modalItem} now={now} actions={actions}
                     onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onDelete={onDelete}
                     onOpenAssets={onOpenAssets} isOwner={isOwner} />
          </div>
        </div>
      )}

      {/* In-app reel preview — opened by a plain left-click on a Reel link. */}
      <ReelPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}
