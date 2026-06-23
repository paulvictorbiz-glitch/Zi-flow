/* =========================================================
   Editor — collaborative multi-track in-app video editor.

   ── What this is ────────────────────────────────────────
   The OpenCut-style project editor. It is reached EITHER:
     • from the Projects browser  → app.jsx passes `editingProjectId`
       (we loadEditProject(id) and edit that project), OR
     • from a reel's detail / Reel DNA  → app.jsx passes `reel`
       (+ optional reelDnaId); we resolve-or-create a project bound to
       that reel (createEditProject) and edit it.

   Collaboration model (consumed from ../lib/editor-collab.jsx, contract C4):
     • project-level SINGLE-WRITER lock (useProjectLock) — one holder at a
       time, "Take control" / "Release control", live presence avatars +
       an "X is editing" pill.
     • when NOT the holder the Timeline is READ-ONLY (disabled) and live-
       updates via useProjectTimelineSync (the holder's saved timeline_json
       streams in over realtime).
     • when holder, every edit calls the store's DEBOUNCED
       saveEditProjectTimeline (holder-guarded server-side too).

   Timeline data is the v2 multi-track doc:
     { version:2, output, duration, tracks:[ video | audio | text ] }
   built/normalized by Timeline.jsx (buildProjectJsonV2 / normalizeTimeline).

   ── Captions + silence (ED3) ────────────────────────────
   • Auto-captions: submitCaptions(projectId, sourceDriveId) → poll
     pollCaptions → build/replace a type:"text" captions track from the
     returned captions[] (each { start, end, text }) styled DEFAULT_CAPTION_STYLE.
   • Silence / filler trim: submitSilenceScan → pollSilence → render the
     suggestedCuts as removable highlight regions on the chosen video clip
     with per-range accept/reject; "Apply kept" SPLITS that video clip at
     the KEPT ranges (a pure client transform — multiple sequential clips on
     the SAME source_drive_id with adjusted trimIn/trimOut — never auto-applied).

   ── Render (ED4) ────────────────────────────────────────
   buildProjectJsonV2(tracks, output) → submitProjectRender / pollRenderJob
   (authenticated, editors may render DRAFTS). Output presets + the promote-
   render-to-export-link flow are preserved. "+ Add music" drops an audio clip
   onto an audio track from the music library OR an attached-footage Drive id.

   ── Frozen contracts consumed (never opened) ────────────
     · store actions via useWorkflow() (C3)
     · useProjectLock / useProjectTimelineSync from ../lib/editor-collab.jsx (C4)
     · buildProjectJsonV2 / normalizeTimeline from Timeline.jsx
     · props editingProjectId + onBackToProjects (C8), plus reel/onOpen/reelDnaId
   Export name VideoEditor is FROZEN.
   ========================================================= */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import { getFootageFileMetadata, footageFolderLabel } from "../lib/footage-brain-client.js";
import Timeline, {
  buildProjectJsonV2,
  normalizeTimeline,
  timelineTotal,
  DEFAULT_XFADE,
} from "../components/editor/Timeline.jsx";
import { useProjectLock, useProjectTimelineSync } from "../lib/editor-collab.jsx";
import "./editor.css";

/* ── FAIL LOUDLY if a frozen contract name is missing (ED5). ── */
for (const [name, fn] of [
  ["buildProjectJsonV2", buildProjectJsonV2],
  ["normalizeTimeline", normalizeTimeline],
  ["useProjectLock", useProjectLock],
  ["useProjectTimelineSync", useProjectTimelineSync],
]) {
  if (typeof fn !== "function") {
    throw new Error(`[editor.jsx] missing frozen contract: ${name} — refusing to mount.`);
  }
}

/* api.footagebrain.com serves the render worker's HMAC-signed output paths. */
const RENDER_HOST = "https://api.footagebrain.com";

/* Output presets for the render (the in-app timeline → ffmpeg pipeline). */
const OUTPUT_PRESETS = [
  { key: "vertical",   label: "Vertical 1080×1920",   width: 1080, height: 1920 },
  { key: "square",     label: "Square 1080×1080",     width: 1080, height: 1080 },
  { key: "horizontal", label: "Horizontal 1920×1080", width: 1920, height: 1080 },
];

/* Default caption style applied to every clip on the auto-captions text track.
   Mirrors the text-clip style schema buildProjectJsonV2 expects. */
export const DEFAULT_CAPTION_STYLE = {
  font: "sans",
  size: 42,
  color: "#ffffff",
  bg: "rgba(0,0,0,0.55)",
  position: "bottom",
};

const CAPTIONS_TRACK_ID = "captions_auto"; // sentinel id for the auto-captions text track

/* Pull a Google Drive file id out of any of the Drive URL shapes we store. */
function extractDriveId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)
        || url.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
        || url.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/* compact mm:ss.s / s formatter */
function fmt2(s) {
  const n = Number(s) || 0;
  const m = Math.floor(n / 60);
  const sec = n - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
}

let _seq = 0;
const localId = (p) => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

/* ---------- v2 doc helpers (pure, local) ---------- */

const EMPTY_V2 = (output) => ({
  version: 2,
  output: output || { width: 1080, height: 1920, fps: 30, crf: 23 },
  duration: 0,
  tracks: [{ id: "video_0", type: "video", name: "Main video", clips: [] }],
});

/** The first video track of a v2 doc (or null). */
function firstVideoTrack(tracks) {
  return (tracks || []).find((t) => t.type === "video") || null;
}

/* ---------- attached-footage clip row (with Drive copy) ---------- */
function ClipRow({ clip, onAddVideo, onAddAudio }) {
  const driveLink = clip.drive_url || clip.drive_folder_url || null;
  const folder = footageFolderLabel(clip.source_path);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!driveLink) return;
    try {
      await navigator.clipboard.writeText(driveLink);
    } catch {
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
        {onAddVideo && (
          <button
            className="editor-btn primary"
            onClick={() => onAddVideo(clip)}
            disabled={!clip.driveId}
            title={clip.driveId ? "Add this clip to the video track" : "No Drive source id — can't render this clip"}
          >
            + Video
          </button>
        )}
        {onAddAudio && (
          <button
            className="editor-btn"
            onClick={() => onAddAudio(clip)}
            disabled={!clip.driveId}
            title={clip.driveId ? "Drop this clip's audio onto the audio track" : "No Drive source id"}
          >
            + Audio
          </button>
        )}
        {driveLink ? (
          <>
            <button className="editor-btn" onClick={copy} title={driveLink}>
              {copied ? "✓ Copied" : "⧉ Copy link"}
            </button>
            <a className="editor-btn" href={driveLink} target="_blank" rel="noopener noreferrer" title="Open on Google Drive">
              ↗ Drive
            </a>
          </>
        ) : (
          <span className="editor-clip-meta" style={{ alignSelf: "center" }}>no Drive link</span>
        )}
      </div>
    </div>
  );
}

/* ---------- presence avatar bubble ---------- */
function PresenceAvatar({ p }) {
  const name = p.name || p.person_id || "?";
  const initials = String(name).trim().slice(0, 2).toUpperCase();
  return (
    <span
      className={"editor-presence" + (p.is_editing ? " editing" : "")}
      style={{ background: p.color || "#6366f1" }}
      title={`${name}${p.is_editing ? " · editing" : ""}`}
    >
      {initials}
    </span>
  );
}

/* ========================================================= */
export function VideoEditor({ reel: initialReel, onOpen, reelDnaId, editingProjectId, onBackToProjects }) {
  const { reels, attachedFootage, editProjects, musicTracks, actions } = useWorkflow();
  const { person: me } = useAuth();

  /* ===================== project resolution ===================== */
  const [projectId, setProjectId] = useState(editingProjectId || null);
  const [projectState, setProjectState] = useState("loading"); // loading | ready | error
  const [projectErr, setProjectErr] = useState("");
  const resolvingRef = useRef(false);

  const project = useMemo(
    () => (editProjects || []).find((p) => p.id === projectId) || null,
    [editProjects, projectId]
  );

  /* Resolve-or-create the working project on mount / when inputs change:
     · editingProjectId given → loadEditProject(id)
     · else → find an existing project bound to this reel, else create one. */
  useEffect(() => {
    let alive = true;
    setProjectErr("");

    (async () => {
      // (1) explicit project id from the Projects browser
      if (editingProjectId) {
        setProjectId(editingProjectId);
        // already in the store? then we're ready; otherwise load it.
        const have = (editProjects || []).some((p) => p.id === editingProjectId);
        if (have) { setProjectState("ready"); return; }
        setProjectState("loading");
        const res = await actions.loadEditProject(editingProjectId);
        if (!alive) return;
        if (res?.ok) setProjectState("ready");
        else { setProjectErr(res?.error || "Couldn't load this project."); setProjectState("error"); }
        return;
      }

      // (2) reel-driven: resolve-or-create a project for the selected reel
      const reelId = initialReel?.id || null;
      if (!reelId) { setProjectState("ready"); setProjectId(null); return; }

      // an existing project already bound to this reel?
      const existing = (editProjects || []).find((p) => p.reelId === reelId);
      if (existing) { setProjectId(existing.id); setProjectState("ready"); return; }

      if (resolvingRef.current) return;
      resolvingRef.current = true;
      setProjectState("loading");
      const res = await actions.createEditProject({
        reelId,
        reelDnaId: reelDnaId || initialReel?.reelDnaId || null,
        title: initialReel?.title || "Untitled edit",
      });
      resolvingRef.current = false;
      if (!alive) return;
      if (res?.ok && res.project?.id) {
        setProjectId(res.project.id);
        setProjectState("ready");
      } else {
        setProjectErr(res?.error || "Couldn't create a project for this reel.");
        setProjectState("error");
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProjectId, initialReel?.id]);

  /* ===================== timeline doc (v2) ===================== */
  const [doc, setDoc] = useState(() => EMPTY_V2());
  const versionRef = useRef(0);              // last version we know about (echo guard)
  const hydratedForRef = useRef(null);       // which projectId we last hydrated from the store

  // Hydrate the editor's doc from the loaded project (once per project id,
  // or whenever the store row's version advances while we are NOT editing).
  useEffect(() => {
    if (!project) return;
    const incoming = normalizeTimeline(project.timelineJson, EMPTY_V2().output);
    const v = Number(project.version) || 0;
    if (hydratedForRef.current !== project.id) {
      hydratedForRef.current = project.id;
      versionRef.current = v;
      setDoc(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* ===================== collaboration lock ===================== */
  const { presences, lockState, takeControl, releaseControl, updatePlayhead } =
    useProjectLock(projectId, me);
  const iAmHolder = !!lockState.iAmHolder;

  // Viewer live-stream: when NOT holder, the holder's saved timeline streams in.
  useProjectTimelineSync(projectId, {
    myVersion: versionRef,
    onUpdate: useCallback((timelineJson, incomingVersion) => {
      // Holder ignores echoes of its own writes (the store guard + version ref
      // already drop <=local). A viewer applies the streamed doc.
      if (iAmHolder) return;
      if (typeof incomingVersion === "number") versionRef.current = incomingVersion;
      setDoc(normalizeTimeline(timelineJson, EMPTY_V2().output));
    }, [iAmHolder]),
  });

  /* Commit a new doc. Holder → optimistic local + DEBOUNCED persist.
     Non-holder → no-op (Timeline is disabled, but guard anyway). */
  const commitDoc = useCallback((next) => {
    if (!iAmHolder || !projectId) return;
    setDoc(next);
    actions.saveEditProjectTimeline(projectId, next, true);
  }, [iAmHolder, projectId, actions]);

  // Timeline onChange handler: it passes the next TRACKS array (v2 mode).
  const onTracksChange = useCallback((nextTracks) => {
    commitDoc({ ...doc, tracks: nextTracks });
  }, [doc, commitDoc]);

  /* Mutate the first video track's clips (used by footage add + silence split). */
  const mutateVideoClips = useCallback((mut) => {
    const tracks = doc.tracks || [];
    const vt = firstVideoTrack(tracks);
    let nextTracks;
    if (vt) {
      nextTracks = tracks.map((t) => (t.id === vt.id ? { ...t, clips: mut(t.clips || []) } : t));
    } else {
      nextTracks = [{ id: "video_0", type: "video", name: "Main video", clips: mut([]) }, ...tracks];
    }
    commitDoc({ ...doc, tracks: nextTracks });
  }, [doc, commitDoc]);

  /* Append (or merge into) an audio track. */
  const addAudioClip = useCallback((clip) => {
    const tracks = doc.tracks || [];
    const at = tracks.find((t) => t.type === "audio");
    // place new audio at the end of the current timeline
    const startAt = timelineTotal((firstVideoTrack(tracks)?.clips) || []) || 0;
    const dur = Number(clip.duration_seconds ?? clip.duration ?? 0) || 0;
    const audioClip = {
      id: localId("a"),
      driveId: clip.driveId,
      source_drive_id: clip.driveId,
      filename: clip.filename || clip.title || "audio",
      trimIn: 0,
      trimOut: dur > 0 ? dur : 30,
      startAt,
      volume: 1,
    };
    let nextTracks;
    if (at) {
      nextTracks = tracks.map((t) => (t.id === at.id ? { ...t, clips: [...(t.clips || []), audioClip] } : t));
    } else {
      nextTracks = [...tracks, { id: localId("audio"), type: "audio", name: "Audio", clips: [audioClip] }];
    }
    commitDoc({ ...doc, tracks: nextTracks });
  }, [doc, commitDoc]);

  /* Add a footage clip to the video track (full-length by default). */
  const addVideoClip = useCallback((clip) => {
    if (!clip.driveId) return;
    const dur = Number(clip.duration_seconds) || 0;
    mutateVideoClips((clips) => [...clips, {
      id: localId("v"),
      clipId: clip.footage_file_id || clip.id,
      driveId: clip.driveId,
      filename: clip.filename || "(clip)",
      sourceDuration: dur,
      trimIn: 0,
      trimOut: dur > 0 ? dur : 10,
      transition: { type: "cut", duration: DEFAULT_XFADE },
    }]);
  }, [mutateVideoClips]);

  /* ===================== reel / footage selection ===================== */
  // The reel a project is bound to (for the footage rail). Project takes
  // precedence; else fall back to the reel prop.
  const boundReelId = project?.reelId || initialReel?.id || null;
  const reel = useMemo(
    () => reels.find((r) => r.id === boundReelId) || initialReel || null,
    [reels, boundReelId, initialReel]
  );

  const reelClipsRaw = useMemo(
    () => attachedFootage.filter((f) => f.reel_id === boundReelId),
    [attachedFootage, boundReelId]
  );

  const [driveById, setDriveById] = useState({});
  useEffect(() => {
    const missing = [...new Set(reelClipsRaw.map((f) => f.footage_file_id).filter(Boolean))]
      .filter((id) => !(id in driveById));
    if (!missing.length) return;
    let alive = true;
    (async () => {
      const updates = {};
      await Promise.all(missing.map(async (id) => {
        try {
          const file = await getFootageFileMetadata(id);
          updates[id] = { drive_url: file?.drive_url || null, drive_folder_url: file?.drive_folder_url || null };
        } catch { updates[id] = { drive_url: null, drive_folder_url: null }; }
      }));
      if (alive) setDriveById((prev) => ({ ...prev, ...updates }));
    })();
    return () => { alive = false; };
  }, [reelClipsRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const reelClips = useMemo(() => {
    const det = reel?.detail || {};
    const footageDrive = det.footageDrive || {};
    const aiClips = det.aiDraft?.clips || [];
    const byKey = {};
    aiClips.forEach((c) => {
      const info = { drive_url: c.drive_url || null, drive_folder_url: c.drive_folder_url || null };
      if (c.clip_id) byKey[c.clip_id] = info;
      if (c.filename) byKey[c.filename] = info;
    });
    return reelClipsRaw.map((f) => {
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

  /* The chosen "primary" video source — first clip with a drive id on the
     video track, else the first attached footage clip. Drives captions +
     silence scan (both operate on a single source_drive_id). */
  const videoTrackClips = (firstVideoTrack(doc.tracks)?.clips) || [];
  const primaryDriveId = useMemo(() => {
    const onTrack = videoTrackClips.find((c) => c.driveId || c.source_drive_id);
    if (onTrack) return onTrack.driveId || onTrack.source_drive_id;
    const fromFootage = reelClips.find((c) => c.driveId);
    return fromFootage?.driveId || null;
  }, [videoTrackClips, reelClips]);

  /* ===================== captions (ED3) ===================== */
  const [capState, setCapState] = useState("idle"); // idle | running | done | error
  const [capMsg, setCapMsg] = useState("");
  const capJobRef = useRef(null);
  const capPollRef = useRef(null);

  const stopCaptionPoll = () => { if (capPollRef.current) { clearInterval(capPollRef.current); capPollRef.current = null; } };
  useEffect(() => () => stopCaptionPoll(), []);

  const buildCaptionsTrack = useCallback((captions) => {
    const clips = (captions || [])
      .filter((c) => c && (c.text != null))
      .map((c) => ({
        id: localId("cap"),
        text: c.text || "",
        startAt: Number(c.start ?? c.startAt ?? 0) || 0,
        endAt: Number(c.end ?? c.endAt ?? 0) || 0,
        style: { ...DEFAULT_CAPTION_STYLE },
      }));
    return { id: CAPTIONS_TRACK_ID, type: "text", name: "Captions", source: "whisper", clips };
  }, []);

  const runCaptions = useCallback(async () => {
    if (!iAmHolder) { setCapMsg("Take control to run auto-captions."); return; }
    if (!projectId || !primaryDriveId) { setCapMsg("Add a video clip with a Drive source first."); return; }
    setCapState("running"); setCapMsg("Submitting…");
    const sub = await actions.submitCaptions(projectId, primaryDriveId);
    if (!sub?.ok || !sub.jobId) { setCapState("error"); setCapMsg(sub?.error || "Couldn't start captions."); return; }
    capJobRef.current = sub.jobId;
    stopCaptionPoll();
    setCapMsg("Transcribing…");
    capPollRef.current = setInterval(async () => {
      const id = capJobRef.current;
      if (!id) return;
      const st = await actions.pollCaptions(id);
      if (!st?.ok) { stopCaptionPoll(); setCapState("error"); setCapMsg(st?.error || "Caption status failed."); return; }
      if (st.status === "done" || (Array.isArray(st.captions) && st.captions.length && st.status !== "rendering" && st.status !== "queued")) {
        stopCaptionPoll();
        const track = buildCaptionsTrack(st.captions);
        // Replace any existing auto-captions track; else append.
        setDoc((d) => {
          const exists = (d.tracks || []).some((t) => t.id === CAPTIONS_TRACK_ID);
          const tracks = exists
            ? (d.tracks || []).map((t) => (t.id === CAPTIONS_TRACK_ID ? track : t))
            : [...(d.tracks || []), track];
          const next = { ...d, tracks };
          actions.saveEditProjectTimeline(projectId, next, true);
          return next;
        });
        setCapState("done");
        setCapMsg(`${track.clips.length} caption${track.clips.length === 1 ? "" : "s"} added.`);
      } else if (st.status === "failed" || st.status === "error") {
        stopCaptionPoll(); setCapState("error"); setCapMsg("Caption job failed.");
      } else {
        setCapMsg(`Transcribing… ${st.progress != null ? st.progress + "%" : ""}`);
      }
    }, 2500);
  }, [iAmHolder, projectId, primaryDriveId, actions, buildCaptionsTrack]);

  /* ===================== silence / filler trim (ED3) ===================== */
  const [silState, setSilState] = useState("idle"); // idle | running | ready | error
  const [silMsg, setSilMsg] = useState("");
  const [suggestedCuts, setSuggestedCuts] = useState([]); // [{ id, start, end, rejected }]
  const [silSourceId, setSilSourceId] = useState(null);   // which drive id the cuts apply to
  const silJobRef = useRef(null);
  const silPollRef = useRef(null);
  const stopSilPoll = () => { if (silPollRef.current) { clearInterval(silPollRef.current); silPollRef.current = null; } };
  useEffect(() => () => stopSilPoll(), []);

  const runSilenceScan = useCallback(async () => {
    if (!iAmHolder) { setSilMsg("Take control to scan for silence."); return; }
    if (!projectId || !primaryDriveId) { setSilMsg("Add a video clip with a Drive source first."); return; }
    setSilState("running"); setSilMsg("Submitting…"); setSuggestedCuts([]);
    const sub = await actions.submitSilenceScan(projectId, primaryDriveId);
    if (!sub?.ok || !sub.jobId) { setSilState("error"); setSilMsg(sub?.error || "Couldn't start scan."); return; }
    silJobRef.current = sub.jobId;
    setSilSourceId(primaryDriveId);
    stopSilPoll();
    setSilMsg("Scanning…");
    silPollRef.current = setInterval(async () => {
      const id = silJobRef.current;
      if (!id) return;
      const st = await actions.pollSilence(id);
      if (!st?.ok) { stopSilPoll(); setSilState("error"); setSilMsg(st?.error || "Silence status failed."); return; }
      if (st.status === "done" || (Array.isArray(st.suggestedCuts) && st.suggestedCuts.length && st.status !== "queued" && st.status !== "rendering")) {
        stopSilPoll();
        const cuts = (st.suggestedCuts || []).map((c) => ({
          id: localId("cut"),
          start: Number(c.start ?? c.startAt ?? 0) || 0,
          end: Number(c.end ?? c.endAt ?? 0) || 0,
          rejected: false,
        })).filter((c) => c.end > c.start);
        setSuggestedCuts(cuts);
        setSilState("ready");
        setSilMsg(cuts.length ? `${cuts.length} silent region${cuts.length === 1 ? "" : "s"} found.` : "No silence detected.");
      } else if (st.status === "failed" || st.status === "error") {
        stopSilPoll(); setSilState("error"); setSilMsg("Silence scan failed.");
      } else {
        setSilMsg(`Scanning… ${st.progress != null ? st.progress + "%" : ""}`);
      }
    }, 2500);
  }, [iAmHolder, projectId, primaryDriveId, actions]);

  const toggleCut = useCallback((cutId) => {
    setSuggestedCuts((prev) => prev.map((c) => (c.id === cutId ? { ...c, rejected: !c.rejected } : c)));
  }, []);

  /* Apply the KEPT cuts: split the FIRST video clip on silSourceId into
     multiple sequential clips on the SAME source_drive_id, with the kept
     silence ranges removed. Pure client transform — never auto-applied. */
  const applyKeptCuts = useCallback(() => {
    if (!iAmHolder) return;
    const kept = suggestedCuts.filter((c) => !c.rejected).sort((a, b) => a.start - b.start);
    if (!kept.length || !silSourceId) return;

    mutateVideoClips((clips) => {
      const idx = clips.findIndex((c) => (c.driveId || c.source_drive_id) === silSourceId);
      if (idx === -1) return clips;
      const base = clips[idx];
      const inPt = Number(base.trimIn) || 0;
      const outPt = Number(base.trimOut) || (Number(base.sourceDuration) || 0);

      // Build the KEPT segments = the complement of the silence ranges within [inPt,outPt].
      const segments = [];
      let cursor = inPt;
      for (const cut of kept) {
        const cs = Math.max(inPt, cut.start);
        const ce = Math.min(outPt, cut.end);
        if (ce <= cs) continue;          // cut outside this clip's trim window
        if (cs > cursor) segments.push([cursor, cs]); // keep up to the silence
        cursor = Math.max(cursor, ce);   // skip the silence
      }
      if (cursor < outPt) segments.push([cursor, outPt]);
      if (!segments.length) return clips; // nothing kept → leave clip untouched (safety)

      const newClips = segments.map(([s, e], i) => ({
        ...base,
        id: localId("v"),
        trimIn: Math.round(s * 100) / 100,
        trimOut: Math.round(e * 100) / 100,
        // Keep cut transitions between the new segments; preserve the original
        // outgoing transition on the LAST split segment only.
        transition: i === segments.length - 1
          ? (base.transition || { type: "cut", duration: DEFAULT_XFADE })
          : { type: "cut", duration: DEFAULT_XFADE },
      }));

      return [...clips.slice(0, idx), ...newClips, ...clips.slice(idx + 1)];
    });

    setSuggestedCuts([]);
    setSilState("idle");
    setSilMsg(`Applied — split into kept segments.`);
  }, [iAmHolder, suggestedCuts, silSourceId, mutateVideoClips]);

  /* ===================== add music (ED4) ===================== */
  const [musicQuery, setMusicQuery] = useState("");
  const [musicResults, setMusicResults] = useState([]);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicMsg, setMusicMsg] = useState("");

  const runMusicSearch = useCallback(async () => {
    const q = musicQuery.trim();
    if (!q) return;
    setMusicBusy(true); setMusicMsg("");
    const res = await actions.searchMusic(q);
    setMusicBusy(false);
    if (!res?.ok) { setMusicMsg(res?.error === "epidemic_token_expired" ? "Music token expired — ask the owner to refresh." : (res?.error || "Search failed.")); setMusicResults([]); return; }
    setMusicResults(Array.isArray(res.tracks) ? res.tracks : []);
    if (!res.tracks?.length) setMusicMsg("No tracks matched.");
  }, [musicQuery, actions]);

  /* Drop a library track onto the audio track. We resolve a licensed download
     url (getMusicDownload) so the render worker can fetch it; if that's not
     available we still drop the track by id (the seam — render resolves it). */
  const addMusicTrack = useCallback(async (track) => {
    if (!iAmHolder) { setMusicMsg("Take control to add music."); return; }
    const tid = track.id ?? track.epidemic_id ?? track.trackId;
    let url = track.download_url || track.url || null;
    if (!url && typeof actions.getMusicDownload === "function" && tid != null) {
      try {
        const dl = await actions.getMusicDownload(tid);
        if (dl?.ok) url = dl.url;
      } catch { /* non-fatal — fall through to id-only drop */ }
    }
    const tracks = doc.tracks || [];
    const at = tracks.find((t) => t.type === "audio");
    const startAt = timelineTotal((firstVideoTrack(tracks)?.clips) || []) || 0;
    const dur = Number(track.length ?? track.duration ?? track.duration_seconds ?? 0) || 0;
    const audioClip = {
      id: localId("m"),
      driveId: url || undefined,            // a URL or Drive id the worker fetches
      source_drive_id: url || (tid != null ? `music:${tid}` : undefined),
      musicId: tid != null ? String(tid) : undefined,
      filename: track.title || track.name || "music",
      trimIn: 0,
      trimOut: dur > 0 ? dur : 30,
      startAt,
      volume: 0.6,
    };
    const nextTracks = at
      ? tracks.map((t) => (t.id === at.id ? { ...t, clips: [...(t.clips || []), audioClip] } : t))
      : [...tracks, { id: localId("audio"), type: "audio", name: "Music", clips: [audioClip] }];
    commitDoc({ ...doc, tracks: nextTracks });
    setMusicMsg(`Added “${audioClip.filename}” to the audio track.`);
  }, [iAmHolder, doc, commitDoc, actions]);

  /* ===================== render (ED4) ===================== */
  const [outputKey, setOutputKey] = useState("vertical");
  const [fps, setFps] = useState(30);
  const [renderJob, setRenderJob] = useState(null); // { id, status, progress, outputUrl, error }
  const [rendering, setRendering] = useState(false);
  const [renderMsg, setRenderMsg] = useState("");
  const [exportUrl, setExportUrl] = useState("");

  useEffect(() => { setExportUrl(project?.exportUrl || ""); }, [project?.id]); // eslint-disable-line

  const renderableCount = useMemo(
    () => videoTrackClips.filter((it) => it.driveId || it.source_drive_id).length,
    [videoTrackClips]
  );

  const submitRender = useCallback(async () => {
    if (!projectId) { setRenderMsg("No project loaded."); return; }
    if (!renderableCount) { setRenderMsg("Add at least one video clip with a Drive source."); return; }
    const preset = OUTPUT_PRESETS.find((p) => p.key === outputKey) || OUTPUT_PRESETS[0];
    const output = { width: preset.width, height: preset.height, fps, crf: 23 };
    const project_json = buildProjectJsonV2(doc.tracks || [], output);

    setRendering(true); setRenderMsg("");
    const res = await actions.submitProjectRender(projectId, project_json, { renderMode: "draft" });
    setRendering(false);
    if (!res?.ok || !res.jobId) { setRenderMsg(`Render failed: ${res?.error || "no job id"}`); return; }
    setRenderJob({ id: res.jobId, status: "queued", progress: 0, outputUrl: null, error: null });
  }, [projectId, renderableCount, outputKey, fps, doc, actions]);

  // Poll the render job.
  useEffect(() => {
    const id = renderJob?.id;
    if (!id) return;
    if (renderJob.status === "done" || renderJob.status === "failed") return;
    let alive = true;
    const tick = async () => {
      const st = await actions.pollRenderJob(id);
      if (!alive) return;
      if (!st?.ok) {
        setRenderJob((j) => (j && j.id === id) ? { ...j, status: "failed", error: st?.error || "status failed" } : j);
        return;
      }
      setRenderJob((j) => (j && j.id === id) ? {
        ...j,
        status: st.status || j.status,
        progress: typeof st.progress === "number" ? st.progress : j.progress,
        outputUrl: st.output_url || j.outputUrl,
        error: st.error || null,
      } : j);
    };
    const handle = setInterval(tick, 2500);
    tick();
    return () => { alive = false; clearInterval(handle); };
  }, [renderJob?.id, renderJob?.status, actions]);

  // Promote a finished render to the project's export link.
  const useRenderAsExport = useCallback(async () => {
    if (!renderJob?.outputUrl) return;
    const full = renderJob.outputUrl.startsWith("http") ? renderJob.outputUrl : RENDER_HOST + renderJob.outputUrl;
    setExportUrl(full);
    if (projectId) {
      try {
        await supabase.from("edit_projects").update({ export_url: full, status: "exported" }).eq("id", projectId);
        // refresh the store row so the link sticks across reloads
        actions.loadEditProject(projectId);
      } catch (e) {
        setRenderMsg("Saved render, but couldn't set the export link: " + (e?.message || e));
        return;
      }
    }
    setRenderMsg("Set as the project's export link.");
  }, [renderJob, projectId, actions]);

  /* ===================== render UI ===================== */
  const total = timelineTotal(videoTrackClips);
  const tracksDisabled = !iAmHolder || projectState !== "ready" || !projectId;

  return (
    <div className="editor-page">
      <div className="page-head" style={{ padding: "16px 0 4px" }}>
        <div className="titles">
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {typeof onBackToProjects === "function" && (
              <button className="editor-btn" onClick={() => onBackToProjects()} title="Back to the Projects browser">
                ← Projects
              </button>
            )}
            Editor
            <span className="editor-pill cyan">{project?.title || "—"}</span>
          </h1>
          <div className="sub">
            Collaborative multi-track editor. One person holds the edit lock at a
            time — others watch live. Take control to edit, then render a draft.
          </div>
        </div>

        {/* presence + lock controls */}
        <div className="actions" style={{ alignItems: "center", gap: 10 }}>
          <div className="editor-presence-row">
            {(presences || []).map((p) => <PresenceAvatar key={p.person_id || p.name} p={p} />)}
          </div>

          {lockState.heldBy && !iAmHolder && (
            <span className="editor-pill amber" title={`${lockState.heldByName} holds the edit lock`}>
              🔒 {lockState.heldByName} is editing
            </span>
          )}
          {iAmHolder && <span className="editor-pill ok">✎ You have control</span>}

          {iAmHolder ? (
            <button className="editor-btn" onClick={() => releaseControl()} title="Release the edit lock">
              Release control
            </button>
          ) : (
            <button
              className="editor-btn primary"
              onClick={async () => {
                const r = await takeControl();
                if (r && r.ok === false) setRenderMsg(`Couldn't take control — ${r.heldByName || "someone"} is editing.`);
              }}
              disabled={!projectId || projectState !== "ready"}
              title={lockState.heldBy ? "Take control from the current holder (if stale)" : "Take control to edit"}
            >
              {lockState.isStale ? "Take control (stale)" : "Take control"}
            </button>
          )}

          {reel && onOpen && (
            <button className="editor-btn" onClick={() => onOpen(reel)} title="Open this reel's detail page">
              ↗ Reel detail
            </button>
          )}
        </div>
      </div>

      {projectErr && (
        <div className="editor-clip-meta" style={{ color: "var(--c-red, #ef4444)", padding: "0 0 4px" }}>
          {projectErr}
        </div>
      )}

      <div className="editor-body">
        {/* ===================== LEFT RAIL ===================== */}
        <div className="editor-rail">
          {/* Attached footage */}
          <div className="editor-card">
            <div className="editor-card-h">
              <span>Attached footage · add to timeline</span>
              <span>{reelClips.length}</span>
            </div>
            {!reel ? (
              <div className="editor-clip-meta">
                {project ? "This project isn't bound to a reel — render from clips you add manually." : "Loading…"}
              </div>
            ) : reelClips.length === 0 ? (
              <div className="editor-clip-meta">
                No footage attached. Add clips from this reel's detail page or the Footage tab.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {reelClips.map((c) => (
                  <ClipRow
                    key={c.id}
                    clip={c}
                    onAddVideo={!tracksDisabled ? addVideoClip : undefined}
                    onAddAudio={!tracksDisabled ? addAudioClip : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Captions + silence */}
          <div className="editor-card">
            <div className="editor-card-h"><span>AI assist</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <button
                  className="editor-btn primary"
                  onClick={runCaptions}
                  disabled={tracksDisabled || capState === "running" || !primaryDriveId}
                  title={primaryDriveId ? "Transcribe the primary clip into a captions track" : "Add a video clip first"}
                >
                  {capState === "running" ? "Transcribing…" : "🅰 Auto-captions"}
                </button>
                {capMsg && (
                  <div className="editor-clip-meta" style={{ marginTop: 6, color: capState === "error" ? "var(--c-red,#ef4444)" : "var(--fg-mute)" }}>
                    {capMsg}
                  </div>
                )}
              </div>

              <div>
                <button
                  className="editor-btn"
                  onClick={runSilenceScan}
                  disabled={tracksDisabled || silState === "running" || !primaryDriveId}
                  title="Detect silence / filler so you can trim it"
                >
                  {silState === "running" ? "Scanning…" : "🔇 Silence / filler trim"}
                </button>
                {silMsg && (
                  <div className="editor-clip-meta" style={{ marginTop: 6, color: silState === "error" ? "var(--c-red,#ef4444)" : "var(--fg-mute)" }}>
                    {silMsg}
                  </div>
                )}

                {suggestedCuts.length > 0 && (
                  <div className="editor-cuts">
                    {suggestedCuts.map((c) => (
                      <div key={c.id} className={"editor-cut" + (c.rejected ? " rejected" : "")}>
                        <span className="editor-clip-meta">
                          {fmt2(c.start)} → {fmt2(c.end)} ({fmt2(c.end - c.start)})
                        </span>
                        <button
                          className="editor-btn"
                          onClick={() => toggleCut(c.id)}
                          title={c.rejected ? "Keep this silence (don't cut)" : "Reject — keep this region"}
                        >
                          {c.rejected ? "↺ keep silence" : "✕ reject cut"}
                        </button>
                      </div>
                    ))}
                    <button
                      className="editor-btn primary"
                      onClick={applyKeptCuts}
                      disabled={tracksDisabled || suggestedCuts.every((c) => c.rejected)}
                      title="Split the clip at the kept silence ranges"
                    >
                      ✂ Apply kept ({suggestedCuts.filter((c) => !c.rejected).length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Add music */}
          <div className="editor-card">
            <div className="editor-card-h"><span>+ Add music</span><span>{musicTracks?.length || 0} cached</span></div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="editor-input"
                type="text"
                placeholder="Search the music library…"
                value={musicQuery}
                onChange={(e) => setMusicQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runMusicSearch(); }}
                disabled={tracksDisabled}
              />
              <button className="editor-btn" onClick={runMusicSearch} disabled={tracksDisabled || musicBusy || !musicQuery.trim()}>
                {musicBusy ? "…" : "Search"}
              </button>
            </div>
            {musicMsg && <div className="editor-clip-meta" style={{ marginTop: 6 }}>{musicMsg}</div>}
            {musicResults.length > 0 && (
              <div className="editor-music-list">
                {musicResults.slice(0, 12).map((t) => (
                  <div key={t.id || t.epidemic_id} className="editor-music-row">
                    <span className="editor-clip-name" style={{ fontSize: 12 }}>{t.title || t.name || "track"}</span>
                    <button className="editor-btn primary" onClick={() => addMusicTrack(t)} disabled={tracksDisabled}>
                      + Audio
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===================== STAGE: TIMELINE ===================== */}
        <div className="editor-stage">
          <div className="editor-timeline-stage">
            {projectState === "loading" ? (
              <div className="editor-clip-meta">Loading project…</div>
            ) : (
              <>
                {!iAmHolder && (
                  <div className="editor-readonly-banner">
                    Read-only — {lockState.heldBy ? `${lockState.heldByName} is editing.` : "take control to edit."}
                    {" "}The timeline updates live as the holder saves.
                  </div>
                )}

                <Timeline
                  tracks={doc.tracks || []}
                  onChange={onTracksChange}
                  disabled={tracksDisabled}
                />

                {/* Render controls */}
                <div className="editor-card editor-render">
                  <div className="editor-card-h">
                    <span>Render draft</span>
                    <span>{renderableCount} renderable clip{renderableCount === 1 ? "" : "s"}</span>
                  </div>

                  <div className="editor-render-row">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="mono dim" style={{ fontSize: 10 }}>format</span>
                      <select className="editor-select" style={{ width: "auto" }}
                        value={outputKey} onChange={(e) => setOutputKey(e.target.value)}>
                        {OUTPUT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </label>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="mono dim" style={{ fontSize: 10 }}>fps</span>
                      <select className="editor-select" style={{ width: "auto" }}
                        value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                        {[24, 30, 60].map((f) => <option key={f} value={f}>{f}</option>)}
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

                  {exportUrl && (
                    <div className="editor-clip-meta" style={{ marginTop: 6 }}>
                      Export link:{" "}
                      <a href={exportUrl} target="_blank" rel="noopener noreferrer">↗ open</a>
                    </div>
                  )}

                  {renderMsg && (
                    <div className="editor-clip-meta" style={{ color: "var(--c-amber, #f59e0b)", marginTop: 6 }}>
                      {renderMsg}
                    </div>
                  )}
                  <div className="editor-clip-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
                    Final video length {fmt2(total)}. Drag a clip to reorder, drag edges to trim,
                    click the gap marker to switch cut ↔ crossfade. Edits autosave while you hold control.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoEditor;
