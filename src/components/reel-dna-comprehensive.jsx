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

import React, { useMemo, useState } from "react";
import { DnaTable } from "../pages/reel-dna.jsx";
import { UnifiedDnaCard } from "./unified-dna-card.jsx";
import { resolveBrief } from "../lib/reel-dna.jsx";
import {
  emptyColumnFilters, applyColumnFilters, searchHaystack,
} from "../lib/reel-dna-filters.jsx";

export function ReelDnaComprehensive({
  items, now, actions, onView, onDeconstruct, onSend, onDelete, onOpenAssets, isOwner,
}) {
  const list = Array.isArray(items) ? items : [];
  const [sub, setSub] = useState("grid"); // grid | gallery
  const [q, setQ] = useState("");          // single global search (both sub-views)
  const [colFilters, setColFilters] = useState(emptyColumnFilters); // Grid column headers
  const [modalId, setModalId] = useState(null); // row → centered UnifiedDnaCard modal
  const [hideAllAssets, setHideAllAssets] = useState(false); // Gallery: hide every card's assets (session state)

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
  const filtered = useMemo(() => applyColumnFilters(searched, colFilters), [searched, colFilters]);

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
                    onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onDelete={onDelete}
                    onOpenAssets={onOpenAssets} onOpenCard={(it) => setModalId(it.id)}
                    colFilters={colFilters} onColFilter={onColFilter} onClearColFilters={clearColFilters} />
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
    </div>
  );
}
