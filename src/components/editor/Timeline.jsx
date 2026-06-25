/* =========================================================
   Timeline — visual drag editor for the in-app render pipeline.

   ---- VIDEO TRACK (regression-critical, UNCHANGED) ----
   A single horizontal video track. Each clip is a block whose width is
   proportional to its trimmed duration. Interactions (all pointer-event
   based, no drag library):
     • drag a block BODY      → reorder (live swap as you pass neighbors)
     • drag a block EDGE      → trim in / out (clamped to the source length)
     • click the gap BADGE    → toggle cut ↔ crossfade (+ duration input)
     • ✕ on a block           → remove it from the track
     • +/- zoom               → change px-per-second

   Video clips are SEQUENTIAL (start derived from running cumulative duration
   minus xfade overlap) — they have NO startAt.

   ---- AUDIO / TEXT TRACKS (multi-track v2) ----
   Stacked below the video track. Their clips are positioned by an ABSOLUTE
   startAt (seconds from t=0). Audio rows expose a per-clip volume control +
   horizontal-drag repositioning; text rows render an editable caption that
   spans startAt → endAt.

   Controlled component: the parent owns the data and passes `onChange`.

   • Legacy (video-only) mode — pass `items` (flat array). Each item:
       { id, clipId, driveId, filename, sourceDuration, trimIn, trimOut,
         transition: { type: 'cut'|'xfade', duration } }   // transition = INTO next
     The default export renders exactly as before; `onChange(nextItems)`.

   • v2 multi-track mode — pass `tracks` (v2 track array). `onChange(nextTracks)`.

   Exports:
     trimmedDuration, timelineTotal, buildProjectJson, DEFAULT_XFADE, MIN_CLIP  (UNCHANGED)
     buildProjectJsonV2(tracks, output)  — full multi-track v2 project_json
     normalizeTimeline(any)              — legacy flat array → v2 doc
   ========================================================= */

import React, { useRef, useState, useCallback } from "react";
import "./timeline.css";

export const MIN_CLIP = 0.2;          // shortest trimmed clip (seconds)
export const DEFAULT_XFADE = 0.5;     // default crossfade length (seconds)
const MIN_BLOCK_PX = 44;              // keep handles usable for tiny clips

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function trimmedDuration(it) {
  return Math.max(0, (it?.trimOut ?? 0) - (it?.trimIn ?? 0));
}

/** Final rendered length: sum of trimmed clips minus each crossfade overlap. */
export function timelineTotal(items) {
  let total = items.reduce((s, it) => s + trimmedDuration(it), 0);
  for (let i = 0; i < items.length - 1; i++) {
    const t = items[i].transition;
    if (t && t.type === "xfade") {
      total -= Math.min(t.duration || 0, trimmedDuration(items[i]), trimmedDuration(items[i + 1]));
    }
  }
  return Math.max(0, total);
}

/** Build the worker's project_json from timeline items + an output spec.
 *  REGRESSION-CRITICAL: video-only output MUST stay byte-identical. */
export function buildProjectJson(items, output) {
  return {
    output,
    tracks: [{
      type: "video",
      clips: items.map((it, i) => {
        const isLast = i === items.length - 1;
        const xf = it.transition?.type === "xfade";
        return {
          source_drive_id: it.driveId,
          trim_in: round2(it.trimIn),
          trim_out: round2(it.trimOut),
          transition: isLast
            ? { type: "cut" }
            : xf
              ? { type: "xfade", duration: round2(it.transition.duration || DEFAULT_XFADE) }
              : { type: "cut" },
        };
      }),
    }],
  };
}

/* =========================================================
   v2 multi-track schema helpers
   ========================================================= */

/** Video-track running start: render.py-style cumulative minus xfade overlap. */
function videoClipStarts(clips) {
  const starts = [];
  let cum = 0;
  for (let i = 0; i < clips.length; i++) {
    starts.push(round2(cum));
    const dur = trimmedDuration(clips[i]);
    let overlap = 0;
    const t = clips[i].transition;
    if (i < clips.length - 1 && t && t.type === "xfade") {
      overlap = Math.min(t.duration || 0, dur, trimmedDuration(clips[i + 1]));
    }
    cum += dur - overlap;
  }
  return starts;
}

/** Advisory total duration across ALL tracks (render recomputes authoritatively). */
function tracksDuration(tracks) {
  let max = 0;
  for (const tr of tracks || []) {
    if (tr.type === "video") {
      const starts = videoClipStarts(tr.clips || []);
      (tr.clips || []).forEach((c, i) => {
        const end = (starts[i] || 0) + trimmedDuration(c);
        if (end > max) max = end;
      });
    } else if (tr.type === "audio") {
      for (const c of tr.clips || []) {
        const end = (Number(c.startAt) || 0) + trimmedDuration(c);
        if (end > max) max = end;
      }
    } else if (tr.type === "text") {
      for (const c of tr.clips || []) {
        const end = Number(c.endAt) || 0;
        if (end > max) max = end;
      }
    }
  }
  return round2(max);
}

/** Build the worker's FULL multi-track v2 project_json from tracks + output. */
export function buildProjectJsonV2(tracks, output) {
  const list = Array.isArray(tracks) ? tracks : [];
  return {
    version: 2,
    output,
    duration: tracksDuration(list),
    tracks: list.map((tr) => {
      if (tr.type === "video") {
        return {
          id: tr.id,
          type: "video",
          name: tr.name,
          clips: (tr.clips || []).map((it, i) => {
            const isLast = i === (tr.clips || []).length - 1;
            const xf = it.transition?.type === "xfade";
            return {
              id: it.id,
              source_drive_id: it.driveId ?? it.source_drive_id,
              clipId: it.clipId,
              filename: it.filename,
              sourceDuration: it.sourceDuration,
              trim_in: round2(it.trimIn),
              trim_out: round2(it.trimOut),
              transition: isLast
                ? { type: "cut" }
                : xf
                  ? { type: "xfade", duration: round2(it.transition.duration || DEFAULT_XFADE) }
                  : { type: "cut" },
            };
          }),
        };
      }
      if (tr.type === "audio") {
        return {
          id: tr.id,
          type: "audio",
          name: tr.name,
          clips: (tr.clips || []).map((c) => ({
            id: c.id,
            source_drive_id: c.driveId ?? c.source_drive_id,
            trim_in: round2(c.trimIn),
            trim_out: round2(c.trimOut),
            startAt: round2(c.startAt),
            volume: c.volume == null ? 1 : Number(c.volume),
            ...(c.fadeIn != null ? { fadeIn: round2(c.fadeIn) } : {}),
            ...(c.fadeOut != null ? { fadeOut: round2(c.fadeOut) } : {}),
          })),
        };
      }
      // text
      return {
        id: tr.id,
        type: "text",
        name: tr.name,
        source: tr.source || "manual",
        clips: (tr.clips || []).map((c) => ({
          id: c.id,
          text: c.text || "",
          startAt: round2(c.startAt),
          endAt: round2(c.endAt),
          style: {
            font: c.style?.font ?? "sans",
            size: c.style?.size ?? 36,
            color: c.style?.color ?? "#ffffff",
            ...(c.style?.bg != null ? { bg: c.style.bg } : {}),
            position: c.style?.position ?? "bottom",
          },
        })),
      };
    }),
  };
}

let _idSeq = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;

/** Upgrade ANY legacy/loose input → a v2 doc.
 *  - a flat array of items            → { version:2, tracks:[video_0], output, duration }
 *  - an already-v2 doc ({version,tracks}) → returned normalized
 *  - a falsy / empty value            → empty v2 doc */
export function normalizeTimeline(any, output) {
  // already v2-ish
  if (any && typeof any === "object" && !Array.isArray(any) && Array.isArray(any.tracks)) {
    const tracks = any.tracks;
    return {
      version: 2,
      output: any.output ?? output,
      duration: typeof any.duration === "number" ? any.duration : tracksDuration(tracks),
      tracks,
    };
  }
  // legacy flat array of video items
  const items = Array.isArray(any) ? any : [];
  const tracks = [{ id: "video_0", type: "video", name: "Video", clips: items }];
  return {
    version: 2,
    output: output,
    duration: tracksDuration(tracks),
    tracks,
  };
}

/* ========================================================= */

const fmt = (s) => {
  const n = Number(s) || 0;
  const m = Math.floor(n / 60);
  const sec = n - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
};

/* ---------- time ruler ticks ---------- */
function rulerTicks(totalSec, pxPerSec) {
  // pick a "nice" step that yields ~60px between ticks
  const target = 60 / pxPerSec;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s >= target) || 300;
  const ticks = [];
  for (let t = 0; t <= totalSec + step; t += step) ticks.push(t);
  return { step, ticks };
}

/* =========================================================
   Default export — renders EITHER:
     • legacy video-only mode   (prop `items`,  onChange(items))
     • v2 multi-track mode      (prop `tracks`, onChange(tracks))
   In legacy mode the markup/behaviour is byte-for-byte the original.
   ========================================================= */
export default function Timeline({ items, tracks, onChange, disabled = false }) {
  // v2 mode is selected ONLY when a `tracks` array is explicitly passed.
  if (Array.isArray(tracks)) {
    return <TimelineV2 tracks={tracks} onChange={onChange} disabled={disabled} />;
  }
  return <VideoTrack items={items} onChange={onChange} disabled={disabled} />;
}

/* ---------------------------------------------------------
   VideoTrack — the original single-track editor, extracted
   verbatim so the legacy code path is unchanged. Optionally
   accepts pxPerSec / setPxPerSec (shared ruler in v2 mode).
   --------------------------------------------------------- */
function VideoTrack({ items, onChange, disabled = false, pxPerSec: pxProp, setPxPerSec: setPxProp, embedded = false }) {
  const [pxLocal, setPxLocal] = useState(40);
  const pxPerSec = pxProp ?? pxLocal;
  const setPxPerSec = setPxProp ?? setPxLocal;
  const trackRef = useRef(null);
  const drag = useRef(null);          // active drag descriptor
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  const total = timelineTotal(items);
  const sourceMax = (it) => (it.sourceDuration && it.sourceDuration > 0 ? it.sourceDuration : Math.max(it.trimOut || 0, 600));

  /* ---------- reorder (drag block body) ---------- */
  const onBodyDown = useCallback((e, index) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", index, pointerId: e.pointerId };
  }, [disabled]);

  /* ---------- trim (drag block edge) ---------- */
  const onTrimDown = useCallback((e, index, side) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const it = itemsRef.current[index];
    drag.current = {
      kind: side === "l" ? "trim-l" : "trim-r",
      index, startX: e.clientX, startIn: it.trimIn, startOut: it.trimOut, max: sourceMax(it),
    };
  }, [disabled]);

  const onMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const its = itemsRef.current;

    if (d.kind === "move") {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left + track.scrollLeft;
      let acc = 0, target = its.length - 1;
      for (let i = 0; i < its.length; i++) {
        const w = Math.max(MIN_BLOCK_PX, trimmedDuration(its[i]) * pxRef.current);
        if (x < acc + w / 2) { target = i; break; }
        acc += w;
      }
      if (target !== d.index) {
        const next = its.slice();
        const [moved] = next.splice(d.index, 1);
        next.splice(target, 0, moved);
        d.index = target;
        onChange(next);
      }
      return;
    }

    // trim
    const deltaSec = (e.clientX - d.startX) / pxRef.current;
    const next = its.slice();
    const it = { ...next[d.index] };
    if (d.kind === "trim-l") {
      it.trimIn = round2(clamp(d.startIn + deltaSec, 0, it.trimOut - MIN_CLIP));
    } else {
      it.trimOut = round2(clamp(d.startOut + deltaSec, it.trimIn + MIN_CLIP, d.max));
    }
    next[d.index] = it;
    onChange(next);
  }, [onChange]);

  const onUp = useCallback((e) => {
    if (drag.current?.pointerId != null) {
      try { e.currentTarget.releasePointerCapture(drag.current.pointerId); } catch { /* noop */ }
    }
    drag.current = null;
  }, []);

  /* ---------- transition badge ---------- */
  const toggleTransition = useCallback((index) => {
    if (disabled) return;
    const next = items.slice();
    const cur = next[index].transition?.type === "xfade" ? "cut" : "xfade";
    next[index] = {
      ...next[index],
      transition: cur === "xfade" ? { type: "xfade", duration: DEFAULT_XFADE } : { type: "cut" },
    };
    onChange(next);
  }, [items, onChange, disabled]);

  const setXfadeDur = useCallback((index, val) => {
    const next = items.slice();
    const cap = Math.min(trimmedDuration(next[index]), trimmedDuration(next[index + 1] || {})) || DEFAULT_XFADE;
    next[index] = { ...next[index], transition: { type: "xfade", duration: clamp(Number(val) || 0, 0.1, cap) } };
    onChange(next);
  }, [items, onChange]);

  const removeAt = useCallback((index) => {
    if (disabled) return;
    onChange(items.filter((_, i) => i !== index));
  }, [items, onChange, disabled]);

  const { ticks } = rulerTicks(Math.max(total, 4), pxPerSec);

  const trackInner = (
    <div className="tl-track">
      {items.length === 0 && (
        <div className="tl-empty">No clips on the timeline yet — add clips from the footage list →</div>
      )}
      {items.map((it, i) => {
        const w = Math.max(MIN_BLOCK_PX, trimmedDuration(it) * pxPerSec);
        const xf = it.transition?.type === "xfade";
        return (
          <React.Fragment key={it.id}>
            <div
              className={"tl-clip" + (drag.current?.kind === "move" && drag.current?.index === i ? " dragging" : "")}
              style={{ width: w }}
              onPointerDown={(e) => onBodyDown(e, i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              title={`${it.filename}\nin ${fmt(it.trimIn)} → out ${fmt(it.trimOut)}`}
            >
              <span
                className="tl-handle l"
                onPointerDown={(e) => onTrimDown(e, i, "l")}
                onPointerMove={onMove}
                onPointerUp={onUp}
              />
              <div className="tl-clip-body">
                <div className="tl-clip-name">{it.filename || "(clip)"}</div>
                <div className="tl-clip-dur">{fmt(trimmedDuration(it))}</div>
              </div>
              <span
                className="tl-handle r"
                onPointerDown={(e) => onTrimDown(e, i, "r")}
                onPointerMove={onMove}
                onPointerUp={onUp}
              />
              {!disabled && (
                <button
                  className="tl-remove"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                  title="Remove from timeline"
                >✕</button>
              )}
            </div>

            {/* transition badge (between this clip and the next) */}
            {i < items.length - 1 && (
              <div className="tl-gap">
                <button
                  className={"tl-trans" + (xf ? " xfade" : "")}
                  onClick={() => toggleTransition(i)}
                  title={xf ? "Crossfade — click for hard cut" : "Hard cut — click for crossfade"}
                >
                  {xf ? "⤬" : "│"}
                </button>
                {xf && (
                  <input
                    className="tl-trans-dur"
                    type="number" step="0.1" min="0.1"
                    value={it.transition.duration}
                    onChange={(e) => setXfadeDur(i, e.target.value)}
                    title="Crossfade duration (s)"
                  />
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  // Embedded inside the v2 stack: render only the track row (toolbar/ruler
  // are owned by the parent). Keeps the legacy standalone markup intact.
  if (embedded) {
    return <div className="tl-track-host" ref={trackRef}>{trackInner}</div>;
  }

  return (
    <div className="tl">
      <div className="tl-toolbar">
        <span className="tl-total">total {fmt(total)}</span>
        <div className="tl-zoom">
          <button className="editor-btn" onClick={() => setPxPerSec((p) => clamp(p - 12, 10, 220))} title="Zoom out">－</button>
          <span className="tl-zoom-lbl">{pxPerSec}px/s</span>
          <button className="editor-btn" onClick={() => setPxPerSec((p) => clamp(p + 12, 10, 220))} title="Zoom in">＋</button>
        </div>
      </div>

      <div className="tl-scroll" ref={trackRef}>
        {/* ruler */}
        <div className="tl-ruler" style={{ width: Math.max(total, 4) * pxPerSec + MIN_BLOCK_PX }}>
          {ticks.map((t, i) => (
            <span key={i} className="tl-tick" style={{ left: t * pxPerSec }}>{fmt(t)}</span>
          ))}
        </div>

        {/* track */}
        {trackInner}
      </div>
    </div>
  );
}

/* =========================================================
   TimelineV2 — stacked multi-track editor.

   Renders the video row (reusing VideoTrack, behaviour unchanged) plus
   absolutely-positioned audio + text rows on a shared time ruler.
   onChange(nextTracks) yields the full v2 track array.
   ========================================================= */
function TimelineV2({ tracks, onChange, disabled = false }) {
  const [pxPerSec, setPxPerSec] = useState(40);
  const scrollRef = useRef(null);
  const adrag = useRef(null);   // active audio/text drag descriptor

  const norm = normalizeTimeline({ tracks });
  const list = norm.tracks;
  const total = Math.max(norm.duration, 4);
  const { ticks } = rulerTicks(total, pxPerSec);
  const laneWidth = total * pxPerSec + MIN_BLOCK_PX;

  const updateTrack = useCallback((trackId, mut) => {
    onChange(list.map((tr) => (tr.id === trackId ? mut(tr) : tr)));
  }, [list, onChange]);

  const updateClip = useCallback((trackId, clipId, patch) => {
    updateTrack(trackId, (tr) => ({
      ...tr,
      clips: (tr.clips || []).map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }));
  }, [updateTrack]);

  const removeClip = useCallback((trackId, clipId) => {
    updateTrack(trackId, (tr) => ({ ...tr, clips: (tr.clips || []).filter((c) => c.id !== clipId) }));
  }, [updateTrack]);

  /* ---------- absolute horizontal drag (audio + text clips) ---------- */
  const onClipDown = useCallback((e, trackId, clip, kind) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    adrag.current = {
      kind, trackId, clipId: clip.id, pointerId: e.pointerId, startX: e.clientX,
      startAt: Number(clip.startAt) || 0,
      endAt: Number(clip.endAt) || 0,
      span: (Number(clip.endAt) || 0) - (Number(clip.startAt) || 0),
    };
  }, [disabled]);

  const onClipMove = useCallback((e) => {
    const d = adrag.current;
    if (!d) return;
    const deltaSec = (e.clientX - d.startX) / pxPerSec;
    if (d.kind === "audio-move") {
      const startAt = round2(Math.max(0, d.startAt + deltaSec));
      updateClip(d.trackId, d.clipId, { startAt });
    } else if (d.kind === "text-move") {
      const startAt = round2(Math.max(0, d.startAt + deltaSec));
      updateClip(d.trackId, d.clipId, { startAt, endAt: round2(startAt + d.span) });
    } else if (d.kind === "text-l") {
      const startAt = round2(clamp(d.startAt + deltaSec, 0, d.endAt - MIN_CLIP));
      updateClip(d.trackId, d.clipId, { startAt });
    } else if (d.kind === "text-r") {
      const endAt = round2(Math.max(d.startAt + MIN_CLIP, d.endAt + deltaSec));
      updateClip(d.trackId, d.clipId, { endAt });
    }
  }, [pxPerSec, updateClip]);

  const onClipUp = useCallback((e) => {
    if (adrag.current?.pointerId != null) {
      try { e.currentTarget.releasePointerCapture(adrag.current.pointerId); } catch { /* noop */ }
    }
    adrag.current = null;
  }, []);

  return (
    <div className="tl tl--multi">
      <div className="tl-toolbar">
        <span className="tl-total">total {fmt(norm.duration)}</span>
        <div className="tl-zoom">
          <button className="editor-btn" onClick={() => setPxPerSec((p) => clamp(p - 12, 10, 220))} title="Zoom out">－</button>
          <span className="tl-zoom-lbl">{pxPerSec}px/s</span>
          <button className="editor-btn" onClick={() => setPxPerSec((p) => clamp(p + 12, 10, 220))} title="Zoom in">＋</button>
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        {/* shared ruler */}
        <div className="tl-ruler" style={{ width: laneWidth }}>
          {ticks.map((t, i) => (
            <span key={i} className="tl-tick" style={{ left: t * pxPerSec }}>{fmt(t)}</span>
          ))}
        </div>

        {/* stacked track rows */}
        <div className="tl-stack" style={{ minWidth: laneWidth }}>
          {list.map((tr) => (
            <div className={"tl-row tl-row--" + tr.type} key={tr.id}>
              <div className="tl-row-label">
                <span className={"tl-row-tag tl-row-tag--" + tr.type}>{tr.type}</span>
                <span className="tl-row-name">{tr.name || tr.id}</span>
              </div>

              {tr.type === "video" && (
                <div className="tl-row-lane tl-row-lane--video">
                  <VideoTrack
                    items={tr.clips || []}
                    disabled={disabled}
                    embedded
                    pxPerSec={pxPerSec}
                    setPxPerSec={setPxPerSec}
                    onChange={(nextClips) => updateTrack(tr.id, (t) => ({ ...t, clips: nextClips }))}
                  />
                </div>
              )}

              {tr.type === "audio" && (
                <div className="tl-row-lane" style={{ width: laneWidth }}>
                  {(tr.clips || []).length === 0 && (
                    <div className="tl-empty">No audio clips — add a track from the music/audio list →</div>
                  )}
                  {(tr.clips || []).map((c) => {
                    const left = (Number(c.startAt) || 0) * pxPerSec;
                    const w = Math.max(MIN_BLOCK_PX, trimmedDuration(c) * pxPerSec);
                    const vol = c.volume == null ? 1 : Number(c.volume);
                    return (
                      <div
                        key={c.id}
                        className="tl-aclip"
                        style={{ left, width: w }}
                        title={`${c.filename || "audio"}\nstart ${fmt(c.startAt)} · ${fmt(trimmedDuration(c))}`}
                        onPointerDown={(e) => onClipDown(e, tr.id, c, "audio-move")}
                        onPointerMove={onClipMove}
                        onPointerUp={onClipUp}
                      >
                        <div className="tl-aclip-body">
                          <div className="tl-clip-name">{c.filename || "(audio)"}</div>
                          <div className="tl-aclip-vol" onPointerDown={(e) => e.stopPropagation()}>
                            <span className="tl-vol-ico">🔊</span>
                            <input
                              className="tl-vol-range"
                              type="range" min="0" max="2" step="0.05"
                              value={vol}
                              disabled={disabled}
                              onChange={(e) => updateClip(tr.id, c.id, { volume: round2(Number(e.target.value)) })}
                              title={`Volume ${Math.round(vol * 100)}%`}
                            />
                            <span className="tl-vol-val">{Math.round(vol * 100)}%</span>
                          </div>
                        </div>
                        {!disabled && (
                          <button
                            className="tl-remove"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); removeClip(tr.id, c.id); }}
                            title="Remove audio clip"
                          >✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {tr.type === "text" && (
                <div className="tl-row-lane" style={{ width: laneWidth }}>
                  {(tr.clips || []).length === 0 && (
                    <div className="tl-empty">No captions — add text or run Whisper →</div>
                  )}
                  {(tr.clips || []).map((c) => {
                    const left = (Number(c.startAt) || 0) * pxPerSec;
                    const span = Math.max(0, (Number(c.endAt) || 0) - (Number(c.startAt) || 0));
                    const w = Math.max(MIN_BLOCK_PX, span * pxPerSec);
                    return (
                      <div
                        key={c.id}
                        className="tl-tclip"
                        style={{ left, width: w }}
                        title={`caption ${fmt(c.startAt)} → ${fmt(c.endAt)}`}
                      >
                        <span
                          className="tl-handle l"
                          onPointerDown={(e) => onClipDown(e, tr.id, c, "text-l")}
                          onPointerMove={onClipMove}
                          onPointerUp={onClipUp}
                        />
                        <div className="tl-tclip-body">
                          <span
                            className="tl-tclip-grip"
                            onPointerDown={(e) => onClipDown(e, tr.id, c, "text-move")}
                            onPointerMove={onClipMove}
                            onPointerUp={onClipUp}
                            title="Drag to move"
                          >⋮⋮</span>
                          <input
                            className="tl-tclip-text"
                            type="text"
                            value={c.text || ""}
                            disabled={disabled}
                            placeholder="caption…"
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => updateClip(tr.id, c.id, { text: e.target.value })}
                          />
                        </div>
                        <span
                          className="tl-handle r"
                          onPointerDown={(e) => onClipDown(e, tr.id, c, "text-r")}
                          onPointerMove={onClipMove}
                          onPointerUp={onClipUp}
                        />
                        {!disabled && (
                          <button
                            className="tl-remove"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); removeClip(tr.id, c.id); }}
                            title="Remove caption"
                          >✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { newId as newTimelineId };
