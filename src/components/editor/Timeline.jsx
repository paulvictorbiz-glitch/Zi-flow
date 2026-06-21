/* =========================================================
   Timeline — visual drag editor for the in-app render pipeline.

   A single horizontal video track. Each clip is a block whose width is
   proportional to its trimmed duration. Interactions (all pointer-event
   based, no drag library):
     • drag a block BODY      → reorder (live swap as you pass neighbors)
     • drag a block EDGE      → trim in / out (clamped to the source length)
     • click the gap BADGE    → toggle cut ↔ crossfade (+ duration input)
     • ✕ on a block           → remove it from the track
     • +/- zoom               → change px-per-second

   Controlled component: the parent owns `items` and passes `onChange`.
   Each item:
     { id, clipId, driveId, filename, sourceDuration, trimIn, trimOut,
       transition: { type: 'cut'|'xfade', duration } }   // transition = INTO next
   `buildProjectJson()` / `timelineTotal()` are exported for the parent.
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

/** Build the worker's project_json from timeline items + an output spec. */
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

/* ========================================================= */
export default function Timeline({ items, onChange, disabled = false }) {
  const [pxPerSec, setPxPerSec] = useState(40);
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
      </div>
    </div>
  );
}
