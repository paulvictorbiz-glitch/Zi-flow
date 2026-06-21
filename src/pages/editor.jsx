/* =========================================================
   Editor — in-app video editor tab (OpenCut embed + progress tracker).

   ── What this is ────────────────────────────────────────
   A new top-level tab that lets the owner edit a reel's cut directly in
   the dashboard instead of switching to CapCut. It embeds OpenCut (the
   open-source CapCut alternative) and tracks edit progress per reel in
   the Supabase `edit_sessions` table.

   ── OpenCut research (recorded here for future maintainers) ──
   • Repo:   https://github.com/OpenCut-app/OpenCut  ("the open-source
     CapCut alternative", formerly AppCut). ~46k★.
   • License: MIT.
   • Stack:  Next.js 15 + React 18, Zustand state, Bun runtime/package
     manager (a monorepo, currently being rewritten with a Rust core).
     Because it is a *full Next.js application* (its own router, server
     components, web workers, WASM/ffmpeg pipeline), it CANNOT be imported
     as a React component into this Vite SPA. The only realistic
     integration for a Vite app is an <iframe> embed of a hosted or
     self-hosted OpenCut instance — which is what we do below.
   • Hosted instance: https://opencut.app (the classic build; a rewrite
     lives at https://new.opencut.app). All video processing happens
     locally in the browser — files never leave the machine.
   • Auto-import of our Drive links: NOT possible today. OpenCut exposes
     no documented URL/query-string/postMessage import API, and media is
     imported by the user picking local files (privacy-first design).
     So we surface each attached clip's Google Drive link with a
     "Copy link" button — the editor downloads from Drive, then drags the
     file into OpenCut manually. (If OpenCut later ships an import API or
     deep-link, wire it through OPENCUT_URL / postMessage here.)
   • Embeddability caveat: opencut.app is a Vercel-hosted Next.js app and
     MAY send `X-Frame-Options: SAMEORIGIN` or a CSP `frame-ancestors`
     that blocks third-party framing. We cannot read those headers from
     inside the iframe (cross-origin), so we detect a failed load with an
     onLoad/timeout heuristic and show a graceful fallback overlay with an
     "Open OpenCut in a new tab" button plus a note about self-hosting.

   ── Self-host path (if framing is blocked) ──────────────
   Clone OpenCut-app/OpenCut, `bun install && bun run build && bun start`
   (or deploy the `apps/web` Next.js app to your own Vercel/host). Set the
   self-host `next.config` headers to allow `frame-ancestors` for
   footagebrain.com, then point OPENCUT_URL below at that origin.
   ========================================================= */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import { getFootageFileMetadata, footageFolderLabel } from "../lib/footage-brain-client.js";
import Timeline, { buildProjectJson, timelineTotal, DEFAULT_XFADE } from "../components/editor/Timeline.jsx";
import "./editor.css";

/* api.footagebrain.com serves the render worker's HMAC-signed output paths
   (e.g. /fb/renders/<job>/output.mp4?t=…). The proxy returns a relative path. */
const RENDER_HOST = "https://api.footagebrain.com";

/* Output presets for the render (the in-app timeline → ffmpeg pipeline). */
const OUTPUT_PRESETS = [
  { key: "vertical",   label: "Vertical 1080×1920",   width: 1080, height: 1920 },
  { key: "square",     label: "Square 1080×1080",     width: 1080, height: 1080 },
  { key: "horizontal", label: "Horizontal 1920×1080", width: 1920, height: 1080 },
];

/* Pull a Google Drive file id out of any of the Drive URL shapes we store
   (/file/d/<id>/…, ?id=<id>, /open?id=<id>, /uc?id=<id>). Returns null if none. */
function extractDriveId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)
        || url.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
        || url.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/* compact mm:ss.s / s formatter for the render summary line */
function fmt2(s) {
  const n = Number(s) || 0;
  const m = Math.floor(n / 60);
  const sec = n - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
}

/* Hosted OpenCut instance the iframe loads.
   Set VITE_OPENCUT_URL in .env.local (and in Vercel env vars) to point at the
   self-hosted fork once it's deployed at editor.footagebrain.com.
   Falls back to the public instance for local dev — which will likely be blocked
   by X-Frame-Options, triggering the fallback overlay below. */
const OPENCUT_URL = import.meta.env.VITE_OPENCUT_URL || "https://opencut.app/projects";

/* If the iframe hasn't fired `onLoad` within this window we assume framing
   was blocked (X-Frame-Options / CSP) and reveal the fallback overlay. */
const IFRAME_LOAD_TIMEOUT_MS = 9000;

const STATUS_OPTIONS = [
  { value: "in_progress", label: "In progress", pill: "amber" },
  { value: "exported",    label: "Exported",    pill: "cyan" },
  { value: "approved",    label: "Approved",    pill: "ok" },
];

/* ---------- attached-footage clip row (with Drive copy) ---------- */
function ClipRow({ clip, onAdd }) {
  const driveLink = clip.drive_url || clip.drive_folder_url || null;
  const folder = footageFolderLabel(clip.source_path);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!driveLink) return;
    try {
      await navigator.clipboard.writeText(driveLink);
    } catch {
      // Clipboard API can be blocked; fall back to a transient prompt.
      window.prompt("Copy this Drive link:", driveLink);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="editor-clip">
      <div className="editor-clip-name">{clip.filename || "(unnamed clip)"}</div>
      <div className="editor-clip-meta">
        {folder ? `📁 ${folder} · ` : ""}
        {clip.duration_seconds ? `${clip.duration_seconds.toFixed(1)}s` : "—"}
        {clip.frame_rate ? ` · ${Math.round(clip.frame_rate)}fps` : ""}
      </div>
      <div className="editor-clip-actions">
        {onAdd && (
          <button
            className="editor-btn primary"
            onClick={() => onAdd(clip)}
            disabled={!clip.driveId}
            title={clip.driveId ? "Add this clip to the timeline" : "No Drive source id — can't render this clip"}
          >
            + Timeline
          </button>
        )}
        {driveLink ? (
          <>
            <button className="editor-btn" onClick={copy} title={driveLink}>
              {copied ? "✓ Copied" : "⧉ Copy link"}
            </button>
            <a
              className="editor-btn"
              href={driveLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this clip on Google Drive"
            >
              ↗ Drive
            </a>
          </>
        ) : (
          <span className="editor-clip-meta" style={{ alignSelf: "center" }}>
            no Drive link
          </span>
        )}
      </div>
    </div>
  );
}

/* ========================================================= */
export function VideoEditor({ reel: initialReel, onOpen, reelDnaId }) {
  const { reels, attachedFootage, actions } = useWorkflow();
  const { person: me } = useAuth();

  /* Reel selection — default to the reel passed in (e.g. the one open in
     Reel detail), else the first non-archived reel. */
  const liveReels = useMemo(
    () => reels.filter(r => !r.archivedAt),
    [reels]
  );
  const [reelId, setReelId] = useState(initialReel?.id || null);
  useEffect(() => {
    if (initialReel?.id) setReelId(initialReel.id);
  }, [initialReel?.id]);
  // Land on a sensible default once reels hydrate.
  useEffect(() => {
    if (!reelId && liveReels.length) setReelId(liveReels[0].id);
  }, [reelId, liveReels]);

  const reel = useMemo(
    () => reels.find(r => r.id === reelId) || null,
    [reels, reelId]
  );

  /* Attached footage for the selected reel — same source detail.jsx uses
     (the store's attachedFootage rows). The footage table has no drive
     column, so we recover each clip's Drive link via a live FootageBrain
     lookup by footage_file_id (mirrors detail.jsx). */
  const reelClipsRaw = useMemo(
    () => attachedFootage.filter(f => f.reel_id === reelId),
    [attachedFootage, reelId]
  );

  const [driveById, setDriveById] = useState({});
  useEffect(() => {
    const missing = [...new Set(reelClipsRaw.map(f => f.footage_file_id).filter(Boolean))]
      .filter(id => !(id in driveById));
    if (!missing.length) return;
    let alive = true;
    (async () => {
      const updates = {};
      await Promise.all(missing.map(async id => {
        try {
          const file = await getFootageFileMetadata(id);
          updates[id] = { drive_url: file?.drive_url || null, drive_folder_url: file?.drive_folder_url || null };
        } catch { updates[id] = { drive_url: null, drive_folder_url: null }; }
      }));
      if (alive) setDriveById(prev => ({ ...prev, ...updates }));
    })();
    return () => { alive = false; };
  }, [reelClipsRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const reelClips = useMemo(() => {
    // Drive link also lives in the reel's detail blob (footageDrive map /
    // aiDraft clips) for clips attached before live-lookup support.
    const det = reel?.detail || {};
    const footageDrive = det.footageDrive || {};
    const aiClips = det.aiDraft?.clips || [];
    const byKey = {};
    aiClips.forEach(c => {
      const info = { drive_url: c.drive_url || null, drive_folder_url: c.drive_folder_url || null };
      if (c.clip_id) byKey[c.clip_id] = info;
      if (c.filename) byKey[c.filename] = info;
    });
    return reelClipsRaw.map(f => {
      const fetched = driveById[f.footage_file_id] || {};
      const hit = footageDrive[f.footage_file_id] || byKey[f.footage_file_id] || byKey[f.filename] || {};
      const drive_url = f.drive_url || hit.drive_url || fetched.drive_url || null;
      const drive_folder_url = f.drive_folder_url || hit.drive_folder_url || fetched.drive_folder_url || null;
      return {
        ...f,
        drive_url,
        drive_folder_url,
        driveId: extractDriveId(drive_url) || extractDriveId(drive_folder_url),
      };
    });
  }, [reelClipsRaw, reel?.detail, driveById]);

  /* Timeline ⇄ OpenCut view — declared here (before the iframe-load effect that
     reads it in its dep array) to avoid a temporal-dead-zone access. */
  const [view, setView] = useState("timeline");          // timeline | opencut

  /* ---------- iframe load detection ---------- */
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);   // bump to retry the embed
  const loadedRef = useRef(false);
  useEffect(() => {
    if (view !== "opencut") return;   // only arm detection when the iframe is mounted
    loadedRef.current = false;
    setIframeBlocked(false);
    const t = setTimeout(() => {
      // If onLoad never fired, the frame was almost certainly refused.
      if (!loadedRef.current) setIframeBlocked(true);
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [iframeKey, view]);

  /* ===================== edit_sessions ===================== */
  const [session, setSession] = useState(null);
  const [sessionState, setSessionState] = useState("loading"); // loading | ready | missing | error
  const [status, setStatus] = useState("in_progress");
  const [exportUrl, setExportUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  /* ===================== timeline + render ===================== */
  const [timeline, setTimeline] = useState([]);          // assembled clip blocks
  const [outputKey, setOutputKey] = useState("vertical");
  const [fps, setFps] = useState(30);
  const [renderJob, setRenderJob] = useState(null);      // { id, status, progress, outputUrl, error }
  const [rendering, setRendering] = useState(false);     // submit in flight
  const [renderMsg, setRenderMsg] = useState("");        // inline error/info

  const timelineKeyRef = useRef(0);   // stable id source for new timeline blocks

  // Add an attached clip to the timeline (full-length by default).
  const addToTimeline = useCallback((clip) => {
    if (!clip.driveId) return;
    const dur = Number(clip.duration_seconds) || 0;
    setTimeline(prev => [...prev, {
      id: `tl_${Date.now()}_${timelineKeyRef.current++}`,
      clipId: clip.footage_file_id || clip.id,
      driveId: clip.driveId,
      filename: clip.filename || "(clip)",
      sourceDuration: dur,
      trimIn: 0,
      trimOut: dur > 0 ? dur : 10,
      transition: { type: "cut", duration: DEFAULT_XFADE },
    }]);
  }, []);

  // Load (or note the absence of) this reel's session whenever the reel changes.
  useEffect(() => {
    if (!reelId) { setSessionState("ready"); setSession(null); return; }
    let alive = true;
    setSessionState("loading");
    (async () => {
      const { data, error } = await supabase
        .from("edit_sessions")
        .select("*")
        .eq("reel_id", reelId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (!alive) return;
      if (error) {
        // Table or columns missing → degrade gracefully, never hard-crash.
        const msg = error.message || "";
        if (/edit_sessions|relation|column|does not exist|schema cache/i.test(msg)) {
          setSessionState("missing");
        } else {
          console.error("edit_sessions load:", msg);
          setSessionState("error");
        }
        setSession(null);
        return;
      }
      const row = (data && data[0]) || null;
      setSession(row);
      setStatus(row?.status || "in_progress");
      setExportUrl(row?.export_url || "");
      setNotes(row?.edit_plan?.notes || "");
      setTimeline(Array.isArray(row?.edit_plan?.timeline) ? row.edit_plan.timeline : []);
      setRenderJob(null);
      setRenderMsg("");
      setSessionState("ready");
    })();
    return () => { alive = false; };
  }, [reelId]);

  const saveSession = async () => {
    if (!reelId) return;
    setSaving(true);
    const now = new Date().toISOString();
    // Preserve any existing edit_plan keys; we own `notes` + the assembled `timeline`.
    const edit_plan = { ...(session?.edit_plan || {}), notes, timeline };
    const clips_used = reelClips.map(c => c.footage_file_id).filter(Boolean);

    const payload = {
      reel_id: reelId,
      editor_id: me?.id || null,
      status,
      export_url: exportUrl.trim() || null,
      edit_plan,
      clips_used,
      last_active: now,
      updated_at: now,
    };

    let result;
    if (session?.id) {
      result = await supabase.from("edit_sessions").update(payload).eq("id", session.id).select().single();
    } else {
      // First save for this reel — create the session (one active per reel).
      result = await supabase
        .from("edit_sessions")
        .insert({ ...payload, started_at: now })
        .select()
        .single();
    }
    setSaving(false);
    if (result.error) {
      const msg = result.error.message || "";
      if (/edit_sessions|relation|column|does not exist|schema cache/i.test(msg)) {
        setSessionState("missing");
      } else {
        console.error("edit_sessions save:", msg);
        window.alert("Could not save edit progress: " + msg);
      }
      return;
    }
    setSession(result.data);
    setSavedAt(new Date());

    /* edit_sessions is a private tracker — the pipeline card is what the
       reviewer actually sees. Saving an Exported session with a link offers
       to push it onto the card: attachUrl feeds the review queue's
       "Current reel state" link, and the stage move puts it in that queue. */
    if (status === "exported" && exportUrl.trim() && reel) {
      const url = exportUrl.trim();
      const needsUrl = reel.attachUrl !== url;
      const canSubmit = reel.stage === "not_started" || reel.stage === "in_progress";
      if (needsUrl || canSubmit) {
        const q = canSubmit
          ? "Also set this link as the reel's \"Current reel state\" and submit it for review?"
          : "Also set this link as the reel's \"Current reel state\"?";
        if (window.confirm(q)) {
          if (needsUrl) actions.updateReel(reel.id, { attachUrl: url });
          if (canSubmit) actions.moveStage(reel.id, { stage: "review" });
        }
      }
    }
  };

  /* ---------- render: submit the assembled timeline to the worker ---------- */
  const renderableCount = useMemo(() => timeline.filter(it => it.driveId).length, [timeline]);

  const submitRender = useCallback(async () => {
    const items = timeline.filter(it => it.driveId);
    if (!items.length) { setRenderMsg("Add at least one clip with a Drive source to the timeline."); return; }
    const preset = OUTPUT_PRESETS.find(p => p.key === outputKey) || OUTPUT_PRESETS[0];
    const project_json = buildProjectJson(items, { width: preset.width, height: preset.height, fps, crf: 23 });

    setRendering(true);
    setRenderMsg("");
    try {
      const { data: { session: sess } } = await supabase.auth.getSession();
      if (!sess) { setRenderMsg("Not signed in — render skipped."); return; }
      const r = await fetch("/api/ai/suggest?action=render-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.access_token}` },
        body: JSON.stringify({
          project_id: reelId,
          reel_dna_id: reelDnaId || null,
          project_json,
          render_mode: "draft",
          submitted_by: me?.id || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Surface the worker's real error (409 single-flight, 429 queue full, 403 owner-only, 502 worker down).
        const why = r.status === 409 ? "A render is already running for this reel."
                  : r.status === 429 ? "Render queue is full — try again shortly."
                  : r.status === 403 ? "Rendering is owner-only."
                  : (d.error || d.detail || `HTTP ${r.status}`);
        setRenderMsg(`Render failed: ${why}`);
        return;
      }
      if (!d.job_id) { setRenderMsg("Render submitted but no job id returned."); return; }
      setRenderJob({ id: d.job_id, status: "queued", progress: 0, outputUrl: null, error: null });
    } catch (e) {
      setRenderMsg(`Couldn't reach the render service: ${e.message}`);
    } finally {
      setRendering(false);
    }
  }, [timeline, outputKey, fps, reelId, reelDnaId, me?.id]);

  // Poll the job's status while it's queued/rendering. Stops on done/failed.
  useEffect(() => {
    const id = renderJob?.id;
    if (!id) return;
    if (renderJob.status === "done" || renderJob.status === "failed") return;
    let alive = true;
    const tick = async () => {
      try {
        const { data: { session: sess } } = await supabase.auth.getSession();
        if (!sess) return;
        const r = await fetch(`/api/ai/suggest?action=render-status&id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setRenderJob(j => (j && j.id === id) ? { ...j, status: "failed", error: d.error || `HTTP ${r.status}` } : j);
          return;
        }
        setRenderJob(j => (j && j.id === id) ? {
          ...j,
          status: d.status || j.status,
          progress: typeof d.progress === "number" ? d.progress : j.progress,
          outputUrl: d.output_url || j.outputUrl,
          error: d.error || null,
        } : j);
      } catch { /* transient — keep polling */ }
    };
    const handle = setInterval(tick, 2500);
    tick();
    return () => { alive = false; clearInterval(handle); };
  }, [renderJob?.id, renderJob?.status]);

  // Promote a finished render to the reel's export link (reuses saveSession's flow).
  const useRenderAsExport = useCallback(() => {
    if (!renderJob?.outputUrl) return;
    const full = renderJob.outputUrl.startsWith("http") ? renderJob.outputUrl : RENDER_HOST + renderJob.outputUrl;
    setExportUrl(full);
    setStatus("exported");
    setRenderMsg("Set as export link — click \"Save progress\" to push it to the reel.");
  }, [renderJob]);

  const statusMeta = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];

  return (
    <div className="editor-page">
      <div className="page-head" style={{ padding: "16px 0 4px" }}>
        <div className="titles">
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            Editor
            <span className={"editor-pill " + statusMeta.pill}>{statusMeta.label}</span>
          </h1>
          <div className="sub">
            Cut reels in-app with OpenCut, then track progress here. Media is imported
            into OpenCut manually — copy a clip's Drive link, download it, and drag it in.
          </div>
        </div>
        <div className="actions" style={{ alignItems: "center", gap: 8 }}>
          {/* Timeline ⇄ OpenCut view toggle */}
          <div className="editor-viewtoggle">
            <button
              className={"editor-btn" + (view === "timeline" ? " primary" : "")}
              onClick={() => setView("timeline")}
              title="Assemble + render a cut in-app"
            >
              ⛶ Timeline
            </button>
            <button
              className={"editor-btn" + (view === "opencut" ? " primary" : "")}
              onClick={() => setView("opencut")}
              title="Advanced manual editing in OpenCut"
            >
              ▣ OpenCut
            </button>
          </div>
          {/* Reel selector */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="mono dim" style={{ fontSize: 10 }}>reel</span>
            <select
              className="editor-select"
              style={{ width: "auto", minWidth: 220 }}
              value={reelId || ""}
              onChange={e => setReelId(e.target.value || null)}
            >
              {!reelId && <option value="">Select a reel…</option>}
              {liveReels.map(r => (
                <option key={r.id} value={r.id}>
                  {(r.displayNumber ? "#" + r.displayNumber + " · " : r.id + " · ") + (r.title || "(untitled)")}
                </option>
              ))}
            </select>
          </label>
          {reel && onOpen && (
            <button className="editor-btn" onClick={() => onOpen(reel)} title="Open this reel's detail page">
              ↗ Reel detail
            </button>
          )}
        </div>
      </div>

      <div className="editor-body">
        {/* ===================== LEFT RAIL ===================== */}
        <div className="editor-rail">
          {/* Attached footage */}
          <div className="editor-card">
            <div className="editor-card-h">
              <span>{view === "timeline" ? "Attached footage · add to timeline" : "Attached footage · import into OpenCut"}</span>
              <span>{reelClips.length}</span>
            </div>
            {!reel ? (
              <div className="editor-clip-meta">Select a reel to see its clips.</div>
            ) : reelClips.length === 0 ? (
              <div className="editor-clip-meta">
                No footage attached. Add clips from this reel's detail page or the Footage tab.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {reelClips.map(c => (
                  <ClipRow key={c.id} clip={c} onAdd={view === "timeline" ? addToTimeline : undefined} />
                ))}
              </div>
            )}
          </div>

          {/* Progress tracker */}
          <div className="editor-card">
            <div className="editor-card-h">
              <span>Edit progress</span>
              {savedAt && <span style={{ color: "var(--c-green, #4ade80)" }}>saved {savedAt.toLocaleTimeString()}</span>}
            </div>

            {sessionState === "missing" ? (
              <div className="editor-clip-meta" style={{ lineHeight: 1.6 }}>
                The <code>edit_sessions</code> table isn't available yet (migration 0025).
                Progress tracking is disabled until it's created — the editor above still works.
              </div>
            ) : sessionState === "error" ? (
              <div className="editor-clip-meta" style={{ color: "var(--c-amber, #f59e0b)" }}>
                Couldn't load edit progress (see console). The editor still works.
              </div>
            ) : sessionState === "loading" ? (
              <div className="editor-clip-meta">Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>status</span>
                  <select
                    className="editor-select"
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    disabled={!reelId}
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>export / final link</span>
                  <input
                    className="editor-input"
                    type="text"
                    placeholder="https://… (Drive, Frame.io, etc.)"
                    value={exportUrl}
                    onChange={e => setExportUrl(e.target.value)}
                    disabled={!reelId}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>edit notes / plan</span>
                  <textarea
                    className="editor-textarea"
                    placeholder="Cut order, trims, what's left to do…"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    disabled={!reelId}
                  />
                </label>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="editor-btn primary"
                    onClick={saveSession}
                    disabled={!reelId || saving}
                  >
                    {saving ? "Saving…" : session ? "Save progress" : "Start tracking"}
                  </button>
                  {exportUrl.trim() && (
                    <a className="editor-btn" href={exportUrl.trim()} target="_blank" rel="noopener noreferrer">
                      ↗ Open export
                    </a>
                  )}
                  <span className="editor-clip-meta" style={{ marginLeft: "auto" }}>
                    {me?.name ? "as " + me.name : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===================== STAGE: TIMELINE or OPENCUT ===================== */}
        <div className="editor-stage">
          {view === "timeline" ? (
            <div className="editor-timeline-stage">
              <Timeline items={timeline} onChange={setTimeline} disabled={!reel} />

              {/* Render controls */}
              <div className="editor-card editor-render">
                <div className="editor-card-h">
                  <span>Render draft</span>
                  <span>{renderableCount} / {timeline.length} clip{timeline.length === 1 ? "" : "s"} renderable</span>
                </div>

                <div className="editor-render-row">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>format</span>
                    <select className="editor-select" style={{ width: "auto" }}
                      value={outputKey} onChange={e => setOutputKey(e.target.value)}>
                      {OUTPUT_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>fps</span>
                    <select className="editor-select" style={{ width: "auto" }}
                      value={fps} onChange={e => setFps(Number(e.target.value))}>
                      {[24, 30, 60].map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                  <button
                    className="editor-btn primary"
                    onClick={submitRender}
                    disabled={rendering || renderableCount === 0 || (renderJob && (renderJob.status === "queued" || renderJob.status === "rendering"))}
                    title={renderableCount === 0 ? "Add clips with a Drive source first" : "Render this cut on the server"}
                  >
                    {rendering ? "Submitting…" : "▶ Render draft"}
                  </button>
                </div>

                {/* progress / result */}
                {renderJob && (
                  <div className="editor-render-status">
                    {(renderJob.status === "queued" || renderJob.status === "rendering") && (
                      <>
                        <div className="tl-render-bar">
                          <div className="tl-render-fill" style={{ width: `${renderJob.progress || 0}%` }} />
                        </div>
                        <span className="editor-clip-meta">
                          {renderJob.status === "queued" ? "Queued…" : `Rendering… ${renderJob.progress || 0}%`}
                        </span>
                      </>
                    )}
                    {renderJob.status === "done" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="editor-pill ok">Done</span>
                        <a className="editor-btn" href={renderJob.outputUrl?.startsWith("http") ? renderJob.outputUrl : RENDER_HOST + (renderJob.outputUrl || "")}
                           target="_blank" rel="noopener noreferrer">↗ Open / download</a>
                        <button className="editor-btn primary" onClick={useRenderAsExport}>Use as export link</button>
                      </div>
                    )}
                    {renderJob.status === "failed" && (
                      <span className="editor-clip-meta" style={{ color: "var(--c-red, #ef4444)" }}>
                        Render failed: {renderJob.error || "unknown error"}
                      </span>
                    )}
                  </div>
                )}

                {renderMsg && (
                  <div className="editor-clip-meta" style={{ color: "var(--c-amber, #f59e0b)", marginTop: 6 }}>
                    {renderMsg}
                  </div>
                )}
                <div className="editor-clip-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  Final length {fmt2(timelineTotal(timeline))}. Drag a clip to reorder, drag its edges to
                  trim, click the marker between clips to switch cut ↔ crossfade. Save progress to keep the layout.
                </div>
              </div>
            </div>
          ) : (
            <>
              <iframe
                key={iframeKey}
                title="OpenCut video editor"
                src={reelDnaId ? `${OPENCUT_URL}?reel_dna_id=${encodeURIComponent(reelDnaId)}` : OPENCUT_URL}
                allow="fullscreen; clipboard-read; clipboard-write; camera; microphone"
                /* OpenCut needs same-origin + scripts for its WASM/ffmpeg pipeline;
                   allow-downloads lets exports save. No allow-top-navigation so it
                   can't navigate the dashboard away. */
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
                onLoad={() => { loadedRef.current = true; setIframeBlocked(false); }}
              />

              {iframeBlocked && (
                <div className="editor-overlay">
                  <h3>OpenCut couldn't be embedded here</h3>
                  <p>
                    The public OpenCut instance blocks being shown inside another site
                    (its <code>X-Frame-Options</code> / <code>frame-ancestors</code> policy).
                    Open it in a new tab to edit, or self-host OpenCut on an origin that
                    allows framing from footagebrain.com and point <code>OPENCUT_URL</code> at it
                    (see the comment at the top of <code>editor.jsx</code>).
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <a
                      className="editor-btn primary"
                      href={reelDnaId ? `${OPENCUT_URL}?reel_dna_id=${encodeURIComponent(reelDnaId)}` : OPENCUT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ↗ Open OpenCut in a new tab
                    </a>
                    <button className="editor-btn" onClick={() => setIframeKey(k => k + 1)}>
                      ↻ Retry embed
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoEditor;
