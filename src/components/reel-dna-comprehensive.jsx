/* =========================================================
   ReelDnaComprehensive — the "Comprehensive" Reel DNA view, the
   second half of the Classic ⇄ Comprehensive toggle on the Reel
   DNA page.

   Layout: a faceted filter rail on the left (multi-select chips
   per platform / status / source / gene, plus a global search and
   a location search) and a content area on the right with its own
   Grid ⇄ Gallery sub-toggle:
     · Grid    — the editable DnaTable spreadsheet
     · Gallery — the rich DnaCard grid

   Both content modes and the Classic spreadsheet reuse the SAME
   row renderers (DnaTable / DnaCard) and the SAME filter model
   (lib/reel-dna-filters.jsx), so a reel looks and edits identically
   wherever it appears. Pure presentation + local filter state; all
   persistence flows back through the `actions`/callbacks the page
   passes down.
   ========================================================= */

import React, { useMemo, useState } from "react";
import { DnaTable, DnaCard } from "../pages/reel-dna.jsx";
import {
  emptyFacetState, hasActiveFacets, computeFacets, applyFacets, toggleFacet,
} from "../lib/reel-dna-filters.jsx";

/* One facet group of multi-select chips. */
function FacetGroup({ title, options, selected, onToggle }) {
  if (!options.length) return null;
  return (
    <div className="rdc-facet">
      <div className="rdc-facet-title">{title}</div>
      <div className="rdc-facet-opts">
        {options.map((o) => (
          <button key={o.key} type="button"
            className={"rdc-facet-chip" + (selected.includes(o.key) ? " is-on" : "")}
            aria-pressed={selected.includes(o.key)}
            onClick={() => onToggle(o.key)}>
            <span className="rdc-facet-label">{o.label}</span>
            <span className="rdc-facet-count">{o.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReelDnaComprehensive({
  items, now, actions, onView, onDeconstruct, onSend, onDelete,
}) {
  const list = Array.isArray(items) ? items : [];
  const [facets, setFacets] = useState(emptyFacetState);
  const [sub, setSub] = useState("grid"); // grid | gallery

  const facetOpts = useMemo(() => computeFacets(list), [list]);
  const filtered = useMemo(() => applyFacets(list, facets), [list, facets]);

  const toggle = (key, value) => setFacets((s) => toggleFacet(s, key, value));
  const clearAll = () => setFacets(emptyFacetState());
  const active = hasActiveFacets(facets);

  return (
    <div className="rdc-root">
      {/* ── Filter rail ─────────────────────────────────── */}
      <aside className="rdc-rail">
        <div className="rdc-rail-head">
          <span className="rdc-rail-title">Filters</span>
          {active && (
            <button type="button" className="rdc-clear" onClick={clearAll}>Clear all</button>
          )}
        </div>

        <input
          className="rdc-search"
          type="search"
          value={facets.q}
          placeholder="Search everything…"
          onChange={(e) => setFacets((s) => ({ ...s, q: e.target.value }))}
        />
        <input
          className="rdc-search"
          type="search"
          value={facets.location}
          placeholder="Location…"
          onChange={(e) => setFacets((s) => ({ ...s, location: e.target.value }))}
        />

        <FacetGroup title="Platform" options={facetOpts.platforms} selected={facets.platforms} onToggle={(v) => toggle("platforms", v)} />
        <FacetGroup title="Status"   options={facetOpts.statuses}  selected={facets.statuses}  onToggle={(v) => toggle("statuses", v)} />
        <FacetGroup title="Source"   options={facetOpts.sources}   selected={facets.sources}   onToggle={(v) => toggle("sources", v)} />
        <FacetGroup title="Genes tagged" options={facetOpts.genes} selected={facets.genes}     onToggle={(v) => toggle("genes", v)} />
      </aside>

      {/* ── Content ─────────────────────────────────────── */}
      <section className="rdc-content">
        <div className="rdc-contentbar">
          <span className="rdc-result-count">
            {filtered.length} of {list.length} reel{list.length === 1 ? "" : "s"}
          </span>
          <div className="rdc-subswitch" role="group" aria-label="Comprehensive layout">
            <button type="button" className={"rdc-sub-btn" + (sub === "grid" ? " is-on" : "")}
              aria-pressed={sub === "grid"} onClick={() => setSub("grid")}>▦ Grid</button>
            <button type="button" className={"rdc-sub-btn" + (sub === "gallery" ? " is-on" : "")}
              aria-pressed={sub === "gallery"} onClick={() => setSub("gallery")}>▤ Gallery</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rd-empty">No reels match these filters.</div>
        ) : sub === "grid" ? (
          <DnaTable items={filtered} now={now} actions={actions}
                    onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onDelete={onDelete} />
        ) : (
          <div className="rd-grid">
            {filtered.map((item) => (
              <DnaCard key={item.id} item={item} now={now} actions={actions}
                       onView={onView} onDeconstruct={onDeconstruct} onSend={onSend} onDelete={onDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
