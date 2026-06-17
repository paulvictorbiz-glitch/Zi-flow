/* =========================================================
   Reel DNA — Phase 1 capture library.

   Capture a reel you like, tag which "genes" you care about
   (music / font / hook / sfx / story), then fill in each gene's
   components over time. Replaces the spreadsheet "reel genome".

   Three intakes write to the same reel_dna table:
     · the manual capture form on this page (source='manual'),
     · the Instagram share-to-DM webhook on the Hetzner backend
       (source='ig_dm') — those rows arrive live via realtime,
     · the PWA share-target / bookmarklet, which deep-links into
       this page with the URL prefilled (source='share_target').

   Initial form values can be seeded by app.jsx's /capture deep-link
   handler via the optional `prefill` prop.
   ========================================================= */

import React, { useState, useMemo, useEffect } from "react";
import "./reel-dna.css";
import { Card, DPill, Pill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { personName } from "../lib/roster.jsx";
import { useNow, formatDuration } from "../lib/time.jsx";
import {
  GENES, GENE_KEYS, PLATFORMS, STATUSES, SOURCES,
  platformLabel, statusLabel, sourceLabel, geneLabel,
  platformFromUrl, parseTagNote,
} from "../lib/reel-dna.jsx";
import { ReelDeconstructor } from "./reel-deconstructor.jsx";
import { ReelDnaView } from "../components/reel-dna-view.jsx";

/* The bookmarklet shown in the page footer. Navigates to our own origin with
   the current page URL prefilled — no CORS, no API call (the form does the
   Supabase insert client-side). Drag to the bookmarks bar. */
const BOOKMARKLET = "javascript:(function(){window.open(location.origin+'/?capture=1&url='+encodeURIComponent(location.href),'_blank');})();";

function relTime(iso, now) {
  if (!iso) return "";
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return "";
    return formatDuration((now?.getTime?.() ?? Date.now()) - ts) + " ago";
  } catch { return ""; }
}

/* ---------- Capture form ---------- */
function CaptureForm({ prefill, onCapture }) {
  const [url, setUrl] = useState(prefill?.url || "");
  const [platform, setPlatform] = useState(prefill?.url ? platformFromUrl(prefill.url) : "ig");
  const [genes, setGenes] = useState([]);
  const [notes, setNotes] = useState("");
  const [touchedPlatform, setTouchedPlatform] = useState(false);

  // Auto-detect platform from the URL until the user overrides it.
  useEffect(() => {
    if (!touchedPlatform && url) setPlatform(platformFromUrl(url));
  }, [url, touchedPlatform]);

  // Re-seed if a new prefill arrives (e.g. a second share while the tab is open).
  useEffect(() => {
    if (prefill?.url) { setUrl(prefill.url); setTouchedPlatform(false); }
  }, [prefill?.nonce]);

  const toggleGene = (k) =>
    setGenes(g => g.includes(k) ? g.filter(x => x !== k) : [...g, k]);

  const canSubmit = url.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    // Parse a tag note (e.g. "location=Bali, music=phonk, font=Aktiv") into
    // structured gene fields + location so the row self-populates. Genes the
    // user picked via chips merge with genes the note mentioned. Unrecognized
    // text stays as the quick note.
    const parsed = parseTagNote(notes);
    const mergedGenes = [...new Set([...genes, ...parsed.genesOfInterest])];
    onCapture({
      reelUrl: url.trim(),
      platform,
      genesOfInterest: mergedGenes,
      quickNotes: parsed.leftover,
      location: parsed.location,
      ...parsed.fields,
      source: prefill?.url ? "share_target" : "manual",
    });
    setUrl(""); setGenes([]); setNotes(""); setTouchedPlatform(false);
  };

  return (
    <div className="rd-capture">
      <div className="rd-capture-row">
        <input
          className="rd-input"
          placeholder="Paste a reel URL…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
        />
        <div className="rd-platform-pick">
          {PLATFORMS.map(p => (
            <DPill key={p.key} active={platform === p.key}
                   onClick={() => { setPlatform(p.key); setTouchedPlatform(true); }}>
              {p.label}
            </DPill>
          ))}
        </div>
      </div>

      <div className="rd-genes-pick">
        <span className="rd-genes-label">Genes</span>
        {GENES.map(g => (
          <button key={g.key}
                  className={"rd-gene-chip" + (genes.includes(g.key) ? " is-on" : "")}
                  title={g.hint}
                  onClick={() => toggleGene(g.key)}>
            {g.label}
          </button>
        ))}
      </div>

      <textarea
        className="rd-notes"
        placeholder={"Quick notes — or tag it: location=Bali, music=phonk house, font=Aktiv Grotesk, sfx=whoosh @0:02"}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
      />
      <div className="rd-tag-hint mono dim">
        Tip: type <code>key=value</code> tags (location · music · font · sfx · story) and they auto-fill the columns + genes.
      </div>

      <div className="rd-capture-actions">
        <DPill primary solid onClick={submit} style={canSubmit ? undefined : { opacity: 0.5, pointerEvents: "none" }}>
          Capture
        </DPill>
      </div>
    </div>
  );
}

/* ---------- One gene's structured editor ---------- */
function GeneEditor({ gene, value, onChange }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });

  if (gene === "music") {
    return (
      <div className="rd-gene-fields">
        <input className="rd-input sm" placeholder="Track name" value={v.track || ""}
               onChange={e => set({ track: e.target.value })} />
        <input className="rd-input sm" placeholder="Link" value={v.link || ""}
               onChange={e => set({ link: e.target.value })} />
        <input className="rd-input sm" placeholder="Source (Spotify, original audio…)" value={v.source || ""}
               onChange={e => set({ source: e.target.value })} />
      </div>
    );
  }
  if (gene === "hook") {
    return (
      <div className="rd-gene-fields rd-gene-fields--row">
        <input className="rd-input sm" placeholder="Start (0:00)" value={v.startTs || ""}
               onChange={e => set({ startTs: e.target.value })} />
        <input className="rd-input sm" placeholder="End (0:03)" value={v.endTs || ""}
               onChange={e => set({ endTs: e.target.value })} />
        <input className="rd-input sm" placeholder="Download link" value={v.downloadLink || ""}
               onChange={e => set({ downloadLink: e.target.value })} />
      </div>
    );
  }
  if (gene === "font") {
    return (
      <div className="rd-gene-fields">
        <input className="rd-input sm" placeholder="Font names (comma-separated)" value={v.names || ""}
               onChange={e => set({ names: e.target.value })} />
        <input className="rd-input sm" placeholder="Links / download URLs" value={v.links || ""}
               onChange={e => set({ links: e.target.value })} />
      </div>
    );
  }
  // story + sfx are free-text notes
  const key = gene === "story" ? "styleNotes" : "notes";
  return (
    <textarea className="rd-notes sm"
              placeholder={gene === "story" ? "Structure / style (hook → buildup → payoff)…" : "SFX times + type (whoosh @ 0:02…)"}
              value={v[key] || ""} rows={2}
              onChange={e => set({ [key]: e.target.value })} />
  );
}

/* Merge a row's structured fields with anything still living as a tag note
   (e.g. an IG-DM row whose quickNotes holds "location=Bali, music=…"). Used by
   the spreadsheet so columns populate even before the note is promoted to real
   fields. Structured fields win; the parsed note fills gaps. Non-mutating. */
export function resolveTags(item) {
  const parsed = parseTagNote(item.quickNotes || "");
  return {
    location: item.location || parsed.location || "",
    music:    item.music?.track     || parsed.fields.music?.track      || "",
    font:     item.font?.names      || parsed.fields.font?.names       || "",
    sfx:      item.sfx?.notes       || parsed.fields.sfx?.notes        || "",
    story:    item.story?.styleNotes|| parsed.fields.story?.styleNotes || "",
  };
}

/* ---------- A captured reel card ---------- */
function DnaCard({ item, now, actions, onView, onDeconstruct }) {
  const [open, setOpen] = useState(false);
  const genes = item.genesOfInterest || [];
  const sourceTone = item.source === "ig_dm" ? "violet" : item.source === "share_target" ? "blue" : undefined;
  const hasTimeline = item.timeline && item.timeline.length > 0;
  const tags = resolveTags(item);

  const saveGene = (geneKey, val) => actions.updateReelDna(item.id, { [geneKey]: val });
  const setStatus = (s) => actions.updateReelDna(item.id, { status: s });

  return (
    <div className={"rd-card rd-status--" + item.status}>
      <div className="rd-card-head">
        <div className="rd-card-title rd-card-title--open"
             role="button" tabIndex={0}
             title="Open the DNA breakdown"
             onClick={() => onView(item)}
             onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onView(item); } }}>
          <a className="rd-card-url" href={item.reelUrl} target="_blank" rel="noreferrer"
             onClick={e => e.stopPropagation()}>
            {item.reelUrl}
          </a>
          <div className="rd-card-meta">
            <span className="rd-tag">{platformLabel(item.platform)}</span>
            {tags.location && <span className="rd-tag" style={{ color: "var(--c-amber)", borderColor: "var(--c-amber)" }}>📍 {tags.location}</span>}
            <span className={"rd-tag rd-source" + (sourceTone ? " rd-source--" + sourceTone : "")}>
              {sourceLabel(item.source)}
            </span>
            {item.capturedBy && <span className="rd-tag dim">{personName(item.capturedBy)}</span>}
            <span className="rd-tag dim">{relTime(item.createdAt, now)}</span>
            {hasTimeline && (
              <span className="rd-tag" style={{ color: "var(--c-cyan)", borderColor: "var(--c-cyan)" }}>
                {item.timeline.length} segments
              </span>
            )}
          </div>
        </div>
        <div className="rd-status-pick">
          {STATUSES.map(s => (
            <button key={s.key}
                    className={"rd-status-chip" + (item.status === s.key ? " is-on" : "")}
                    onClick={() => setStatus(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {genes.length > 0 && (
        <div className="rd-card-genes">
          {genes.map(g => <span key={g} className="rd-gene-tag">{geneLabel(g)}</span>)}
        </div>
      )}

      {item.quickNotes && <div className="rd-card-notes">{item.quickNotes}</div>}

      {open && (
        <div className="rd-editor">
          {(genes.length ? genes : GENE_KEYS).map(g => (
            <div key={g} className="rd-editor-block">
              <div className="rd-editor-label">{geneLabel(g)}</div>
              <GeneEditor gene={g} value={item[g]} onChange={(val) => saveGene(g, val)} />
            </div>
          ))}
        </div>
      )}

      <div className="rd-card-foot">
        <div className="rd-card-foot-left">
          <span className="rd-deconstruct" onClick={() => onView(item)}>
            View DNA
          </span>
          <span className="rd-collapse" onClick={() => setOpen(o => !o)}>
            {open ? "Hide genes" : "Edit genes"}
          </span>
          <span className="rd-deconstruct" onClick={() => onDeconstruct(item)}>
            {hasTimeline ? `Timeline (${item.timeline.length})` : "Deconstruct"}
          </span>
        </div>
        <span className="rd-archive" onClick={() => actions.archiveReelDna(item.id)}>Archive</span>
      </div>
    </div>
  );
}

/* ---------- Inline-editable spreadsheet cell ---------- */
function EditableCell({ value, placeholder, onSave }) {
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const commit = () => { const next = v.trim(); if (next !== (value || "")) onSave(next); };
  return (
    <input
      className="rd-cell-input"
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setV(value || ""); requestAnimationFrame(() => e.target.blur()); }
      }}
    />
  );
}

/* ---------- Spreadsheet / log view ---------- */
function DnaTable({ items, now, actions, onView, onDeconstruct }) {
  // Promote a parsed-on-read tag value to a real structured field on edit, so a
  // note-derived column becomes a first-class field once the user touches it.
  const saveLocation = (item, val) => actions.updateReelDna(item.id, { location: val || null });
  const saveGeneField = (item, geneKey, subKey, val) =>
    actions.updateReelDna(item.id, { [geneKey]: { ...(item[geneKey] || {}), [subKey]: val } });

  return (
    <div className="rd-table-wrap">
      <table className="rd-table">
        <thead>
          <tr>
            <th className="rd-th-reel">Reel</th>
            <th>Location</th>
            <th>Music</th>
            <th>Font</th>
            <th>SFX</th>
            <th>Story / Pacing</th>
            <th>Source</th>
            <th>Status</th>
            <th className="rd-th-act"></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const tags = resolveTags(item);
            const sourceTone = item.source === "ig_dm" ? "violet" : item.source === "share_target" ? "blue" : undefined;
            const hasTimeline = item.timeline && item.timeline.length > 0;
            return (
              <tr key={item.id} className={"rd-tr rd-status--" + item.status}>
                <td className="rd-td-reel">
                  <a className="rd-cell-link" href={item.reelUrl} target="_blank" rel="noreferrer" title={item.reelUrl}>
                    {item.reelUrl}
                  </a>
                  <div className="rd-cell-sub">
                    <span className="rd-tag sm">{platformLabel(item.platform)}</span>
                    <span className="rd-tag sm dim">{relTime(item.createdAt, now)}</span>
                  </div>
                </td>
                <td><EditableCell value={tags.location} placeholder="—" onSave={v => saveLocation(item, v)} /></td>
                <td><EditableCell value={tags.music} placeholder="—" onSave={v => saveGeneField(item, "music", "track", v)} /></td>
                <td><EditableCell value={tags.font} placeholder="—" onSave={v => saveGeneField(item, "font", "names", v)} /></td>
                <td><EditableCell value={tags.sfx} placeholder="—" onSave={v => saveGeneField(item, "sfx", "notes", v)} /></td>
                <td><EditableCell value={tags.story} placeholder="—" onSave={v => saveGeneField(item, "story", "styleNotes", v)} /></td>
                <td>
                  <span className={"rd-tag sm rd-source" + (sourceTone ? " rd-source--" + sourceTone : "")}>
                    {sourceLabel(item.source)}
                  </span>
                </td>
                <td>
                  <select className="rd-cell-status" value={item.status}
                          onChange={e => actions.updateReelDna(item.id, { status: e.target.value })}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                <td className="rd-td-act">
                  <button className="rd-row-btn" title="Open the visual DNA breakdown" onClick={() => onView(item)}>DNA</button>
                  <button className="rd-row-btn" title={hasTimeline ? "Edit timeline" : "Build timeline"} onClick={() => onDeconstruct(item)}>
                    {hasTimeline ? `▦ ${item.timeline.length}` : "▦"}
                  </button>
                  <button className="rd-row-btn rd-row-btn--archive" title="Archive" onClick={() => actions.archiveReelDna(item.id)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Page ---------- */
export function ReelDna({ prefill }) {
  const { reelDna, actions, error } = useWorkflow();
  const { person: me } = useAuth();
  const now = useNow();

  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // cards | table
  // Page-level overlay state so both cards AND table rows open the same
  // ReelDnaView / ReelDeconstructor. Keyed by id so realtime edits flow in.
  const [active, setActive] = useState(null); // { id, mode: "view" | "deconstruct" }

  const onCapture = (payload) =>
    actions.createReelDnaCapture({ ...payload, capturedBy: me?.id || null });

  const onView = (item) => setActive({ id: item.id, mode: "view" });
  const onDeconstruct = (item) => setActive({ id: item.id, mode: "deconstruct" });
  const closeOverlay = () => setActive(null);

  const visible = useMemo(() => {
    return (reelDna || [])
      .filter(d => showArchived ? !!d.archivedAt : !d.archivedAt)
      .filter(d => statusFilter === "all" || d.status === statusFilter)
      .filter(d => sourceFilter === "all" || d.source === sourceFilter);
  }, [reelDna, statusFilter, sourceFilter, showArchived]);

  const activeItem = useMemo(
    () => (active ? (reelDna || []).find(d => d.id === active.id) || null : null),
    [active, reelDna]
  );

  const counts = useMemo(() => {
    const live = (reelDna || []).filter(d => !d.archivedAt);
    return {
      total: live.length,
      archived: (reelDna || []).length - live.length,
      byStatus: STATUSES.reduce((acc, s) => {
        acc[s.key] = live.filter(d => d.status === s.key).length; return acc;
      }, {}),
    };
  }, [reelDna]);

  return (
    <div className="reel-dna">
      <div className="page-head">
        <div className="titles">
          <h1>Reel DNA</h1>
          <div className="sub">Capture reels you like and break them into their genes — music, font, hook, SFX, story.</div>
        </div>
        <div className="actions">
          <span className="mono dim" style={{ alignSelf: "center" }}>{counts.total} captured · realtime · live</span>
        </div>
      </div>

      {error && <div className="rd-error">error · {error}</div>}

      <div className="rd-body">
        <Card title="Capture a reel" defaultOpen={true}
              footLeft="Paste a link, pick the genes you care about, add a note.">
          <CaptureForm prefill={prefill} onCapture={onCapture} />
        </Card>

        <div className="rd-filterbar">
          <span className="mono dim">status</span>
          <DPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</DPill>
          {STATUSES.map(s => (
            <DPill key={s.key} active={statusFilter === s.key} onClick={() => setStatusFilter(s.key)}>
              {s.label}{counts.byStatus[s.key] ? " · " + counts.byStatus[s.key] : ""}
            </DPill>
          ))}
          <span style={{ width: 12 }} />
          <span className="mono dim">source</span>
          <DPill active={sourceFilter === "all"} onClick={() => setSourceFilter("all")}>All</DPill>
          {SOURCES.map(s => (
            <DPill key={s.key} active={sourceFilter === s.key} onClick={() => setSourceFilter(s.key)}>
              {s.label}
            </DPill>
          ))}
          <span style={{ flex: 1 }} />
          <span className="mono dim">view</span>
          <DPill active={viewMode === "cards"} onClick={() => setViewMode("cards")}>Cards</DPill>
          <DPill active={viewMode === "table"} onClick={() => setViewMode("table")}>Spreadsheet</DPill>
          <span style={{ width: 12 }} />
          <DPill active={showArchived} onClick={() => setShowArchived(a => !a)}>
            {showArchived ? "Archived" : "Live"}{counts.archived ? " · " + counts.archived : ""}
          </DPill>
        </div>

        {visible.length === 0 ? (
          <div className="rd-empty">
            {showArchived
              ? "No archived reels."
              : "No reels captured yet — paste a URL above to start your reel genome."}
          </div>
        ) : viewMode === "table" ? (
          <DnaTable items={visible} now={now} actions={actions}
                    onView={onView} onDeconstruct={onDeconstruct} />
        ) : (
          <div className="rd-grid">
            {visible.map(item => (
              <DnaCard key={item.id} item={item} now={now} actions={actions}
                       onView={onView} onDeconstruct={onDeconstruct} />
            ))}
          </div>
        )}

        <div className="rd-bookmarklet">
          <span className="mono dim">Quick-capture:</span>
          <a className="rd-bm-link" href={BOOKMARKLET}
             onClick={e => e.preventDefault()}
             title="Drag this to your bookmarks bar, then click it on any reel page">
            + Reel DNA
          </a>
          <span className="mono dim">drag to your bookmarks bar, then click it on any reel.</span>
        </div>
      </div>

      {/* Page-level overlays — opened from either a card or a spreadsheet row.
          Resolved from the live reelDna list by id so realtime edits flow in. */}
      {activeItem && active.mode === "view" && (
        <ReelDnaView
          item={activeItem}
          onClose={closeOverlay}
          onDeconstruct={() => setActive({ id: activeItem.id, mode: "deconstruct" })}
        />
      )}
      {activeItem && active.mode === "deconstruct" && (
        <ReelDeconstructor
          item={activeItem}
          onClose={closeOverlay}
          onSave={(segments) => actions.updateReelDna(activeItem.id, { timeline: segments })}
        />
      )}
    </div>
  );
}
