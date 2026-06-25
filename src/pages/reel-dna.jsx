/* =========================================================
   Reel DNA — Phase 1 capture library.
   Solarin theme hooks injected below (SOL_DNA_CSS). */

const SOL_DNA_CSS = `
[data-theme="solarin"] .dna-wrap {
  max-width: none; margin: 0; padding: 20px 16px; box-sizing: border-box;
}
[data-theme="solarin"] .dna-capture-panel {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); padding: 18px 20px; margin-bottom: 16px;
}
[data-theme="solarin"] .dna-table-panel {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px);
}
[data-theme="solarin"] .dna-table-head-row {
  background: var(--s-inner-dark);
  border-bottom: 1px solid var(--s-divider);
}
[data-theme="solarin"] .dna-th {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: var(--peach);
  padding: 10px 12px;
}
[data-theme="solarin"] .dna-row {
  border-bottom: 1px solid var(--s-divider-soft);
}
[data-theme="solarin"] .dna-row:nth-child(even) { background: rgba(40,30,42,.4); }
[data-theme="solarin"] .dna-cell {
  font-family: var(--f-ui); font-size: 12.5px; color: var(--s-fg-body);
  padding: 10px 12px;
}
[data-theme="solarin"] .dna-empty { color: var(--s-fg-dash); }
[data-theme="solarin"] .dna-source-chip {
  font-family: var(--f-label); font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
  background: rgba(159,237,215,.12); color: var(--mint);
  border: 1px solid rgba(159,237,215,.3); padding: 2px 8px;
}
[data-theme="solarin"] .dna-status-captured { color: var(--mint); font-family: var(--f-label); font-size: 11px; }
[data-theme="solarin"] .dna-status-progress  { color: var(--peach); font-family: var(--f-label); font-size: 11px; }
`;

/* =========================================================
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
import { createPortal } from "react-dom";
import "./reel-dna.css";
import { Card, DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { useNow, formatDuration } from "../lib/time.jsx";
import {
  GENES, PLATFORMS, STATUSES,
  platformLabel,
  platformFromUrl, parseTagNote, resolveBrief,
} from "../lib/reel-dna.jsx";
import { ReelDeconstructor } from "./reel-deconstructor.jsx";
import { ReelDnaView } from "../components/reel-dna-view.jsx";
import { ReelCompareModal } from "../components/ReelCompareModal.jsx";
import { ThumbnailDna } from "./thumbnail-dna.jsx";
import { ReelDnaComprehensive } from "../components/reel-dna-comprehensive.jsx";
import { ReelAssetsPage } from "./reel-assets-page.jsx";
import { useReelDnaAssets } from "../lib/reel-dna-assets.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import { ROLES } from "../lib/shared-data.jsx";
// RD_SELECT_COLUMNS feeds ColumnFilterRow's select dropdowns. The other filter
// helpers (column + facet) now live inside ReelDnaComprehensive. RD_COLUMNS +
// makeColVisibility drive the per-column hide/show (Feature A).
import { RD_SELECT_COLUMNS, RD_TEXT_COLUMNS, RD_COLUMNS, makeColVisibility } from "../lib/reel-dna-filters.jsx";

/* The text-column filter keys (location, music, font, sfx, story, notes, reel) —
   used by DnaTable's FILTER-ON-HIDDEN auto-clear to reset a per-column text
   filter when its column is hidden. The `status` select clears separately. */
const RD_TEXT_COLUMN_KEYS = RD_TEXT_COLUMNS.map((c) => c.key);

/* The bookmarklet shown in the page footer. Navigates to our own origin with
   the current page URL prefilled — no CORS, no API call (the form does the
   Supabase insert client-side). Drag to the bookmarks bar. */
const BOOKMARKLET = "javascript:(function(){window.open(location.origin+'/?capture=1&url='+encodeURIComponent(location.href),'_blank');})();";

export function relTime(iso, now) {
  if (!iso) return "";
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return "";
    return formatDuration((now?.getTime?.() ?? Date.now()) - ts) + " ago";
  } catch { return ""; }
}

/* Plain-language meaning + transient/actionable class for each poller issue
   type (DNA-018 — "logs show errors, fix these"). `transient:true` = expected /
   self-healing (Instagram API limits, non-reel messages) that the next sync
   retries — NOT something the owner must act on; `transient:false` = a real
   failure worth a closer look. Unknown types fall back to actionable so a new
   error kind is never silently dismissed. */
const IG_ISSUE_INFO = {
  graph_error:  { label: "IG API error",  transient: true,  hint: "Instagram's API rate-limited or 500'd this thread — transient; the next sync retries it. Not a data-loss bug on our side." },
  message_skip: { label: "skipped",       transient: true,  hint: "A message carried no shareable reel link (text / sticker / non-reel) — nothing to capture." },
  unfulfilled:  { label: "unresolved",    transient: true,  hint: "A share couldn't be resolved to a reel URL this run — usually fills in on a later sync." },
  insert_error: { label: "save failed",   transient: false, hint: "A row failed to write to the database — this one is worth a closer look (re-run Refresh; if it persists, flag it)." },
  stale_cookie: { label: "login expired", transient: false, hint: "Instagram's session cookie expired — reconnect Instagram so the poller can read DMs again." },
};
const igIssueInfo = (type) => IG_ISSUE_INFO[type] || { label: type || "unknown", transient: false, hint: "Unrecognized issue type — review the detail below." };

/* ---------- IG Sync Health strip ----------
   A quiet presentational summary of the latest IG poller run. Reconciliation:
   green "Reconciled" only when run.reconciled === true; red banner (grouped
   issue counts) only when run.reconciled === false; an AMBER caveat shows
   whenever a Graph cap may have been hit or graphErrors > 0 — even on green,
   because green must never imply complete coverage. Everything is guarded so a
   missing field or empty array can never crash the page. */
function IgSyncHealth({ runs, log, igDmCount, open, onToggle }) {
  const list = Array.isArray(runs) ? runs : [];
  const run = list[0] || null;

  if (!run) {
    return (
      <div className="rd-igsync rd-igsync--empty">
        <span className="rd-igsync-title">IG Sync Health</span>
        <span className="rd-igsync-muted">No syncs recorded yet — click “🔎 Check IG Sync”.</span>
      </div>
    );
  }

  const seen = run.sharesSeen ?? 0;
  const accounted = (run.inserted ?? 0) + (run.dedupeSkip ?? 0);
  const when = relTime(run.finishedAt || run.startedAt, new Date());

  const capHit = (run.conversations ?? 0) >= 40 || (run.messagesSeen ?? 0) >= 50;
  const graphErr = (run.graphErrors ?? 0) > 0;
  const incomplete = capHit || graphErr;

  // The latest run's per-message issues (shown in the report regardless of
  // reconciled — graph errors etc. matter even when the count balances).
  const runLog = (Array.isArray(log) ? log : []).filter(l => l && l.runId === run.id);

  return (
    <div className="rd-igsync">
      <span className="rd-igsync-title">IG Sync Health</span>
      <span className="rd-igsync-muted">
        Last sync {when || "—"} · {run.trigger || "—"} — seen {seen}, accounted {accounted}
      </span>
      {run.reconciled === true && <span className="rd-igsync-ok">Reconciled</span>}
      {run.reconciled === false && (
        <span className="rd-igsync-bad">Mismatch · {run.mismatchCount ?? 0}</span>
      )}
      <button type="button" className="rd-igsync-toggle" onClick={onToggle}>
        {open ? "▾ Hide report" : "▸ Show report"}
      </button>

      {incomplete && (
        <div className="rd-igsync-banner rd-igsync-banner--amber" style={{ width: "100%" }}>
          coverage may be incomplete — Graph limits hit{graphErr ? ` · ${run.graphErrors} graph errors` : ""}.
          Reconciled means “captured everything we saw this run”, not “everything that exists”.
        </div>
      )}

      {open && (
        <div className="rd-igsync-report" style={{ width: "100%" }}>
          <div className="rd-igsync-report-grid">
            <div className="rd-igsync-card">
              <b>What landed in the spreadsheet</b>
              <div>New rows this run: <span className="mono">{run.inserted ?? 0}</span></div>
              <div>Already captured (deduped): <span className="mono">{run.dedupeSkip ?? 0}</span></div>
              <div>Shares the API showed us: <span className="mono">{seen}</span></div>
              <div>Total IG-DM rows in sheet: <span className="mono">{igDmCount ?? "—"}</span></div>
            </div>
            <div className="rd-igsync-card">
              <b>Coverage this run</b>
              <div>Conversations scanned: <span className="mono">{run.conversations ?? 0}</span></div>
              <div>Messages examined: <span className="mono">{run.messagesSeen ?? 0}</span></div>
              <div>Skipped (no link): <span className="mono">{run.skippedNoLink ?? 0}</span></div>
              <div>Graph API errors: <span className="mono">{run.graphErrors ?? 0}</span></div>
              <div>Insert errors: <span className="mono">{run.insertError ?? 0}</span></div>
            </div>
          </div>

          <div className="rd-igsync-report-issues">
            <b>Errors / issues this run ({runLog.length})</b>
            {runLog.length === 0 ? (
              <div className="rd-igsync-muted">No errors logged for the latest run. 🎉</div>
            ) : (() => {
              const actionable = runLog.filter(l => !igIssueInfo(l.issueType).transient).length;
              const transient = runLog.length - actionable;
              return (
                <>
                  <div className="rd-igsync-muted" style={{ marginBottom: 6 }}>
                    {actionable === 0
                      ? `All ${transient} expected / self-healing (Instagram API limits or non-reel messages) — they retry on the next sync, nothing to fix.`
                      : `${actionable} need attention · ${transient} expected / auto-retried.`}
                  </div>
                  {runLog.map(l => {
                    const info = igIssueInfo(l.issueType);
                    return (
                      <div key={l.id} className="rd-igsync-issue">
                        <span className={"rd-tag sm rd-issue rd-issue-" + (l.issueType || "unknown")} title={info.hint}>
                          {info.label}
                        </span>
                        <span
                          className="rd-tag sm"
                          title={info.hint}
                          style={{
                            color: info.transient ? "var(--fg-dim)" : "var(--c-red)",
                            borderColor: info.transient ? "var(--line-hard)" : "var(--c-red-soft)",
                          }}
                        >
                          {info.transient ? "auto-retried" : "needs attention"}
                        </span>
                        <span className="rd-igsync-issue-detail">{l.detail || "—"}</span>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
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
   clear-all affordance in the actions cell. Stops row clicks from sorting.

   ColFilterTextCell / ColFilterSelectCell are hoisted to MODULE SCOPE so they
   keep a stable component identity across renders — defining them inside
   ColumnFilterRow remounted the <input>/<select> on every keystroke, which
   dropped focus and reset the cursor. They receive everything as props. */
function ColFilterTextCell({ k, colFilters, onColFilter }) {
  return (
    <td className="rd-colfilter-td">
      <input
        className="rd-colfilter-input"
        value={colFilters[k] || ""}
        placeholder="filter…"
        onChange={(e) => onColFilter(k, e.target.value)}
      />
    </td>
  );
}

function ColFilterSelectCell({ k, colFilters, onColFilter }) {
  const c = RD_SELECT_COLUMNS.find((col) => col.key === k);
  return (
    <td className="rd-colfilter-td">
      <select className="rd-colfilter-select" value={colFilters[k] || "all"}
              onChange={(e) => onColFilter(k, e.target.value)}>
        <option value="all">All</option>
        {c.options.map((o) => <option key={o.key} value={o.key}>{c.labelFn(o.key)}</option>)}
      </select>
    </td>
  );
}

function ColumnFilterRow({ colFilters, onColFilter, onClear, visible = () => true }) {
  const T = (k) => <ColFilterTextCell k={k} colFilters={colFilters} onColFilter={onColFilter} />;
  const S = (k) => <ColFilterSelectCell k={k} colFilters={colFilters} onColFilter={onColFilter} />;
  // Each cell is gated key-by-key against RD_COLUMNS order so it stays exactly
  // index-aligned with the thead <th> and tbody <td> blocks. The mark and
  // actions cells are filter-less placeholders (mark carries the sticky-freeze
  // class; actions holds the clear-all ✕).
  return (
    <tr className="rd-colfilter-row">
      {visible("mark")     && <td className="rd-colfilter-td rd-colfilter-mark" />}
      {visible("reel")     && T("reel")}
      {visible("location") && T("location")}
      {visible("music")    && T("music")}
      {visible("font")     && T("font")}
      {visible("sfx")      && T("sfx")}
      {visible("story")    && T("story")}
      {visible("notes")    && T("notes")}
      {visible("assets")   && <td className="rd-colfilter-td" />}
      {visible("actions")  && (
        <td className="rd-colfilter-td rd-colfilter-clear-td">
          <button type="button" className="rd-colfilter-clear" title="Clear column filters" onClick={onClear}>✕</button>
        </td>
      )}
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

/* 8-tone palette for Reel DNA row color-tagging — mirrors the My Work / list-view
   pickers (cyan/violet/green/amber/red/blue/orange/pink) so a color reads the
   same everywhere. The tone NAME is what we persist in reel_dna.row_color. */
export const RD_ROW_TONES = ["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"];
export const RD_TONE_COLOR = {
  cyan:   "var(--c-cyan)",   violet: "var(--c-violet)",
  green:  "var(--c-green)",  amber:  "var(--c-amber)",
  red:    "var(--c-red)",    blue:   "var(--c-blue)",
  orange: "var(--c-orange)", pink:   "var(--c-pink)",
};
/* Faint full-row tint from a tone name (color-mix over transparent, an existing
   pattern in this repo). Returns undefined for an untagged row so the row keeps
   its normal status styling. */
export function rdRowTint(tone) {
  const base = tone && RD_TONE_COLOR[tone];
  return base ? `color-mix(in srgb, ${base} 14%, transparent)` : undefined;
}

/* Anchored color-swatch popover. The spreadsheet wrapper has `overflow-x: auto`,
   which CLIPS an absolutely-positioned dropdown — so the panel is rendered
   `position: fixed`, measured from the trigger button via getBoundingClientRect,
   to escape the clip and sit above the table. Closes on outside-click, scroll,
   or resize (a fixed panel would otherwise float detached when the sheet moves). */
function useColorPopover() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const wrapRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const panelRef = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    // The panel is portaled to <body>, so it is NOT a descendant of wrapRef —
    // check BOTH refs or a swatch click counts as "outside" and closes the
    // popover (on mousedown) before the click lands.
    const onDown = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const vw = window.innerWidth || 9999;
      setCoords({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, vw - 140)) });
    }
    setOpen((o) => !o);
  };
  const panelStyle = {
    position: "fixed", top: coords?.top ?? 0, left: coords?.left ?? 0, zIndex: 4000,
    background: "var(--bg-2, #1e2433)", border: "1px solid var(--line-hard)",
    borderRadius: 6, padding: "6px 8px", display: "flex", gap: 5, flexWrap: "wrap",
    width: 132, boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
  };
  // Render the swatch panel in a body portal so no overflow / transformed
  // ancestor can clip it (position:fixed alone wasn't enough — a transformed
  // ancestor was establishing a containing block).
  const renderPanel = (children) =>
    open && coords
      ? createPortal(
          <span ref={panelRef} onClick={(e) => e.stopPropagation()} style={panelStyle}>{children}</span>,
          document.body
        )
      : null;
  return { open, setOpen, coords, wrapRef, btnRef, toggle, renderPanel };
}

/* One swatch in a color popover. */
function ToneSwatch({ tone, selected, onClick }) {
  return (
    <span
      onClick={onClick}
      title={tone}
      style={{
        width: 16, height: 16, borderRadius: "50%", cursor: "pointer",
        background: RD_TONE_COLOR[tone],
        border: selected ? "2px solid #fff" : "2px solid transparent",
      }}
    />
  );
}

/* The "×" clear pip in a color popover. */
function ClearPip({ onClick, title }) {
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        width: 16, height: 16, borderRadius: "50%", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--fg-dim)", color: "var(--fg-mute)", fontSize: 11, lineHeight: 1,
      }}
    >×</span>
  );
}

/* Small colored-dot button + popover palette for color-tagging a row — the same
   interaction as My Work's TaskColorDot. Picking a tone tints the whole row. */
function RowColorDot({ item, actions }) {
  const { setOpen, wrapRef, btnRef, toggle, renderPanel } = useColorPopover();
  const tone = item.rowColor || null;
  const current = tone ? RD_TONE_COLOR[tone] : null;
  const pick = (t) => { actions.updateReelDna(item.id, { rowColor: t }); setOpen(false); };
  return (
    <span ref={wrapRef} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={tone ? `Row color: ${tone} (change / clear)` : "Color-tag this row"}
        style={{
          width: 13, height: 13, borderRadius: "50%", padding: 0, cursor: "pointer",
          background: current || "transparent",
          border: current ? "1px solid rgba(255,255,255,0.25)" : "1px dashed var(--fg-dim)",
        }}
      />
      {renderPanel(
        <>
          {RD_ROW_TONES.map(t => (
            <ToneSwatch key={t} tone={t} selected={tone === t} onClick={() => pick(t)} />
          ))}
          {tone && <ClearPip onClick={() => pick(null)} title="Clear color" />}
        </>
      )}
    </span>
  );
}

/* Header star-filter toggle — lives at the top of the mark column. Star on =
   show only favorited rows. */
function StarFilterButton({ active, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!active)}
      aria-pressed={active}
      title={active ? "Showing starred only — click to show all" : "Filter to starred rows"}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 0,
        fontSize: 14, lineHeight: 1,
        color: active ? "var(--c-amber, #f5b301)" : "var(--fg-dim)",
      }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

/* Header color-filter dot + popover — lives in the mark column heading. Always
   shown (so the filter is discoverable even before any row is colored); offers
   the full palette. Picking a tone narrows the sheet to rows tagged with it. */
function ColorFilterDot({ value, onPick }) {
  const { setOpen, wrapRef, btnRef, toggle, renderPanel } = useColorPopover();
  const current = value ? RD_TONE_COLOR[value] : null;
  const choose = (t) => { onPick(t); setOpen(false); };
  return (
    <span ref={wrapRef} style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={value ? `Filtering by ${value} — click to change` : "Filter by color tag"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 2,
          background: "none", border: "none", cursor: "pointer", padding: 0,
          color: "var(--fg-dim)", fontSize: 9, lineHeight: 1,
        }}
      >
        <span style={{
          width: 12, height: 12, borderRadius: "50%",
          background: current || "transparent",
          border: current ? "1px solid rgba(255,255,255,0.25)" : "1px dashed var(--fg-dim)",
        }} />
        <span>▾</span>
      </button>
      {renderPanel(
        <>
          {RD_ROW_TONES.map(t => (
            <ToneSwatch key={t} tone={t} selected={value === t} onClick={() => choose(t)} />
          ))}
          <ClearPip onClick={() => choose(null)} title="All colors" />
        </>
      )}
    </span>
  );
}

/* Leftmost spreadsheet cell: a favorite (star) toggle on the LEFT and the color
   dot on the RIGHT, side by side. Both persist via updateReelDna (favorite
   boolean / rowColor tone name, migration 0089) so they survive reload and sync
   across tabs via realtime. The chosen color tints the whole <tr>. */
function RowMarkCell({ item, actions }) {
  const fav = !!item.favorite;
  // The frozen col-0 cell is opaque (so scrolled cells don't bleed through),
  // which would paint over the row's color tint. Re-apply the SAME 14%-over-bg-2
  // tint as a gradient layered above the opaque base so a tinted row stays tinted
  // even on the frozen cell. Untinted rows fall back to the CSS var(--bg-2).
  const tint = rdRowTint(item.rowColor);
  const cellStyle = tint
    ? { background: `linear-gradient(${tint}, ${tint}), var(--bg-2)` }
    : undefined;
  return (
    <td className="rd-td-mark" style={cellStyle}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          className={"rd-fav-btn" + (fav ? " is-on" : "")}
          title={fav ? "Unstar this reel" : "Star this reel (filter by favorites)"}
          aria-pressed={fav}
          onClick={() => actions.updateReelDna(item.id, { favorite: !fav })}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: 15, lineHeight: 1, flexShrink: 0,
            color: fav ? "var(--c-amber, #f5b301)" : "var(--fg-dim)",
          }}
        >
          {fav ? "★" : "☆"}
        </button>
        <RowColorDot item={item} actions={actions} />
      </span>
    </td>
  );
}

/* The Reel column cell — the title link is the PRIMARY in-app preview path.
   A plain left-click opens the ReelPreviewModal (and marks the row visited);
   Ctrl/Cmd/middle/shift/alt-click keeps the native href so a real new tab still
   opens (and is still marked visited). The "↗" pip is an explicit new-tab
   escape hatch. Visited rows get an underline; the single most-recent click is
   the brighter `is-last`. */
function ReelCellLink({ item, now, onOpenPreview, onLinkClick, isVisited, isLast }) {
  const handleClick = (e) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      onOpenPreview?.(item);
      onLinkClick?.(item);
    } else {
      // Let the browser open the new tab — still record the visit.
      onLinkClick?.(item);
    }
  };
  const cls = "rd-cell-link" + (isVisited ? " is-visited" : "") + (isLast ? " is-last" : "");
  return (
    <td className="rd-td-reel">
      <a className={cls} href={item.reelUrl} target="_blank" rel="noreferrer"
         title={item.reelUrl} onClick={handleClick} onAuxClick={(e) => { if (e.button === 1) onLinkClick?.(item); }}>
        {item.reelUrl}
      </a>
      <div className="rd-cell-sub">
        <span className="rd-tag sm dna-source-chip">{platformLabel(item.platform)}</span>
        <span className={"rd-tag sm dim" + (item.status === "captured" ? " dna-status-captured" : item.status === "progress" ? " dna-status-progress" : "")}>{relTime(item.createdAt, now)}</span>
        <a className="rd-cell-newtab" href={item.reelUrl} target="_blank" rel="noreferrer"
           title="Open in a new tab" onClick={() => onLinkClick?.(item)}>↗</a>
      </div>
    </td>
  );
}

/* ---------- Spreadsheet / log view ----------
   PURE renderer: hide/visited state + callbacks arrive as props from
   ReelDnaComprehensive (it owns the store reads). hiddenCols defaults to [] so
   undefined => all columns visible (NEVER all hidden). */
export function DnaTable({ items, now, actions, onView, onDeconstruct, onSend, onBack, onDelete,
                          onOpenAssets, onOpenCard, colFilters, onColFilter, onClearColFilters,
                          favOnly, onFavFilter, colorFilter, onColorFilter,
                          hiddenCols = [], onOpenPreview, onLinkClick,
                          visitedReelDnaIds = [], lastVisitedReelDnaId = null }) {
  const { reels } = useWorkflow();
  const [compareItem, setCompareItem] = useState(null);

  // Promote a parsed-on-read tag value to a real structured field on edit, so a
  // note-derived column becomes a first-class field once the user touches it.
  const saveLocation = (item, val) => actions.updateReelDna(item.id, { location: val || null });
  const saveGeneField = (item, geneKey, subKey, val) =>
    actions.updateReelDna(item.id, { [geneKey]: { ...(item[geneKey] || {}), [subKey]: val } });

  const showFilters = !!colFilters && !!onColFilter;

  // Build the visibility predicate ONCE per render from the hidden-keys list.
  const visible = makeColVisibility(hiddenCols);
  // The dynamic column count drives the empty-state colSpan AND the dev-only
  // alignment assert (rendered <th> count must equal this).
  const visibleCount = RD_COLUMNS.filter((c) => visible(c.key)).length;

  // FILTER-ON-HIDDEN auto-clear: if a column with an active per-column filter
  // gets hidden, clear that filter so a now-invisible constraint can't silently
  // drop rows. Runs after render; cheap (only the active-filter keys).
  useEffect(() => {
    if (!showFilters || !onColFilter) return;
    // Text columns clear to "", the status select clears to "all".
    RD_TEXT_COLUMN_KEYS.forEach((k) => {
      if (!visible(k) && (colFilters?.[k] || "").trim()) onColFilter(k, "");
    });
    if (!visible("status") && colFilters?.status && colFilters.status !== "all") onColFilter("status", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenCols, colFilters, showFilters]);

  // Dev-only guard against index drift between the three column sites: count the
  // <th> elements actually rendered and compare to the model's visible count. A
  // mismatch means a thead/filter/tbody block fell out of RD_COLUMNS alignment.
  const headRowRef = React.useRef(null);
  useEffect(() => {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") return;
    const thCount = headRowRef.current ? headRowRef.current.querySelectorAll("th").length : visibleCount;
    // eslint-disable-next-line no-console
    console.assert(
      thCount === visibleCount,
      `[DnaTable] column drift: rendered ${thCount} <th> but model says ${visibleCount} visible`
    );
  });

  return (
    <div className="rd-table-wrap dna-table-panel">
      <table className="rd-table">
        <thead>
          <tr ref={headRowRef} className="dna-table-head-row">
            {visible("mark") && (
              <th className="rd-th-mark dna-th" title="Filter by starred / color">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {onFavFilter && <StarFilterButton active={!!favOnly} onToggle={onFavFilter} />}
                  {onColorFilter && <ColorFilterDot value={colorFilter} onPick={onColorFilter} />}
                </span>
              </th>
            )}
            {visible("reel")     && <th className="rd-th-reel dna-th">Reel</th>}
            {visible("location") && <th className="dna-th">Location</th>}
            {visible("music")    && <th className="dna-th">Music</th>}
            {visible("font")     && <th className="dna-th">Font</th>}
            {visible("sfx")      && <th className="dna-th">SFX</th>}
            {visible("story")    && <th className="dna-th">Story / Pacing</th>}
            {visible("notes")    && <th className="dna-th">Notes</th>}
            {visible("assets")   && <th className="rd-th-assets dna-th">Assets</th>}
            {visible("actions")  && <th className="rd-th-act dna-th"></th>}
          </tr>
          {showFilters && (
            <ColumnFilterRow colFilters={colFilters} onColFilter={onColFilter}
                             onClear={onClearColFilters} visible={visible} />
          )}
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr className="rd-tr rd-tr--empty">
              <td className="rd-td-empty dna-empty" colSpan={visibleCount}>No reels match these filters.</td>
            </tr>
          )}
          {items.map(item => {
            const tags = resolveTags(item);
            const isVisited = Array.isArray(visitedReelDnaIds) && visitedReelDnaIds.includes(item.id);
            const isLast = lastVisitedReelDnaId === item.id;
            return (
              <tr key={item.id} className={"rd-tr dna-row rd-status--" + item.status}
                  style={item.rowColor ? { background: rdRowTint(item.rowColor) } : undefined}>
                {visible("mark") && <RowMarkCell item={item} actions={actions} />}
                {visible("reel") && (
                  <ReelCellLink item={item} now={now} onOpenPreview={onOpenPreview}
                                onLinkClick={onLinkClick} isVisited={isVisited} isLast={isLast} />
                )}
                {visible("location") && <td className="dna-cell"><EditableCell value={tags.location} placeholder="—" onSave={v => saveLocation(item, v)} /></td>}
                {visible("music") && <td className="dna-cell"><EditableCell value={tags.music} placeholder="—" onSave={v => saveGeneField(item, "music", "track", v)} /></td>}
                {visible("font") && <td className="dna-cell"><EditableCell value={tags.font} placeholder="—" onSave={v => saveGeneField(item, "font", "names", v)} /></td>}
                {visible("sfx") && <td className="dna-cell"><EditableCell value={tags.sfx} placeholder="—" onSave={v => saveGeneField(item, "sfx", "notes", v)} /></td>}
                {visible("story") && <td className="dna-cell"><EditableCell value={tags.story} placeholder="—" onSave={v => saveGeneField(item, "story", "styleNotes", v)} /></td>}
                {visible("notes") && <td className="dna-cell"><EditableCell value={item.quickNotes} placeholder="—" onSave={v => actions.updateReelDna(item.id, { quickNotes: v || null })} /></td>}
                {visible("assets") && <AssetCountCell item={item} onOpen={onOpenAssets} />}
                {visible("actions") && (
                  <td className="rd-td-act">
                    {onOpenCard && (
                      <button className="rd-row-btn rd-row-btn--open" title="Open the full card to add assets" onClick={() => onOpenCard(item)}>⤢ Card</button>
                    )}
                    {item.reelId ? (
                      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <span className="rd-row-btn rd-row-btn--linked" title={"In pipeline · " + item.reelId}>▸ {item.reelId}</span>
                        {onBack && (
                          <button className="rd-row-btn rd-row-btn--back"
                                  title="Pull everything (assets + notes) back to Reel DNA and free this card to send again"
                                  onClick={() => onBack(item)}>↩ DNA</button>
                        )}
                      </span>
                    ) : (
                      <button className="rd-row-btn rd-row-btn--send" title="Create a pipeline reel from this card" onClick={() => onSend(item)}>→ Pipeline</button>
                    )}
                    {item.archivedAt ? (
                      <button className="rd-row-btn rd-row-btn--restore" title="Restore to Live" onClick={() => actions.restoreReelDna(item.id)}>↩</button>
                    ) : (
                      <button className="rd-row-btn rd-row-btn--archive" title="Archive" onClick={() => actions.archiveReelDna(item.id)}>⧉</button>
                    )}
                    <button className="rd-row-btn rd-row-btn--delete" title="Delete permanently" onClick={() => onDelete(item)}>✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {compareItem && (() => {
        const linked = compareItem.reelId ? reels.find(r => r.id === compareItem.reelId) : null;
        return (
          <ReelCompareModal
            leftLabel="Inspiration"
            leftUrl={compareItem.reelUrl}
            rightLabel={linked ? `${linked.id} — current edit` : "Current edit"}
            rightUrl={linked?.attachUrl || ""}
            onClose={() => setCompareItem(null)}
          />
        );
      })()}
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
  const { reelDna, reelDnaAssets, actions, error, igSyncRuns, igIngestLog } = useWorkflow();
  const { actions: locationActions } = useLocations();
  const { peopleList } = useRoster();
  const { person: me } = useAuth();
  /* Reel DNA → pipeline send: the "→ Pipeline" row button opens this editor
     picker (sendItem = the card awaiting editor choice; sendSel = chosen ids). */
  const [sendItem, setSendItem] = useState(null);
  const [sendSel, setSendSel] = useState([]);
  const isOwner = me?.role === "owner";
  const now = useNow();

  const [tab, setTab] = useState("reels"); // reels | thumbnails
  const [showArchived, setShowArchived] = useState(false);
  const [showSent, setShowSent] = useState(false);
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
  // "Check IG Sync": re-pull the poller's run history + issue log on demand and
  // open the report so the owner can see what the last poll saw vs what landed
  // in the spreadsheet, plus any errors. Separate from Refresh (which forces a
  // brand-new poll) — this just inspects what's already recorded.
  const [checking, setChecking] = useState(false);
  const [igReportOpen, setIgReportOpen] = useState(false);
  const handleCheckIgSync = async () => {
    if (checking) return;
    setChecking(true);
    setNotice(null);
    try {
      const r = await actions.reloadIgSync();
      await actions.reloadReelDna().catch(() => {});
      setIgReportOpen(true);
      const run = r.latest;
      const summary = run
        ? `seen ${run.sharesSeen ?? 0}, ${run.inserted ?? 0} new + ${run.dedupeSkip ?? 0} already captured, ${r.issues} issue(s) logged${run.reconciled ? "" : " · MISMATCH"}`
        : "no sync runs recorded yet";
      setNotice({ tone: run && run.reconciled === false ? "err" : "ok",
                  text: `IG sync checked — ${summary}. See the report below.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Couldn't check IG sync · " + (e.message || String(e)) });
    } finally {
      setChecking(false);
    }
  };
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

  // Core send: create ONE pipeline reel from the card, owned by ownerId, and
  // migrate the card's location pins onto it (footage + news migrate inside the
  // store action). Returns the new reel id (links the card via reel_id).
  const sendOne = (item, ownerId) => {
    const newId = actions.sendReelDnaToPipeline(item.id, { owner: ownerId });
    if (newId && typeof locationActions?.linkReel === "function") {
      const locLinks = (reelDnaAssets || []).filter(
        a => a && a.reelDnaId === item.id && a.assetType === "location"
      );
      for (const a of locLinks) locationActions.linkReel(a.assetId, newId);
    }
    return newId;
  };

  // The "→ Pipeline" row button opens the editor picker (instead of sending
  // straight to `me`). Pre-selects the current user so a one-click Send still
  // sends to self. Already-linked cards short-circuit.
  const openSendPicker = (item) => {
    if (item.reelId) { setNotice({ tone: "ok", text: `Already in the pipeline as ${item.reelId}.` }); return; }
    setSendSel(me?.id ? [me.id] : []);
    setSendItem(item);
  };

  // Send the picked card to the pipeline for each selected editor. The first
  // editor gets the real linked reel (so the card shows "▸ REEL-xxx" + supports
  // ↩ Back); any additional editors get an INDEPENDENT copy in their Not Started
  // (title " (FirstName)"), mirroring the multi-editor create flow.
  const doSend = () => {
    const item = sendItem;
    if (!item) return;
    const ids = sendSel.length ? sendSel : [me?.id].filter(Boolean);
    if (!ids.length) { setNotice({ tone: "err", text: "Pick at least one editor." }); return; }
    try {
      const newId = sendOne(item, ids[0]);
      for (const eid of ids.slice(1)) {
        const p = (peopleList || []).find(pp => pp.id === eid) || {};
        const firstName = p.short || (p.name || "").split(" ")[0] || eid;
        if (newId) actions.duplicateReel(newId, eid, firstName);
      }
      const names = ids.map(eid => {
        const p = (peopleList || []).find(pp => pp.id === eid) || {};
        return p.short || (p.name || "").split(" ")[0] || eid;
      });
      setNotice({ tone: "ok", text: `Sent to pipeline for ${names.join(", ")} — open the Pipeline tab to edit.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Couldn't add to pipeline · " + (e.message || String(e)) });
    }
    setSendItem(null);
    setSendSel([]);
  };

  // Reverse of handleSend — pull a card back out of the pipeline. Migrates the
  // pipeline reel's assets (footage/locations/news) + text back onto the card,
  // unlinks it (so "→ Pipeline" resets), and archives the now-empty pipeline
  // reel off the board. Everything the editor added in the pipeline comes home.
  const handleBack = async (item) => {
    if (!item.reelId) return;
    const reelId = item.reelId;
    try {
      // 1) Assets back onto the card — footage + locations + news the pipeline
      //    gained (queries Supabase by the still-set reel_id; attaches as card
      //    reel_dna_assets, deduped).
      await actions.seedAssetsFromPipeline(item);
      // 2) Text back + unlink + reset status so the "→ Pipeline" button returns.
      actions.returnReelFromPipeline(reelId);
      // 3) Remove the emptied reel from the pipeline board (soft archive, so the
      //    migrated footage rows survive and the card's asset links resolve).
      actions.archiveReel(reelId);
      setNotice({ tone: "ok", text: `Pulled ${reelId} back to Reel DNA — assets + notes migrated, and you can send it to the pipeline again.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Couldn't pull back · " + (e.message || String(e)) });
    }
  };

  // Archived-respecting base pool — feeds the Comprehensive view. Also excludes
  // tombstoned (deletedAt) rows defensively in case a stale realtime echo
  // carries one before the reducer drops it.
  const baseList = useMemo(() => (
    (reelDna || []).filter(d =>
      (showArchived ? !!d.archivedAt : !d.archivedAt) &&
      !d.deletedAt &&
      (showSent || !d.reelId)
    )
  ), [reelDna, showArchived, showSent]);

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

  // How many IG-DM-sourced rows are live in the spreadsheet — the "what landed"
  // figure the IG Sync report compares against the poller's seen/accounted.
  const igDmCount = useMemo(
    () => (reelDna || []).filter(d => d && d.source === "ig_dm" && !d.deletedAt).length,
    [reelDna]
  );

  // Full-screen Assets takeover — replaces the page body while open.
  if (assetsItem) {
    return (
      <div className="reel-dna dna-wrap">
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
    <div className="reel-dna dna-wrap">
      <style>{SOL_DNA_CSS}</style>
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
              <DPill onClick={handleCheckIgSync}
                     style={checking ? { opacity: 0.6, pointerEvents: "none" } : undefined}
                     title="Check the IG poller: what came in, what landed in the sheet, and any errors">
                {checking ? "Checking…" : "🔎 Check IG Sync"}
              </DPill>
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

      <IgSyncHealth runs={igSyncRuns} log={igIngestLog} igDmCount={igDmCount}
                    open={igReportOpen} onToggle={() => setIgReportOpen(o => !o)} />

      <div className="rd-body">
        <div className="dna-capture-panel">
        <Card title="Capture a reel" defaultOpen={true}
              footLeft="Paste a link, pick the genes you care about, add a note.">
          <CaptureForm prefill={prefill} onCapture={onCapture} />
        </Card>
        </div>

        <div className="rd-filterbar">
          <span style={{ flex: 1 }} />
          <DPill active={showSent} onClick={() => setShowSent(s => !s)}>
            {showSent ? "Showing Sent" : "Hide Sent"}
          </DPill>
          <DPill active={showArchived} onClick={() => setShowArchived(a => !a)}>
            {showArchived ? "Archived" : "Live"}{counts.archived ? " · " + counts.archived : ""}
          </DPill>
        </div>

        {baseList.length === 0 ? (
          <div className="rd-empty">
            {showArchived ? "No archived reels." : "No reels captured yet — paste a URL above to start your reel genome."}
          </div>
        ) : (
          <ReelDnaComprehensive items={baseList} now={now} actions={actions}
                                onView={onView} onDeconstruct={onDeconstruct}
                                onSend={openSendPicker} onBack={handleBack} onDelete={handleDelete}
                                onOpenAssets={(it) => setAssetsId(it.id)} isOwner={isOwner} />
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

      {/* Send-to-pipeline editor picker — opened by the "→ Pipeline" row button.
          Pick one or more editors; the first gets the linked reel, the rest get
          independent copies in their Not Started. */}
      {sendItem && (
        <div className="rdc-modal-overlay" onClick={() => setSendItem(null)}>
          <div className="rdc-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <button type="button" className="rdc-modal-close" title="Close" onClick={() => setSendItem(null)}>✕</button>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Send to pipeline</div>
            <div style={{ fontSize: 12, color: "var(--fg-dim)", marginBottom: 12 }}>
              Pick the editor(s) to send this reel to — each gets it in their Not Started box.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto" }}>
              {(peopleList || []).filter(p => !p.archivedAt && p.role !== "reviewer").map(p => {
                const on = sendSel.includes(p.id);
                return (
                  <label key={p.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: 4, cursor: "pointer", fontSize: 12.5, background: on ? "rgba(107,214,224,0.08)" : "transparent" }}>
                    <input type="checkbox" checked={on}
                      onChange={() => setSendSel(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])} />
                    <span>{(p.short || (p.name || "").split(" ")[0] || p.id)} · {ROLES[p.role]?.short || p.role}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="rd-row-btn" onClick={() => setSendItem(null)}>Cancel</button>
              <button className="rd-row-btn rd-row-btn--send" disabled={!sendSel.length}
                style={{ opacity: sendSel.length ? 1 : .5 }} onClick={doSend}>
                → Send to {sendSel.length || ""} {sendSel.length === 1 ? "editor" : "editors"}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
