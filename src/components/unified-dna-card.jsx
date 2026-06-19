/* =========================================================
   UnifiedDnaCard — the new Reel DNA card (owner feature flag
   `unified_cards`). Drop-in replacement for DnaCard (same props),
   chosen by the renderer switch in reel-dna.jsx.

   Carries every DnaCard feature (header, gene chips + editor, brief,
   status, foot actions, attached-assets display) PLUS the daily-use
   additions the legacy card lacked:
     · per-category "+" QUICK-ATTACH popovers (multi-select existing
       footage / locations / thumbnails / news in one go),
     · inline "create + attach" for a new YouTube thumbnail and a new
       news item,
     · a "Hide assets" toggle and a "Pull from pipeline" shortcut so
       the card's information density is yours to control.

   Reuses the pure ReelAssets renderer + the existing store actions
   (attachAsset / detachAsset / seedAssetsFromPipeline / createThumbnail
   DnaCapture / createMonitorEvent). All asset types are SINGULAR
   ("footage" | "location" | "thumbnail" | "news") to match the store
   resolver and attachAsset — never the plural detach labels.
   ========================================================= */

import React, { useMemo, useState } from "react";
import "./unified-dna-card.css";
import { useWorkflow } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { personName } from "../lib/roster.jsx";
import {
  STATUSES, GENE_KEYS, platformLabel, sourceLabel, geneLabel,
} from "../lib/reel-dna.jsx";
import { extractYouTubeId, thumbnailUrlFromId } from "../lib/thumbnail-dna.jsx";
import { useReelDnaAssets } from "../lib/reel-dna-assets.jsx";
import { ReelAssets } from "./reel-assets.jsx";
import { AssetAttachPicker } from "./asset-attach-picker.jsx";
import { relTime, resolveTags, BriefBlock, GeneEditor } from "../pages/reel-dna.jsx";
import { ReelStoryPanel } from "./reel-story-panel.jsx";
import { isAnalyzing, progressPct, progressStep, progressMsg } from "../lib/reel-narrative.jsx";
import { ReelAssetsAuto } from "./reel-assets-auto.jsx";
import { PacingSparkline } from "./pacing-sparkline.jsx";

/* Build the {options, attachedIds} a picker needs for one category. */
function pickerData(options, attachedRows) {
  const attachedIds = new Set((attachedRows || []).map(r => String(r.id)));
  return { options, attachedIds };
}

export function UnifiedDnaCard({ item, now, actions, onView, onDeconstruct, onSend, onDelete, onOpenAssets, isOwner, hideAssetsOverride }) {
  // Hooks first, unconditionally (hook-rules-safe regardless of toggles below).
  const { attachedFootage, thumbnailDna, monitorEvents } = useWorkflow();
  const { locations, actions: locationActions } = useLocations();
  const { assets, counts } = useReelDnaAssets(item.id);

  const [editGenes, setEditGenes] = useState(false);
  const [hideAssets, setHideAssets] = useState(false);
  const [addKind, setAddKind] = useState(null);     // null | "thumbnail" | "news"
  const [tInput, setTInput] = useState("");          // new-thumbnail URL
  const [nTitle, setNTitle] = useState("");          // new-news title
  const [nUrl, setNUrl] = useState("");              // new-news url
  const [busy, setBusy] = useState(false);

  // Gallery-level "Hide all assets" override wins when provided (compare with
  // != null so an explicit `false` forces assets shown). Omitted = local toggle.
  const effectiveHide = hideAssetsOverride != null ? hideAssetsOverride : hideAssets;

  const genes = item.genesOfInterest || [];
  const tags = resolveTags(item);
  const hasTimeline = item.timeline && item.timeline.length > 0;
  const sourceTone = item.source === "ig_dm" ? "violet" : item.source === "share_target" ? "blue" : undefined;

  const saveGene = (geneKey, val) => actions.updateReelDna(item.id, { [geneKey]: val });
  const setStatus = (s) => actions.updateReelDna(item.id, { status: s });

  /* ── Longform "Story" analysis (Phase 0) ── owner-gated controls.
     format defaults to 'short' so existing captures are unchanged. */
  const isLong = item.format === "long";
  const mediaStatus = item.mediaStatus || "idle";
  const analyzing = isAnalyzing(mediaStatus);          // pending_analyze | analyzing
  const analyzeLabel =
    mediaStatus === "analyzed" || mediaStatus === "analyze_failed" ? "Re-analyze" : "Analyze";
  const setFormat = (fmt) => {
    if (fmt === item.format) return;
    if (typeof actions.setReelDnaFormat === "function") actions.setReelDnaFormat(item.id, fmt);
  };
  const runAnalyze = () => {
    if (analyzing) return;
    if (typeof actions.analyzeReelDna === "function") actions.analyzeReelDna(item.id);
  };

  /* ── Phase 1 reel deconstruction (format==='short') ──
     Reels reuse the SAME media_status state machine + Analyze button as
     longform (H6) but render a downloadable Assets layer + cut-pacing
     metrics instead of the Story panel. assetManifest (H3) / pacing (H4)
     arrive via the three-mapper guarantee (H5); both are null-safe so the
     section renders nothing until the worker writes them. */
  const isShort = !isLong;                       // format defaults to 'short'
  const failed = typeof mediaStatus === "string" && mediaStatus.endsWith("_failed");
  const acquireFailed = mediaStatus === "acquire_failed";
  const hasReelAssets = !!item.assetManifest || !!item.pacing;

  /* ── Normalized option lists for the four quick-attach pickers ── */
  const footageOpts = useMemo(() => (attachedFootage || []).map(f => ({
    id: f.id, label: f.filename || f.footage_file_id || "Footage",
    sublabel: f.footage_file_id && f.filename ? f.footage_file_id : undefined,
  })), [attachedFootage]);
  const locationOpts = useMemo(() => (locations || []).map(l => ({
    id: l.id, label: l.name || "Location",
  })), [locations]);
  const thumbnailOpts = useMemo(() => (thumbnailDna || []).map(t => ({
    id: t.id, label: t.title || t.videoUrl || "Thumbnail", sublabel: t.videoId || undefined,
  })), [thumbnailDna]);
  const newsOpts = useMemo(() => (monitorEvents || []).map(n => ({
    id: n.id, label: n.title || "Untitled", sublabel: n.sourceName || n.sourceUrl || undefined,
  })), [monitorEvents]);

  const fData = pickerData(footageOpts, assets?.footage);
  const lData = pickerData(locationOpts, assets?.locations);
  const tData = pickerData(thumbnailOpts, assets?.thumbnails);
  const nData = pickerData(newsOpts, assets?.news);

  /* Batched attach — one call per selected source row (upsert-deduped). */
  const attachMany = (assetType, picks) => {
    for (const p of picks) actions.attachAsset(item.id, assetType, p.id, p.label);
    // If this card is ALREADY live in the pipeline, locations attached now would
    // otherwise be stranded in reel_dna_assets: sendReelDnaToPipeline only migrates
    // assets into locations.linked_reel_ids at send time (and early-returns once the
    // card has a reelId). Propagate the pin to the pipeline reel here so it also
    // shows on the Reel Detail "Filming location" card. linkReel is optimistic +
    // persisted and de-dupes, so this is safe to call alongside attachAsset.
    if (assetType === "location" && item.reelId && typeof locationActions?.linkReel === "function") {
      for (const p of picks) locationActions.linkReel(p.id, item.reelId);
    }
  };

  /* ── Inline "create new asset, then attach it" ── */
  const tVideoId = extractYouTubeId(tInput);
  const addThumbnail = () => {
    if (!tVideoId) return;
    const created = actions.createThumbnailDnaCapture({
      videoUrl: tInput.trim(),
      videoId: tVideoId,
      thumbnailUrl: thumbnailUrlFromId(tVideoId),
      capturedBy: item.capturedBy || null,
    });
    if (created?.id) actions.attachAsset(item.id, "thumbnail", created.id, created.title || created.videoUrl);
    setTInput(""); setAddKind(null);
  };
  const addNews = async () => {
    if (!nTitle.trim() || busy) return;
    setBusy(true);
    try {
      const ev = await actions.createMonitorEvent({
        title: nTitle.trim(),
        sourceUrl: nUrl.trim() || undefined,
        sourceType: "manual",
        createdBy: item.capturedBy || null,
        publishedAt: new Date().toISOString(),
      });
      if (ev?.id) actions.attachAsset(item.id, "news", ev.id, ev.title);
      setNTitle(""); setNUrl(""); setAddKind(null);
    } catch {
      /* createMonitorEvent already surfaced the error to the store */
    } finally {
      setBusy(false);
    }
  };

  const canPull = !!item.reelId && typeof actions.seedAssetsFromPipeline === "function";

  return (
    <div className={"rd-card udc-card rd-status--" + item.status}>
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

        {editGenes && (
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
            <span className="rd-deconstruct" onClick={() => onView(item)}>View DNA</span>
            <span className="rd-collapse" onClick={() => setEditGenes(o => !o)}>
              {editGenes ? "Hide genes" : "Edit genes"}
            </span>
            <span className="rd-deconstruct" onClick={() => onDeconstruct(item)}>
              {hasTimeline ? `Timeline (${item.timeline.length})` : "Deconstruct"}
            </span>
            {item.reelId ? (
              <span className="rd-tag" style={{ color: "var(--c-orange)", borderColor: "var(--c-orange)" }}>
                ▸ In pipeline · {item.reelId}
              </span>
            ) : (
              <span className="rd-send" onClick={() => onSend(item)}>→ Send to Pipeline</span>
            )}
            {isOwner && (
              <span className="udc-story-controls">
                <span className="udc-fmt-toggle" role="group" aria-label="Capture format">
                  <button type="button"
                          className={"udc-fmt" + (!isLong ? " is-on" : "")}
                          onClick={() => setFormat("short")}
                          title="Short-form capture (no story analysis)">
                    Short
                  </button>
                  <button type="button"
                          className={"udc-fmt" + (isLong ? " is-on" : "")}
                          onClick={() => setFormat("long")}
                          title="Longform — enables auto story deconstruction">
                    Long
                  </button>
                </span>
                {isLong && (
                  <button type="button"
                          className="udc-analyze"
                          disabled={analyzing}
                          onClick={runAnalyze}
                          title={analyzing ? "Deconstruction in progress…" : "Deconstruct this longform video"}>
                    {analyzing ? "Analyzing…" : analyzeLabel}
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="rd-card-foot-right">
            {item.archivedAt ? (
              <span className="rd-archive" onClick={() => actions.restoreReelDna(item.id)}>Restore</span>
            ) : (
              <span className="rd-archive" onClick={() => actions.archiveReelDna(item.id)}>Archive</span>
            )}
            <span className="rd-delete" onClick={() => onDelete(item)}>Delete</span>
          </div>
        </div>

        {/* ── Longform Story panel — ONLY for format==='long' (short cards
              render exactly as before). Presentational + null-safe. ── */}
        {isLong && <ReelStoryPanel item={item} />}

        {/* ── Phase 1 reel deconstruction — ONLY for format==='short'.
              While analyzing: live progress. On *_failed: error + (when the
              source couldn't be acquired) an "upload the file" CTA. When the
              worker has written assetManifest/pacing: downloadable asset
              layers + cut-pacing sparkline. All children are null-safe. ── */}
        {isShort && (analyzing || failed || hasReelAssets) && (
          <div className="udc-reel-deconstruct">
            {analyzing && (
              <div className="udc-reel-progress" role="status" aria-live="polite">
                <div className="udc-reel-progress-head">
                  <span className="udc-reel-progress-label">
                    {progressStep(item.progress) || "Deconstructing reel…"}
                  </span>
                  <span className="udc-reel-progress-pct">{progressPct(item.progress)}%</span>
                </div>
                <div className="udc-reel-progress-track">
                  <div className="udc-reel-progress-fill"
                       style={{ width: `${progressPct(item.progress)}%` }} />
                </div>
                {progressMsg(item.progress) && (
                  <div className="udc-reel-progress-msg">{progressMsg(item.progress)}</div>
                )}
              </div>
            )}

            {!analyzing && failed && (
              <div className="udc-reel-failed" role="alert">
                <div className="udc-reel-failed-msg">
                  ⚠ {item.mediaError || "Reel deconstruction failed."}
                </div>
                {acquireFailed && (
                  <div className="udc-reel-failed-cta">
                    Couldn't fetch the source video.{" "}
                    {isOwner && typeof actions.analyzeReelDna === "function" && (
                      <button type="button" className="udc-reel-retry" onClick={runAnalyze}>
                        Retry
                      </button>
                    )}
                    {" "}Or upload the file and re-analyze.
                  </div>
                )}
              </div>
            )}

            {!analyzing && hasReelAssets && (
              <>
                <ReelAssetsAuto item={item} isOwner={isOwner} />
                <PacingSparkline pacing={item.pacing} />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Assets column: attach toolbar + (collapsible) attached display ── */}
      <div className="rd-assets-col">
        <div className="udc-assets-bar">
          <button type="button" className="udc-assets-title" onClick={() => onOpenAssets?.(item)}
                  title="Open the full Assets page">
            Assets <span className="udc-assets-total">{counts?.total ?? 0}</span> →
          </button>
          <button type="button" className="udc-mini" onClick={() => setHideAssets(h => !h)}
                  title={hideAssets ? "Show attached assets" : "Hide attached assets"}>
            {hideAssets ? "Show assets" : "Hide assets"}
          </button>
        </div>

        <div className="udc-attach-row">
          <AssetAttachPicker wide buttonLabel="+ Footage" title="Attach footage"
            options={fData.options} attachedIds={fData.attachedIds}
            onAttach={(picks) => attachMany("footage", picks)} />
          <AssetAttachPicker wide buttonLabel="+ Location" title="Attach location"
            options={lData.options} attachedIds={lData.attachedIds}
            onAttach={(picks) => attachMany("location", picks)} />
          <AssetAttachPicker wide buttonLabel="+ Thumbnail" title="Attach thumbnail"
            options={tData.options} attachedIds={tData.attachedIds}
            onAttach={(picks) => attachMany("thumbnail", picks)} />
          <AssetAttachPicker wide buttonLabel="+ News" title="Attach news"
            options={nData.options} attachedIds={nData.attachedIds}
            onAttach={(picks) => attachMany("news", picks)} />
        </div>

        <div className="udc-create-row">
          <button type="button" className="udc-mini"
                  onClick={() => setAddKind(k => k === "thumbnail" ? null : "thumbnail")}>
            ＋ New thumbnail
          </button>
          <button type="button" className="udc-mini"
                  onClick={() => setAddKind(k => k === "news" ? null : "news")}>
            ＋ New news
          </button>
          {canPull && (
            <button type="button" className="udc-mini udc-mini--green"
                    onClick={() => actions.seedAssetsFromPipeline(item)}
                    title="Pull footage / locations / news already linked to this reel in the pipeline">
              ↓ Pull from pipeline
            </button>
          )}
        </div>

        {addKind === "thumbnail" && (
          <div className="udc-addform">
            <input className="udc-addinput" autoFocus placeholder="Paste a YouTube link…"
                   value={tInput} onChange={e => setTInput(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") addThumbnail(); if (e.key === "Escape") setAddKind(null); }} />
            {tInput.trim() && !tVideoId && <div className="udc-addhint">No YouTube id found in that link.</div>}
            <button type="button" className="udc-addgo" disabled={!tVideoId} onClick={addThumbnail}>Add + attach</button>
          </div>
        )}
        {addKind === "news" && (
          <div className="udc-addform">
            <input className="udc-addinput" autoFocus placeholder="Headline / title…"
                   value={nTitle} onChange={e => setNTitle(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") addNews(); if (e.key === "Escape") setAddKind(null); }} />
            <input className="udc-addinput" placeholder="Source URL (optional)"
                   value={nUrl} onChange={e => setNUrl(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") addNews(); if (e.key === "Escape") setAddKind(null); }} />
            <button type="button" className="udc-addgo" disabled={!nTitle.trim() || busy} onClick={addNews}>
              {busy ? "Adding…" : "Add + attach"}
            </button>
          </div>
        )}

        {!effectiveHide && (
          <div className="udc-assets-body">
            <ReelAssets item={item} assets={assets} allOpen={true} compact={false}
                        isOwner={isOwner} actions={actions} />
          </div>
        )}
      </div>
    </div>
  );
}

export default UnifiedDnaCard;
