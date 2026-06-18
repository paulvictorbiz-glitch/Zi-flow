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

import React, { useState, useMemo, useEffect } from "react";
import "./thumbnail-dna.css";
import { Card, DPill } from "../components/components.jsx";
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

/* ---------- A captured thumbnail card ---------- */
function DnaCard({ item, now, actions, onDelete }) {
  const [open, setOpen] = useState(false);
  const genes = item.genesOfInterest || [];
  const title = item.title || item.videoUrl;

  const saveGene = (geneKey, val) => actions.updateThumbnailDna(item.id, { [geneKey]: val || null });
  const setStatus = (s) => actions.updateThumbnailDna(item.id, { status: s });

  return (
    <div className={"td-card td-status--" + item.status}>
      <a className="td-card-thumb" href={item.videoUrl} target="_blank" rel="noreferrer"
         title={item.videoUrl}>
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

        {genes.length > 0 && (
          <div className="td-card-genes">
            {genes.map(g => <span key={g} className="td-gene-tag">{geneLabel(g)}</span>)}
          </div>
        )}

        {open && (
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
        )}

        <div className="td-card-foot">
          <span className="td-collapse" onClick={() => setOpen(o => !o)}>
            {open ? "Hide genes" : "Edit genes"}
          </span>
          <div className="td-card-foot-right">
            <span className="td-archive" onClick={() => actions.archiveThumbnailDna(item.id)}>Archive</span>
            <span className="td-delete" onClick={() => onDelete(item)}>Delete</span>
          </div>
        </div>
      </div>
    </div>
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

/* ---------- Page ---------- */
export function ThumbnailDna() {
  const { thumbnailDna, actions, error } = useWorkflow();
  const { person: me } = useAuth();
  const now = useNow();

  const [statusFilter, setStatusFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // cards | table

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
        ) : viewMode === "table" ? (
          <DnaTable items={visible} now={now} actions={actions} onDelete={handleDelete} />
        ) : (
          <div className="td-grid">
            {visible.map(item => (
              <DnaCard key={item.id} item={item} now={now} actions={actions} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
