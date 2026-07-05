/* =========================================================
   Thumbnail DNA — paste-in YouTube thumbnail capture + catalog.

   Mirrors the Reel DNA capture flow (src/pages/reel-dna.jsx) but for
   YouTube THUMBNAILS:
     · Paste a YouTube link → the video id + thumbnail image are derived
       CLIENT-SIDE (zero-key, no server call) via extractYouTubeId /
       thumbnailUrlFromId; the <img> falls back maxres→hq on error.
     · Tag the six manual "design genes" (color, typography, face, layout,
       mood, subject) — chips flag genes of interest; each gene is a flat
       editable text column.
     · Catalog the captures as cards or a spreadsheet, with the six gene
       columns inline-editable (mirroring EditableCell / DnaTable).

   Input is paste-in ONLY (no poller / webhook / Hetzner / OAuth) and
   tagging is MANUAL ONLY (no vision/AI). Title + channel are a best-effort
   enrichment from /api/ai/suggest?action=youtube-oembed (any error is
   swallowed — the displayed thumbnail never blocks on it).

   Exported as the NAMED component `ThumbnailDna` (no required props) so
   reel-dna.jsx can `import { ThumbnailDna } from "./thumbnail-dna.jsx"`.
   ========================================================= */

import React, { useState, useMemo, useEffect, useRef } from "react";
import "./thumbnail-dna.css";
import { Card, DPill } from "../components/components.jsx";
import { ExpandableCard } from "../components/expandable-card.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import { personName } from "../lib/roster.jsx";
import { useNow, formatDuration } from "../lib/time.jsx";
import {
  GENES, GENE_KEYS, STATUSES, SOURCES,
  statusLabel, sourceLabel, geneLabel,
  extractYouTubeId, thumbnailUrlFromId, thumbnailFallbackUrlFromId,
} from "../lib/thumbnail-dna.jsx";

/* Human label for a capture's source. The lib's SOURCES now lists both
   'manual' and 'yt_playlist' (the poller's source), so sourceLabel already
   maps both — no special-casing needed here. Kept as a thin alias so call
   sites read clearly and a future source key only needs the lib edit. */
const sourceBadge = sourceLabel;

function relTime(iso, now) {
  if (!iso) return "";
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return "";
    return formatDuration((now?.getTime?.() ?? Date.now()) - ts) + " ago";
  } catch { return ""; }
}

/* Best-effort title/channel enrichment via the folded oEmbed endpoint. Sends
   the owner's Supabase Bearer token (the endpoint shares api/ai/suggest auth).
   ALWAYS resolves — any failure returns null so the caller can no-op. The
   endpoint itself returns { ok:false } (HTTP 200) on failure, never throws. */
async function fetchOEmbed(url) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const res = await fetch(`/api/ai/suggest?action=youtube-oembed&url=${encodeURIComponent(url)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) return null;
    return {
      title: body.title || null,
      channel: body.channel || null,
      thumbnailUrl: body.thumbnail_url || null,
    };
  } catch {
    return null;
  }
}

/* A live thumbnail preview. Derives the image client-side from the id and
   falls back maxresdefault → hqdefault on the first load error (maxres
   doesn't exist for every video; hqdefault always does). */
export function ThumbPreview({ videoId, alt }) {
  const [fallback, setFallback] = useState(false);
  // Reset the fallback flag whenever the id changes so a new paste retries maxres.
  useEffect(() => { setFallback(false); }, [videoId]);
  if (!videoId) return null;
  const src = fallback ? thumbnailFallbackUrlFromId(videoId) : thumbnailUrlFromId(videoId);
  return (
    <img
      className="td-thumb-img"
      src={src}
      alt={alt || "YouTube thumbnail"}
      loading="lazy"
      onError={() => { if (!fallback) setFallback(true); }}
    />
  );
}

/* ---------- Capture form ---------- */
function CaptureForm({ onCapture }) {
  const [url, setUrl] = useState("");
  const [genes, setGenes] = useState([]);
  const [notes, setNotes] = useState("");

  const videoId = useMemo(() => extractYouTubeId(url), [url]);
  const canSubmit = !!videoId;

  const toggleGene = (k) =>
    setGenes(g => g.includes(k) ? g.filter(x => x !== k) : [...g, k]);

  const submit = () => {
    if (!canSubmit) return;
    onCapture({
      videoUrl: url.trim(),
      videoId,
      thumbnailUrl: thumbnailUrlFromId(videoId),
      genesOfInterest: genes,
      quickNotes: notes.trim() || null,
    });
    setUrl(""); setGenes([]); setNotes("");
  };

  return (
    <div className="td-capture">
      <div className="td-capture-row">
        <input
          className="td-input"
          placeholder="Paste a YouTube link…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
        />
      </div>

      {url.trim() && !videoId && (
        <div className="td-warn mono">
          Couldn't find a YouTube video id — supports youtu.be/…, watch?v=…, /shorts/…, /embed/…, /live/…
        </div>
      )}

      {videoId && (
        <div className="td-preview">
          <ThumbPreview videoId={videoId} />
          <div className="td-preview-meta mono dim">id · {videoId}</div>
        </div>
      )}

      <div className="td-genes-pick">
        <span className="td-genes-label">Genes</span>
        {GENES.map(g => (
          <button key={g.key}
                  type="button"
                  className={"td-gene-chip" + (genes.includes(g.key) ? " is-on" : "")}
                  title={g.hint}
                  onClick={() => toggleGene(g.key)}>
            {g.label}
          </button>
        ))}
      </div>

      <textarea
        className="td-notes"
        placeholder="Quick notes — what makes this thumbnail work?"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
      />

      <div className="td-capture-actions">
        <DPill primary solid onClick={submit}
               style={canSubmit ? undefined : { opacity: 0.5, pointerEvents: "none" }}>
          Capture
        </DPill>
      </div>
    </div>
  );
}

/* ---------- Inline-editable spreadsheet/gene cell ---------- */
function EditableCell({ value, placeholder, onSave }) {
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const commit = () => { const next = v.trim(); if (next !== (value || "")) onSave(next); };
  return (
    <input
      className="td-cell-input"
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

/* ---------- The six-gene editor (shared by inline + expanded overlay) ---------- */
function GeneEditor({ item, saveGene }) {
  return (
    <div className="td-editor">
      {GENE_KEYS.map(g => (
        <div key={g} className="td-editor-block">
          <div className="td-editor-label">{geneLabel(g)}</div>
          <EditableCell
            value={item[g]}
            placeholder={GENES.find(x => x.key === g)?.hint || "—"}
            onSave={(val) => saveGene(g, val)}
          />
        </div>
      ))}
    </div>
  );
}

/* ---------- A captured thumbnail card ----------
   `idScope` disambiguates the ExpandableCard layoutId when the SAME item is
   rendered in more than one place at once (e.g. the main grid AND the overview
   carousel). Without a distinct scope, two tiles share `exc-thumb-<id>` and
   framer-motion's shared-layout morph fights over three nodes → the tile
   vanishes and reappears. A per-context scope makes each morph a clean 2-way
   tile↔overlay. */
function DnaCard({ item, now, actions, onDelete, idScope }) {
  const [open, setOpen] = useState(false);
  const genes = item.genesOfInterest || [];
  const title = item.title || item.videoUrl;

  const saveGene = (geneKey, val) => actions.updateThumbnailDna(item.id, { [geneKey]: val || null });
  const setStatus = (s) => actions.updateThumbnailDna(item.id, { status: s });

  // Zero-key thumbnail image for the expand overlay's shared morph.
  const thumb = item.videoId
    ? { url: thumbnailUrlFromId(item.videoId), fallbackUrl: thumbnailFallbackUrlFromId(item.videoId) }
    : (item.thumbnailUrl ? { url: item.thumbnailUrl, fallbackUrl: null } : null);

  return (
    <ExpandableCard
      id={`${idScope ? idScope + "-" : ""}thumb-${item.id}`}
      tone="cyan"
      thumbnail={thumb}
      header={{ title, subtitle: [item.channel, sourceBadge(item.source)].filter(Boolean).join(" · ") }}
      onOpenFull={item.videoUrl ? () => window.open(item.videoUrl, "_blank", "noopener") : undefined}
      openFullLabel="Watch on YouTube ↗"
      renderExpanded={() => (
        <div className="td-expanded">
          <div className="td-status-pick">
            {STATUSES.map(s => (
              <button key={s.key} type="button"
                      className={"td-status-chip" + (item.status === s.key ? " is-on" : "")}
                      onClick={() => setStatus(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="td-card-category">
            <span className="td-card-category-label" title="Your custom category — used by Group → Subject">🏷</span>
            <EditableCell value={item.subject} placeholder="Add a category to group by…"
                          onSave={(val) => saveGene("subject", val)} />
          </div>
          <GeneEditor item={item} saveGene={saveGene} />
        </div>
      )}
    >
      {({ open: expand, Tile }) => (
    <Tile className={"td-card exc-tile td-status--" + item.status}>
      <a className="td-card-thumb" onClick={(e) => { e.preventDefault(); expand(); }}
         href={item.videoUrl} target="_blank" rel="noreferrer"
         title="Click to expand · open link in new tab from the overlay">
        <ThumbPreview videoId={item.videoId} alt={title} />
      </a>

      <div className="td-card-body">
        <div className="td-card-head">
          <div className="td-card-title">
            <a className="td-card-url" href={item.videoUrl} target="_blank" rel="noreferrer">
              {title}
            </a>
            <div className="td-card-meta">
              {item.channel && <span className="td-tag">{item.channel}</span>}
              <span className={"td-tag dim" + (item.source === "yt_playlist" ? " td-tag--src" : "")}>
                {sourceBadge(item.source)}
              </span>
              {item.capturedBy && <span className="td-tag dim">{personName(item.capturedBy)}</span>}
              <span className="td-tag dim">{relTime(item.createdAt, now)}</span>
            </div>
          </div>
          <div className="td-status-pick">
            {STATUSES.map(s => (
              <button key={s.key}
                      type="button"
                      className={"td-status-chip" + (item.status === s.key ? " is-on" : "")}
                      onClick={() => setStatus(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Inline custom-category tag → stored in the Subject gene. Lets you
            label a thumbnail with your OWN category (e.g. "Travel", "Tech")
            and then group the catalog by it via the "Group → Subject" control,
            without opening "Edit genes". */}
        <div className="td-card-category">
          <span className="td-card-category-label" title="Your custom category — used by Group → Subject">🏷</span>
          <EditableCell
            value={item.subject}
            placeholder="Add a category to group by…"
            onSave={(val) => saveGene("subject", val)}
          />
        </div>

        {genes.length > 0 && (
          <div className="td-card-genes">
            {genes.map(g => <span key={g} className="td-gene-tag">{geneLabel(g)}</span>)}
          </div>
        )}

        {open && <GeneEditor item={item} saveGene={saveGene} />}

        <div className="td-card-foot">
          <span className="td-collapse" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>
            {open ? "Hide genes" : "Edit genes"}
          </span>
          <div className="td-card-foot-right">
            <span className="td-archive" onClick={(e) => { e.stopPropagation(); actions.archiveThumbnailDna(item.id); }}>Archive</span>
            <span className="td-delete" onClick={(e) => { e.stopPropagation(); onDelete(item); }}>Delete</span>
          </div>
        </div>
      </div>
    </Tile>
      )}
    </ExpandableCard>
  );
}

/* ---------- Spreadsheet / log view ---------- */
function DnaTable({ items, now, actions, onDelete }) {
  const saveGene = (item, geneKey, val) =>
    actions.updateThumbnailDna(item.id, { [geneKey]: val || null });

  return (
    <div className="td-table-wrap">
      <table className="td-table">
        <thead>
          <tr>
            <th className="td-th-thumb">Link / Title</th>
            {GENES.map(g => <th key={g.key}>{g.label}</th>)}
            <th>Status</th>
            <th className="td-th-act"></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className={"td-tr td-status--" + item.status}>
              <td className="td-td-thumb">
                <div className="td-cell-sub">
                  <a className="td-cell-title" href={item.videoUrl} target="_blank" rel="noreferrer"
                     title={item.title || item.videoUrl}>
                    {item.title || item.videoUrl}
                  </a>
                  {item.channel && <span className="td-tag sm dim">{item.channel}</span>}
                </div>
              </td>
              {GENES.map(g => (
                <td key={g.key}>
                  <EditableCell value={item[g.key]} placeholder="—"
                                onSave={v => saveGene(item, g.key, v)} />
                </td>
              ))}
              <td>
                <select className="td-cell-status" value={item.status}
                        onChange={e => actions.updateThumbnailDna(item.id, { status: e.target.value })}>
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </td>
              <td className="td-td-act">
                <button type="button" className="td-row-btn td-row-btn--archive" title="Archive"
                        onClick={() => actions.archiveThumbnailDna(item.id)}>⧉</button>
                <button type="button" className="td-row-btn td-row-btn--delete" title="Delete permanently"
                        onClick={() => onDelete(item)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Recent-thumbnails carousel (G1) ----------
   A 3-row auto-scrolling wall of ALL ingested thumbnails, shown ONLY in the
   ungrouped Cards view — a quick glance strip above the main grid, NOT the main
   view. The middle row scrolls opposite to the top and bottom rows. Each row
   continuously drifts and PING-PONGS at its edges (no jump/reset). Hovering or
   focusing the wall pauses every row so you can click a thumbnail to open its
   full expandable overlay. A small control cluster cycles the drift SPEED and
   the tile SIZE (persisted to localStorage). Respects prefers-reduced-motion
   (rows render static, no auto-scroll). Tiles reuse DnaCard (body hidden via
   CSS → thumbnail-only) so a click still opens the same overlay with controls. */
const TD_CAROUSEL_SIZES = { sm: 120, md: 164, lg: 224 };   // tile width (px)
const TD_CAROUSEL_SPEEDS = { slow: 0.2, med: 0.45, fast: 0.95 }; // px/frame
const TD_SIZE_ORDER = ["sm", "md", "lg"];
const TD_SPEED_ORDER = ["slow", "med", "fast"];
const TD_SIZE_LABEL = { sm: "S", md: "M", lg: "L" };
const TD_SPEED_LABEL = { slow: "Slow", med: "Med", fast: "Fast" };

/* One CONTINUOUSLY-scrolling row (seamless marquee — no edge, no stall).
   The row's items are rendered TWICE back-to-back (segment A + an identical
   segment B). A rAF loop translates the track and, once it has moved by exactly
   one segment's width, wraps by that width — because B is identical to A the
   wrap is invisible, so it loops forever. `dir` = -1 scrolls content left, +1
   right; `startFrac` (0..1) offsets the phase so same-direction rows are
   staggered. Live drift speed from `speedRef`, shared pause flag from
   `pausedRef`. Each segment uses a distinct idScope so the duplicated tiles
   never share a framer-motion layoutId (which would glitch click-to-expand).
   A ResizeObserver keeps the segment width current as the Size control changes
   or as newly-ingested thumbnails grow the list. */
function CarouselRow({ items, dir, startFrac = 0, speedRef, pausedRef, now, actions, onDelete }) {
  const trackRef = useRef(null);
  const segRef = useRef(null);

  useEffect(() => {
    const track = trackRef.current;
    const seg = segRef.current;
    if (!track || !seg) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let segW = seg.offsetWidth || 1;
    let offset = -segW * startFrac;                 // start phase (stagger)
    track.style.transform = `translate3d(${offset}px,0,0)`;

    // Segment width changes when tiles resize (Size control) or the list grows
    // (new thumbnails ingested) — measure off the layout, not per frame.
    const ro = new ResizeObserver(() => {
      const w = seg.offsetWidth;
      if (w > 1) segW = w;
    });
    ro.observe(seg);

    const tick = () => {
      if (!pausedRef.current && segW > 1) {
        offset += dir * speedRef.current;
        // Keep offset within (-segW, 0]; both copies are identical → seamless.
        if (offset <= -segW) offset += segW;
        else if (offset > 0) offset -= segW;
        track.style.transform = `translate3d(${offset}px,0,0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [items.length, dir, startFrac, speedRef, pausedRef]);

  const seg = (scope, hidden) => (
    <div className="td-carousel-seg" ref={hidden ? undefined : segRef} aria-hidden={hidden || undefined}>
      {items.map(item => (
        // scope-prefixed key + idScope so the two copies (and the main grid)
        // never share a React key or a framer-motion layoutId.
        <div key={`${scope}-${item.id}`} className="td-carousel-item">
          <DnaCard item={item} now={now} actions={actions} onDelete={onDelete} idScope={scope} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="td-carousel-viewport">
      <div className="td-carousel-track" ref={trackRef}>
        {seg("carousel-a", false)}
        {seg("carousel-b", true)}
      </div>
    </div>
  );
}

function RecentThumbCarousel({ items, now, actions, onDelete }) {
  const pausedRef = useRef(false);
  const [size, setSize] = useState(() => {
    try { return localStorage.getItem("td_carousel_size") || "md"; } catch { return "md"; }
  });
  const [speed, setSpeed] = useState(() => {
    try { return localStorage.getItem("td_carousel_speed") || "med"; } catch { return "med"; }
  });

  // Live drift speed in a ref so changing it never re-subscribes the rAF loops.
  const speedRef = useRef(TD_CAROUSEL_SPEEDS[speed] || TD_CAROUSEL_SPEEDS.med);
  useEffect(() => { speedRef.current = TD_CAROUSEL_SPEEDS[speed] || TD_CAROUSEL_SPEEDS.med; }, [speed]);
  useEffect(() => { try { localStorage.setItem("td_carousel_size", size); } catch {} }, [size]);
  useEffect(() => { try { localStorage.setItem("td_carousel_speed", speed); } catch {} }, [speed]);

  // Interleave ALL thumbnails across 3 rows (i % 3) → even length + spread.
  const rows = useMemo(() => {
    const r = [[], [], []];
    items.forEach((it, i) => r[i % 3].push(it));
    return r;
  }, [items]);

  const cycleSize = () => setSize(s => TD_SIZE_ORDER[(TD_SIZE_ORDER.indexOf(s) + 1) % 3]);
  const cycleSpeed = () => setSpeed(s => TD_SPEED_ORDER[(TD_SPEED_ORDER.indexOf(s) + 1) % 3]);

  const pause = () => { pausedRef.current = true; };
  const resume = () => { pausedRef.current = false; };
  const rowProps = { speedRef, pausedRef, now, actions, onDelete };

  return (
    <div
      className="td-carousel"
      style={{ "--td-carousel-w": (TD_CAROUSEL_SIZES[size] || 164) + "px" }}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={resume}
    >
      <div className="td-carousel-controls">
        <span className="td-carousel-ctl-label">Overview · {items.length}</span>
        <div className="td-carousel-ctl-group">
          <button type="button" className="td-carousel-ctl" onClick={cycleSpeed}
                  title="Cycle scroll speed">Speed: {TD_SPEED_LABEL[speed]}</button>
          <button type="button" className="td-carousel-ctl" onClick={cycleSize}
                  title="Cycle tile size">Size: {TD_SIZE_LABEL[size]}</button>
        </div>
      </div>
      {/* Rows 1 & 3 scroll left; the middle scrolls right. Different startFracs
          stagger the same-direction rows so they don't move in lockstep. */}
      <CarouselRow items={rows[0]} dir={-1} startFrac={0}    {...rowProps} />
      <CarouselRow items={rows[1]} dir={1}  startFrac={0.5}  {...rowProps} />
      <CarouselRow items={rows[2]} dir={-1} startFrac={0.5}  {...rowProps} />
    </div>
  );
}

/* ---------- Page ---------- */
export function ThumbnailDna() {
  const { thumbnailDna, actions, error } = useWorkflow();
  const { person: me } = useAuth();
  const now = useNow();

  const [statusFilter, setStatusFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // cards | table
  // Optional grouping (THM-grp). Group the catalog into collapsible sections by
  // an existing dimension — Channel, Status, or the Subject gene (≈ topic).
  // (No topic/country DB column exists; those would need a migration.)
  const [groupBy, setGroupBy] = useState("none"); // none | channel | status | subject
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (name) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // Refresh: force the YouTube-playlist poller to run now, then reload from
  // Supabase. Freshly-polled rows also arrive via the existing realtime sub,
  // but we re-poll a couple of times because the server-side poll takes a few
  // seconds. Mirrors reel-dna.jsx handleRefresh.
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: "ok"|"err", text }
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      let ytMsg = "";
      try {
        // triggerYtSync is wired by the store; guard in case it's not present
        // yet so the page still works (manual capture is unaffected).
        if (typeof actions.triggerYtSync === "function") {
          const r = await actions.triggerYtSync();
          if (r?.demo) ytMsg = "(demo — no live pull) ";
          else if (r?.skipped) ytMsg = "(playlist not configured) ";
        } else {
          ytMsg = "Playlist sync not available — reloaded anyway. ";
        }
      } catch (e) {
        ytMsg = "Playlist pull couldn't start (" + (e.message || "error") + ") — reloaded anyway. ";
      }
      const n = await actions.reloadThumbnailDna();
      // The just-started poll finishes server-side a few seconds later; pull the
      // new rows in without making the user click again.
      setTimeout(() => { actions.reloadThumbnailDna().catch(() => {}); }, 7000);
      setTimeout(() => { actions.reloadThumbnailDna().catch(() => {}); }, 16000);
      setNotice({ tone: "ok", text: `${ytMsg}Reloaded — ${n} thumbnails. New playlist videos appear within a few seconds.` });
    } catch (e) {
      setNotice({ tone: "err", text: "Refresh failed · " + (e.message || String(e)) });
    } finally {
      setRefreshing(false);
    }
  };

  const onCapture = (payload) => {
    // 409 guard — the FULL unique index (thumbnail_dna_video_id_uidx) makes a
    // double-paste of an already-captured video fail at the DB. Short-circuit
    // with a friendly notice BEFORE inserting. Tombstoned (deleted_at) rows keep
    // their video_id, but reloadThumbnailDna filters them out, so a video we
    // deleted can legitimately be re-captured.
    if (payload.videoId) {
      const dupe = (thumbnailDna || []).find(d => d.videoId === payload.videoId && !d.deletedAt);
      if (dupe) {
        setNotice({
          tone: "err",
          text: `Already captured · "${dupe.title || dupe.videoUrl}" is in your library (id ${payload.videoId}).`,
        });
        return;
      }
    }
    // C1 frozen action name — returns the item synchronously so we can patch
    // it with the oEmbed enrichment once it resolves. The displayed thumbnail
    // is client-derived and never blocks on this.
    const item = actions.createThumbnailDnaCapture({
      videoUrl: payload.videoUrl,
      videoId: payload.videoId,
      thumbnailUrl: payload.thumbnailUrl,
      genesOfInterest: payload.genesOfInterest,
      quickNotes: payload.quickNotes,
      capturedBy: me?.id || null,
    });
    setNotice(null); // clear any stale "already captured" notice on a good save
    if (item?.id) {
      // Best-effort title/channel enrichment — swallow any error.
      fetchOEmbed(payload.videoUrl).then(meta => {
        if (!meta) return;
        const patch = {};
        if (meta.title) patch.title = meta.title;
        if (meta.channel) patch.channel = meta.channel;
        if (Object.keys(patch).length) actions.updateThumbnailDna(item.id, patch);
      }).catch(() => {});
    }
  };

  const handleDelete = (item) => actions.deleteThumbnailDna(item.id);

  const visible = useMemo(() => {
    return (thumbnailDna || [])
      .filter(d => showArchived ? !!d.archivedAt : !d.archivedAt)
      .filter(d => statusFilter === "all" || d.status === statusFilter);
  }, [thumbnailDna, statusFilter, showArchived]);

  // Partition the visible captures into named groups for the chosen dimension,
  // preserving the existing (recency) order within each group (THM-grp).
  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const keyOf = (d) => {
      if (groupBy === "status") return statusLabel(d.status) || "—";
      if (groupBy === "channel") return (d.channel || "").trim() || "No channel";
      if (groupBy === "subject") return (d.subject || "").trim() || "Untagged";
      return "—";
    };
    const out = [];
    const idx = new Map();
    for (const d of visible) {
      const name = keyOf(d);
      let g = idx.get(name);
      if (!g) { g = { name, items: [] }; idx.set(name, g); out.push(g); }
      g.items.push(d);
    }
    // Alphabetical group order keeps the collapsible list stable across reloads.
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [visible, groupBy]);

  // Shared body renderer so grouped + ungrouped views stay identical.
  const renderItems = (items) =>
    viewMode === "table" ? (
      <DnaTable items={items} now={now} actions={actions} onDelete={handleDelete} />
    ) : (
      <div className="td-grid td-grid--focus">
        {items.map(item => (
          <DnaCard key={item.id} item={item} now={now} actions={actions} onDelete={handleDelete} />
        ))}
      </div>
    );

  const counts = useMemo(() => {
    const live = (thumbnailDna || []).filter(d => !d.archivedAt);
    return {
      total: live.length,
      archived: (thumbnailDna || []).length - live.length,
      byStatus: STATUSES.reduce((acc, s) => {
        acc[s.key] = live.filter(d => d.status === s.key).length; return acc;
      }, {}),
    };
  }, [thumbnailDna]);

  return (
    <div className="thumbnail-dna">
      <div className="page-head">
        <div className="titles">
          <h1>Thumbnail DNA</h1>
          <div className="sub">Capture YouTube thumbnails you like and break them into their design genes — color, typography, face, layout, mood, subject.</div>
        </div>
        <div className="actions">
          <span className="mono dim" style={{ alignSelf: "center" }}>{counts.total} captured · realtime · live</span>
          <DPill onClick={handleRefresh}
                 style={refreshing ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
            {refreshing ? "↻ Refreshing…" : "↻ Refresh"}
          </DPill>
        </div>
      </div>

      {error && <div className="td-error">error · {error}</div>}
      {notice && (
        <div className={"td-notice td-notice--" + notice.tone}>{notice.text}</div>
      )}

      <div className="td-body">
        <Card title="Capture a thumbnail" defaultOpen={true}
              footLeft="Paste a YouTube link, pick the design genes you care about, add a note.">
          <CaptureForm onCapture={onCapture} />
        </Card>

        <div className="td-filterbar">
          <span className="mono dim">status</span>
          <DPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</DPill>
          {STATUSES.map(s => (
            <DPill key={s.key} active={statusFilter === s.key} onClick={() => setStatusFilter(s.key)}>
              {s.label}{counts.byStatus[s.key] ? " · " + counts.byStatus[s.key] : ""}
            </DPill>
          ))}
          <span style={{ flex: 1 }} />
          <span className="mono dim">group</span>
          <select className="td-group-select" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            <option value="none">None</option>
            <option value="subject">Category</option>
            <option value="channel">Channel</option>
            <option value="status">Status</option>
          </select>
          <span className="mono dim">view</span>
          <DPill active={viewMode === "cards"} onClick={() => setViewMode("cards")}>Cards</DPill>
          <DPill active={viewMode === "table"} onClick={() => setViewMode("table")}>Spreadsheet</DPill>
          <span style={{ width: 12 }} />
          <DPill active={showArchived} onClick={() => setShowArchived(a => !a)}>
            {showArchived ? "Archived" : "Live"}{counts.archived ? " · " + counts.archived : ""}
          </DPill>
        </div>

        {visible.length === 0 ? (
          <div className="td-empty">
            {showArchived
              ? "No archived thumbnails."
              : "No thumbnails captured yet — paste a YouTube link above to start your thumbnail library."}
          </div>
        ) : groups ? (
          <div className="td-groups">
            {groups.map(g => {
              const isCollapsed = collapsed.has(g.name);
              return (
                <div key={g.name} className="td-group">
                  <button type="button" className="td-group-head" onClick={() => toggleGroup(g.name)}>
                    <span className="td-group-toggle">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="td-group-name">{g.name}</span>
                    <span className="td-group-count">{g.items.length}</span>
                  </button>
                  {!isCollapsed && renderItems(g.items)}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {/* G1 carousel — ungrouped Cards view only; never in table/grouped. */}
            {viewMode === "cards" && groupBy === "none" && visible.length > 0 && (
              <RecentThumbCarousel items={visible} now={now} actions={actions} onDelete={handleDelete} />
            )}
            {renderItems(visible)}
          </>
        )}
      </div>
    </div>
  );
}
