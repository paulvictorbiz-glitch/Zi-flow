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
  platformFromUrl, parseTagNote, resolveBrief,
} from "../lib/reel-dna.jsx";
import { ReelDeconstructor } from "./reel-deconstructor.jsx";
import { ReelDnaView } from "../components/reel-dna-view.jsx";
import { ThumbnailDna } from "./thumbnail-dna.jsx";
import { ReelDnaComprehensive } from "../components/reel-dna-comprehensive.jsx";
import { ReelAssetsPanel } from "../components/reel-assets-panel.jsx";
import { UnifiedDnaCard } from "../components/unified-dna-card.jsx";
import { ReelAssetsPage } from "./reel-assets-page.jsx";
import { useReelDnaAssets } from "../lib/reel-dna-assets.jsx";
import {
  RD_TEXT_COLUMNS, RD_SELECT_COLUMNS,
  emptyColumnFilters, hasActiveColumnFilters, applyColumnFilters,
} from "../lib/reel-dna-filters.jsx";

/* The bookmarklet shown in the page footer. Navigates to our own origin with
   the current page URL prefilled — no CORS, no API call (the form does the
   Supabase insert client-side). Drag to the bookmarks bar. */
const BOOKMARKLET = "javascript:(function(){window.open(location.origin+'/?capture=1&url='+encodeURIComponent(location.href),'_blank');})();";

/* Classic ⇄ Comprehensive view choice, persisted across reloads. */
const DNA_VIEW_KEY = "reel_dna_view";
function loadDnaView() {
  try { return localStorage.getItem(DNA_VIEW_KEY) === "comprehensive" ? "comprehensive" : "classic"; }
  catch { return "classic"; }
}

export function relTime(iso, now) {
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
export function GeneEditor({ gene, value, onChange }) {
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

/* The card's "production brief" — the location + gene fields logged on the reel,
   shown as labelled lines whose wording matches the pipeline reel fields an
   editor edits (so "Send to Pipeline" carries straight over). Renders nothing
   when the reel has no tagged fields yet. */
export function BriefBlock({ item }) {
  const b = resolveBrief(item);
  const rows = [];
  if (b.location) rows.push(["Location", b.location]);
  const music = [b.musicTrack, b.musicSource, b.musicLink].filter(Boolean).join(" · ");
  if (music) rows.push(["Music", music]);
  const font = [b.fontNames, b.fontLinks].filter(Boolean).join(" · ");
  if (font) rows.push(["Font", font]);
  if (b.sfx) rows.push(["SFX", b.sfx]);
  if (b.story) rows.push(["Story", b.story]);
  const hook = [
    b.hookStart && b.hookEnd ? `${b.hookStart}–${b.hookEnd}` : (b.hookStart || b.hookEnd),
    b.hookLink,
  ].filter(Boolean).join(" · ");
  if (hook) rows.push(["Hook", hook]);
  if (b.leftover) rows.push(["Note", b.leftover]);
  if (!rows.length) return null;
  return (
    <div className="rd-brief">
      {rows.map(([k, v]) => (
        <div key={k} className="rd-brief-row">
          <span className="rd-brief-key">{k}</span>
          <span className="rd-brief-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- A captured reel card ---------- */
export function DnaCard({ item, now, actions, onView, onDeconstruct, onSend, onDelete, onOpenAssets, isOwner }) {
  const [open, setOpen] = useState(false);
  const genes = item.genesOfInterest || [];
  const sourceTone = item.source === "ig_dm" ? "violet" : item.source === "share_target" ? "blue" : undefined;
  const hasTimeline = item.timeline && item.timeline.length > 0;
  const tags = resolveTags(item);
  const { assets, counts } = useReelDnaAssets(item.id);

  const saveGene = (geneKey, val) => actions.updateReelDna(item.id, { [geneKey]: val });
  const setStatus = (s) => actions.updateReelDna(item.id, { status: s });

  return (
    <div className={"rd-card rd-status--" + item.status}>
      <div className="rd-card-main">
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

      <BriefBlock item={item} />

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
          {item.reelId ? (
            <span className="rd-tag" style={{ color: "var(--c-green)", borderColor: "var(--c-green)" }}>
              ▸ In pipeline · {item.reelId}
            </span>
          ) : (
            <span className="rd-send" onClick={() => onSend(item)}>→ Send to Pipeline</span>
          )}
        </div>
        <div className="rd-card-foot-right">
          <span className="rd-archive" onClick={() => actions.archiveReelDna(item.id)}>Archive</span>
          <span className="rd-delete" onClick={() => onDelete(item)}>Delete</span>
        </div>
      </div>
      </div>

      <ReelAssetsPanel
        item={item}
        assets={assets}
        counts={counts}
        isOwner={isOwner}
        actions={actions}
        onOpenFull={onOpenAssets}
      />
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

/* ---------- Column-filter header row (Classic spreadsheet) ----------
   Controlled: `colFilters` + `onColFilter(key, value)` come from the page.
   A text <input> per text column, a <select> per select column, and a
   clear-all affordance in the actions cell. Stops row clicks from sorting. */
function ColumnFilterRow({ colFilters, onColFilter, onClear }) {
  const sel = (key) => RD_SELECT_COLUMNS.find((c) => c.key === key);
  const TextCell = ({ k }) => (
    <td className="rd-colfilter-td">
      <input
        className="rd-colfilter-input"
        value={colFilters[k] || ""}
        placeholder="filter…"
        onChange={(e) => onColFilter(k, e.target.value)}
      />
    </td>
  );
  const SelectCell = ({ k }) => {
    const c = sel(k);
    return (
      <td className="rd-colfilter-td">
        <select className="rd-colfilter-select" value={colFilters[k] || "all"}
                onChange={(e) => onColFilter(k, e.target.value)}>
          <option value="all">All</option>
          {c.options.map((o) => <option key={o.key} value={o.key}>{c.labelFn(o.key)}</option>)}
        </select>
      </td>
    );
  };
  return (
    <tr className="rd-colfilter-row">
      <TextCell k="reel" />
      <TextCell k="location" />
      <TextCell k="music" />
      <TextCell k="font" />
      <TextCell k="sfx" />
      <TextCell k="story" />
      <SelectCell k="source" />
      <SelectCell k="status" />
      <td className="rd-colfilter-td" />
      <td className="rd-colfilter-td rd-colfilter-clear-td">
        <button type="button" className="rd-colfilter-clear" title="Clear column filters" onClick={onClear}>✕</button>
      </td>
    </tr>
  );
}

/* A single spreadsheet Assets cell — a count badge that opens the full-screen
   assets page for the row. The hook is called per-row (a component, so the
   call is unconditional and hook-rules-safe). */
function AssetCountCell({ item, onOpen }) {
  const { counts } = useReelDnaAssets(item.id);
  return (
    <td className="rd-td-assets">
      <button className="rd-row-btn" title="View assets" onClick={() => onOpen?.(item)}>
        ▣ {counts?.total ?? 0}
      </button>
    </td>
  );
}

/* ---------- Spreadsheet / log view ---------- */
export function DnaTable({ items, now, actions, onView, onDeconstruct, onSend, onDelete,
                          onOpenAssets, colFilters, onColFilter, onClearColFilters }) {
  // Promote a parsed-on-read tag value to a real structured field on edit, so a
  // note-derived column becomes a first-class field once the user touches it.
  const saveLocation = (item, val) => actions.updateReelDna(item.id, { location: val || null });
  const saveGeneField = (item, geneKey, subKey, val) =>
    actions.updateReelDna(item.id, { [geneKey]: { ...(item[geneKey] || {}), [subKey]: val } });

  const showFilters = !!colFilters && !!onColFilter;

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
            <th className="rd-th-assets">Assets</th>
            <th className="rd-th-act"></th>
          </tr>
          {showFilters && (
            <ColumnFilterRow colFilters={colFilters} onColFilter={onColFilter} onClear={onClearColFilters} />
          )}
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
                <AssetCountCell item={item} onOpen={onOpenAssets} />
                <td className="rd-td-act">
                  <button className="rd-row-btn" title="Open the visual DNA breakdown" onClick={() => onView(item)}>DNA</button>
                  <button className="rd-row-btn" title={hasTimeline ? "Edit timeline" : "Build timeline"} onClick={() => onDeconstruct(item)}>
                    {hasTimeline ? `▦ ${item.timeline.length}` : "▦"}
                  </button>
                  {item.reelId ? (
                    <span className="rd-row-btn rd-row-btn--linked" title={"In pipeline · " + item.reelId}>▸ {item.reelId}</span>
                  ) : (
                    <button className="rd-row-btn rd-row-btn--send" title="Create a pipeline reel from this card" onClick={() => onSend(item)}>→ Pipeline</button>
                  )}
                  <button className="rd-row-btn rd-row-btn--archive" title="Archive" onClick={() => actions.archiveReelDna(item.id)}>⧉</button>
                  <button className="rd-row-btn rd-row-btn--delete" title="Delete permanently" onClick={() => onDelete(item)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Full-screen Assets takeover wrapper. Calls the integration hook in a
   component context (never conditionally) and feeds the pure ReelAssetsPage. */
function AssetsPageContainer({ item, onBack, isOwner, actions }) {
  const { assets, counts } = useReelDnaAssets(item.id);
  return (
    <ReelAssetsPage
      item={item}
      assets={assets}
      counts={counts}
      onBack={onBack}
      isOwner={isOwner}
      actions={actions}
    />
  );
}

/* ---------- Page ---------- */
export function ReelDna({ prefill }) {
  const { reelDna, actions, error, unifiedCards } = useWorkflow();
  const { person: me } = useAuth();
  const isOwner = me?.role === "owner";
  // Owner feature flag: swap the card-grid renderer. Default (off) = legacy DnaCard.
  const DnaCardComponent = unifiedCards ? UnifiedDnaCard : DnaCard;
  const now = useNow();

  const [tab, setTab] = useState("reels"); // reels | thumbnails
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // cards | table
  // Classic ⇄ Comprehensive top-level view (persisted, like the Pulse toggle).
  const [dnaView, setDnaView] = useState(loadDnaView); // classic | comprehensive
  const setView = (v) => {
    const next = v === "comprehensive" ? "comprehensive" : "classic";
    setDnaView(next);
    try { localStorage.setItem(DNA_VIEW_KEY, next); } catch (_) {}
  };
  // Per-column filters for the Classic spreadsheet.
  const [colFilters, setColFilters] = useState(emptyColumnFilters);
  const onColFilter = (key, value) => setColFilters((f) => ({ ...f, [key]: value }));
  const clearColFilters = () => setColFilters(emptyColumnFilters());
  // Page-level overlay state so both cards AND table rows open the same
  // ReelDnaView / ReelDeconstructor. Keyed by id so realtime edits flow in.
  const [active, setActive] = useState(null); // { id, mode: "view" | "deconstruct" }
  // Full-screen Assets page state — resolved from live reelDna by id (like active).
  const [assetsId, setAssetsId] = useState(null);

  const onCapture = (payload) =>
    actions.createReelDnaCapture({ ...payload, capturedBy: me?.id || null });

  const onView = (item) => setActive({ id: item.id, mode: "view" });
  const onDeconstruct = (item) => setActive({ id: item.id, mode: "deconstruct" });
  const closeOverlay = () => setActive(null);

  // Refresh: force the Hetzner IG poller to run now, then reload from Supabase.
  // Freshly-pulled rows also arrive via realtime, but we re-poll a couple of
  // times because that poll takes a few seconds to finish on the backend.
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: "ok"|"err", text }
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      let igMsg = "";
      try {
        const r = await actions.triggerIgSync();
        if (r?.demo) igMsg = "(demo — no live pull) ";
      } catch (e) {
        igMsg = "Instagram pull couldn't start (" + (e.message || "error") + ") — reloaded anyway. ";
      }
      const n = await actions.reloadReelDna();
      // The just-started poll finishes server-side a few seconds later; pull the
      // new rows in without making the user click again.
      setTimeout(() => { actions.reloadReelDna().catch(() => {}); }, 7000);
      setTimeout(() => { actions.reloadReelDna().catch(() => {}); }, 16000);
      setNotice({ tone: "ok", text: `${igMsg}Reloaded — ${n} reels. New IG DMs appear within a few seconds.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Refresh failed · " + (e.message || String(e)) });
    } finally {
      setRefreshing(false);
    }
  };

  // No confirm dialog — Paul wanted to mass-delete quickly. Archive (restorable)
  // stays the safe option; Delete is the permanent one.
  const handleDelete = (item) => actions.deleteReelDna(item.id);

  const handleSend = (item) => {
    if (item.reelId) { setNotice({ tone: "ok", text: `Already in the pipeline as ${item.reelId}.` }); return; }
    try {
      const newId = actions.sendReelDnaToPipeline(item.id, { owner: me?.id });
      setNotice({ tone: "ok", text: `Added to the pipeline as ${newId} — open the Pipeline tab to edit it.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Couldn't add to pipeline · " + (e.message || String(e)) });
    }
  };

  // Archived-respecting base pool — feeds both the Classic pill/column
  // filters and the Comprehensive facet rail.
  const baseList = useMemo(() => (
    (reelDna || []).filter(d => showArchived ? !!d.archivedAt : !d.archivedAt)
  ), [reelDna, showArchived]);

  // Classic visible list: pill filters + per-column filters.
  const visible = useMemo(() => {
    const byPill = baseList
      .filter(d => statusFilter === "all" || d.status === statusFilter)
      .filter(d => sourceFilter === "all" || d.source === sourceFilter);
    return applyColumnFilters(byPill, colFilters);
  }, [baseList, statusFilter, sourceFilter, colFilters]);

  const activeItem = useMemo(
    () => (active ? (reelDna || []).find(d => d.id === active.id) || null : null),
    [active, reelDna]
  );

  const assetsItem = useMemo(
    () => (assetsId ? (reelDna || []).find(d => d.id === assetsId) || null : null),
    [assetsId, reelDna]
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

  // Full-screen Assets takeover — replaces the page body while open.
  if (assetsItem) {
    return (
      <div className="reel-dna">
        <AssetsPageContainer
          item={assetsItem}
          onBack={() => setAssetsId(null)}
          isOwner={isOwner}
          actions={actions}
        />
      </div>
    );
  }

  return (
    <div className="reel-dna">
      <div className="page-head">
        <div className="titles">
          <h1>Reel DNA</h1>
          <div className="sub">Capture reels you like and break them into their genes — music, font, hook, SFX, story.</div>
        </div>
        <div className="actions">
          <div className="rd-tabs">
            <DPill active={tab === "reels"} onClick={() => setTab("reels")}>Reels</DPill>
            <DPill active={tab === "thumbnails"} onClick={() => setTab("thumbnails")}>Thumbnails</DPill>
          </div>
          {tab === "reels" && (
            <>
              <span className="mono dim" style={{ alignSelf: "center" }}>{counts.total} captured · realtime · live</span>
              <DPill primary onClick={handleRefresh}
                     style={refreshing ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </DPill>
            </>
          )}
        </div>
      </div>

      {tab === "thumbnails" ? (
        <ThumbnailDna />
      ) : (
      <>
      {error && <div className="rd-error">error · {error}</div>}
      {notice && (
        <div className={"rd-notice rd-notice--" + notice.tone} onClick={() => setNotice(null)} title="Dismiss">
          {notice.text}
        </div>
      )}

      <div className="rd-body">
        <Card title="Capture a reel" defaultOpen={true}
              footLeft="Paste a link, pick the genes you care about, add a note.">
          <CaptureForm prefill={prefill} onCapture={onCapture} />
        </Card>

        <div className="rd-filterbar">
          {/* Classic ⇄ Comprehensive view toggle */}
          <div className="rd-viewtoggle" role="group" aria-label="Reel DNA view">
            <button type="button" className={"rd-viewtoggle-btn" + (dnaView === "classic" ? " is-on" : "")}
                    aria-pressed={dnaView === "classic"} onClick={() => setView("classic")}>Classic</button>
            <button type="button" className={"rd-viewtoggle-btn" + (dnaView === "comprehensive" ? " is-on" : "")}
                    aria-pressed={dnaView === "comprehensive"} onClick={() => setView("comprehensive")}>Comprehensive</button>
          </div>
          <span style={{ width: 12 }} />

          {dnaView === "classic" && (
            <>
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
            </>
          )}
          <span style={{ flex: 1 }} />
          <DPill active={tab === "thumbnails"} onClick={() => setTab("thumbnails")}>Thumbnails</DPill>
          <span style={{ width: 12 }} />
          {dnaView === "classic" && (
            <>
              <span className="mono dim">view</span>
              <DPill active={viewMode === "cards"} onClick={() => setViewMode("cards")}>Cards</DPill>
              <DPill active={viewMode === "table"} onClick={() => setViewMode("table")}>Spreadsheet</DPill>
              <span style={{ width: 12 }} />
            </>
          )}
          <DPill active={showArchived} onClick={() => setShowArchived(a => !a)}>
            {showArchived ? "Archived" : "Live"}{counts.archived ? " · " + counts.archived : ""}
          </DPill>
        </div>

        {dnaView === "comprehensive" ? (
          baseList.length === 0 ? (
            <div className="rd-empty">
              {showArchived ? "No archived reels." : "No reels captured yet — paste a URL above to start your reel genome."}
            </div>
          ) : (
            <ReelDnaComprehensive items={baseList} now={now} actions={actions}
                                  onView={onView} onDeconstruct={onDeconstruct}
                                  onSend={handleSend} onDelete={handleDelete} />
          )
        ) : visible.length === 0 ? (
          <div className="rd-empty">
            {hasActiveColumnFilters(colFilters)
              ? "No reels match the active column filters."
              : showArchived
                ? "No archived reels."
                : "No reels captured yet — paste a URL above to start your reel genome."}
          </div>
        ) : viewMode === "table" ? (
          <DnaTable items={visible} now={now} actions={actions}
                    onView={onView} onDeconstruct={onDeconstruct}
                    onSend={handleSend} onDelete={handleDelete}
                    onOpenAssets={(it) => setAssetsId(it.id)}
                    colFilters={colFilters} onColFilter={onColFilter} onClearColFilters={clearColFilters} />
        ) : (
          <div className="rd-grid">
            {visible.map(item => (
              <DnaCardComponent key={item.id} item={item} now={now} actions={actions}
                       onView={onView} onDeconstruct={onDeconstruct}
                       onSend={handleSend} onDelete={handleDelete}
                       onOpenAssets={(it) => setAssetsId(it.id)} isOwner={isOwner} />
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
      </>
      )}
    </div>
  );
}
