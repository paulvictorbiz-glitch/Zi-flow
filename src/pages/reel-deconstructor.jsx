/* =========================================================
   Reel Deconstructor — Phase 2 (CapCut-style multi-track timeline).

   Interactive features:
   · Drag clips horizontally to reposition (moves startTs/endTs)
   · Drag across lanes to change gene
   · Drag left/right edge handles to resize duration
   · "+" button per lane creates a new clip on that lane
   · Click blank lane space → shows all clips on that lane as a list
   · Reel length input is fully controlled/editable

   Drag uses a useRef state machine + direct DOM style mutation
   (no React re-renders during pointermove for 60fps smoothness).
   Window-level pointer listeners so drags survive leaving the clip.
   ========================================================= */

import React, { useState, useCallback, useEffect, useRef, forwardRef } from "react";
import "./reel-deconstructor.css";
import { GENES, geneLabel, platformLabel } from "../lib/reel-dna.jsx";

/* ── Gene palette ──────────────────────────────────────────── */
export const GENE_COLOR = {
  music: "var(--c-violet)",
  hook:  "var(--c-cyan)",
  font:  "var(--c-amber)",
  sfx:   "var(--c-green)",
  story: "var(--c-blue)",
  other: "var(--c-grey)",
};

export const LANE_ORDER = ["font", "hook", "music", "sfx", "story", "other"];
export const LANE_LABEL = {
  font: "TEXT", hook: "HOOK", music: "MUSIC",
  sfx: "SFX", story: "STORY", other: "OTHER",
};

const MIN_CLIP_SEC = 0.5;
const SNAP_SEC     = 0.25;

/* ── Timestamp helpers ─────────────────────────────────────── */
export function parseTs(ts) {
  if (!ts && ts !== 0) return null;
  const parts = String(ts).trim().split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1 && !Number.isNaN(parts[0])) return parts[0];
  return null;
}

export function fmtTs(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function snapTo(sec) {
  return Math.round(sec / SNAP_SEC) * SNAP_SEC;
}

export function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

/* ── Segment form ──────────────────────────────────────────── */
const BLANK = (gene = "hook") => ({
  id: crypto.randomUUID(),
  label: "",
  gene,
  startTs: "0:00",
  endTs: "0:05",
  notes: "",
  downloadUrl: "",
});

function SegmentForm({ initial, onSave, onCancel }) {
  const [seg, setSeg] = useState(initial || BLANK());
  const set = (patch) => setSeg(s => ({ ...s, ...patch }));
  const canSave = seg.label.trim().length > 0;

  return (
    <div className="rdc-seg-form">
      <div className="rdc-seg-form-row">
        <input
          className="rdc-input"
          placeholder="Segment label (e.g. 'Hook open', 'Logo reveal')"
          value={seg.label}
          onChange={e => set({ label: e.target.value })}
          autoFocus
        />
        <select
          className="rdc-select"
          value={seg.gene}
          onChange={e => set({ gene: e.target.value })}
        >
          {[...GENES, { key: "other", label: "Other" }].map(g => (
            <option key={g.key} value={g.key}>{g.label}</option>
          ))}
        </select>
      </div>

      <div className="rdc-seg-form-row">
        <input
          className="rdc-input sm"
          placeholder="Start (0:00)"
          value={seg.startTs}
          onChange={e => set({ startTs: e.target.value })}
        />
        <input
          className="rdc-input sm"
          placeholder="End (0:05)"
          value={seg.endTs}
          onChange={e => set({ endTs: e.target.value })}
        />
        <input
          className="rdc-input"
          placeholder="Download URL (clip, font file, track link…)"
          value={seg.downloadUrl}
          onChange={e => set({ downloadUrl: e.target.value })}
        />
      </div>

      <textarea
        className="rdc-notes"
        placeholder="Notes about this segment…"
        value={seg.notes}
        rows={2}
        onChange={e => set({ notes: e.target.value })}
      />

      <div className="rdc-seg-form-actions">
        <button className="rdc-btn rdc-btn--ghost" onClick={onCancel}>Cancel</button>
        <button
          className="rdc-btn rdc-btn--primary"
          disabled={!canSave}
          onClick={() => canSave && onSave(seg)}
        >
          Save segment
        </button>
      </div>
    </div>
  );
}

/* ── Timeline ruler ────────────────────────────────────────── */
export function TimelineRuler({ totalSec }) {
  if (!totalSec) return null;
  const interval = totalSec <= 30 ? 5 : totalSec <= 120 ? 10 : 30;
  const ticks = [];
  for (let t = 0; t <= totalSec; t += interval) ticks.push(t);
  return (
    <div className="rdc-ruler">
      {ticks.map(t => (
        <div key={t} className="rdc-ruler-tick" style={{ left: `${(t / totalSec) * 100}%` }}>
          <span className="rdc-ruler-tick-label">{fmtTs(t)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Clip block ────────────────────────────────────────────── */
export const ClipBlock = forwardRef(function ClipBlock(
  { seg, totalSec, selected, onClick, onPointerDownBody, onPointerDownLeft, onPointerDownRight },
  ref
) {
  const color = GENE_COLOR[seg.gene] || GENE_COLOR.other;
  const s = parseTs(seg.startTs);
  const e = parseTs(seg.endTs);
  if (s == null || !totalSec) return null;

  const leftPct  = clamp((s / totalSec) * 100, 0, 99);
  const rawWidth = e != null ? ((e - s) / totalSec) * 100 : 2;
  const widthPct = clamp(Math.max(rawWidth, 1.5), 0, 100 - leftPct);

  return (
    <div
      ref={ref}
      className={"rdc-clip" + (selected ? " selected" : "")}
      style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }}
      title={`${seg.label}  ${seg.startTs || ""}${seg.endTs ? " → " + seg.endTs : ""}`}
      onClick={ev => { ev.stopPropagation(); onClick(seg.id); }}
      onPointerDown={ev => { ev.stopPropagation(); onPointerDownBody(ev, seg); }}
    >
      {/* Left resize handle */}
      <div
        className="rdc-clip-handle rdc-clip-handle--left"
        onPointerDown={ev => { ev.stopPropagation(); onPointerDownLeft(ev, seg); }}
      />
      <span className="rdc-clip-label">{seg.label}</span>
      {/* Right resize handle */}
      <div
        className="rdc-clip-handle rdc-clip-handle--right"
        onPointerDown={ev => { ev.stopPropagation(); onPointerDownRight(ev, seg); }}
      />
    </div>
  );
});

/* ── Track lane ────────────────────────────────────────────── */
function TrackLane({
  gene, segments, totalSec, selectedId,
  onSelect, onAddToLane, onLaneClick, isDragTarget,
  clipRefs, onPointerDownBody, onPointerDownLeft, onPointerDownRight,
  trackRefs,
}) {
  const segsOnLane = segments.filter(s => s.gene === gene);
  const color = GENE_COLOR[gene] || "var(--fg-dim)";

  return (
    <div className="rdc-lane">
      <div className="rdc-lane-label" style={{ color }}>
        {LANE_LABEL[gene]}
        <button
          className="rdc-lane-add"
          style={{ color }}
          title={`Add ${LANE_LABEL[gene]} clip`}
          onClick={ev => { ev.stopPropagation(); onAddToLane(gene); }}
        >+</button>
      </div>
      <div
        ref={el => { if (el) trackRefs.current[gene] = el; }}
        className={"rdc-lane-track" + (isDragTarget ? " drag-over" : "")}
        onClick={() => {
          if (segsOnLane.length > 0) onLaneClick(gene);
          else onAddToLane(gene);
        }}
      >
        {segsOnLane.map(seg => (
          <ClipBlock
            key={seg.id}
            ref={el => { if (el) clipRefs.current[seg.id] = el; }}
            seg={seg}
            totalSec={totalSec}
            selected={selectedId === seg.id}
            onClick={onSelect}
            onPointerDownBody={onPointerDownBody}
            onPointerDownLeft={onPointerDownLeft}
            onPointerDownRight={onPointerDownRight}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Lane track list (click empty lane → shows all clips) ──── */
function LaneTrackList({ gene, segments, selectedId, onSelect, onClose }) {
  const segs = segments.filter(s => s.gene === gene);
  const color = GENE_COLOR[gene] || GENE_COLOR.other;

  return (
    <div className="rdc-lane-list">
      <div className="rdc-lane-list-head">
        <span style={{ color }}>{LANE_LABEL[gene]} — {segs.length} clip{segs.length !== 1 ? "s" : ""}</span>
        <button className="rdc-close" onClick={onClose}>✕</button>
      </div>
      {segs.map(seg => {
        const s = parseTs(seg.startTs);
        const e = parseTs(seg.endTs);
        const dur = s != null && e != null ? fmtTs(e - s) : null;
        return (
          <div
            key={seg.id}
            className={"rdc-lane-list-row" + (selectedId === seg.id ? " selected" : "")}
            onClick={() => onSelect(seg.id)}
          >
            <span className="rdc-lane-list-dot" style={{ background: color }} />
            <span className="rdc-lane-list-label">{seg.label || <em style={{ opacity: .5 }}>Untitled</em>}</span>
            <span className="rdc-lane-list-ts">
              {seg.startTs || "—"}{seg.endTs ? ` → ${seg.endTs}` : ""}
              {dur ? ` (${dur})` : ""}
            </span>
            {seg.downloadUrl && (
              <a className="rdc-dl-btn" href={seg.downloadUrl} target="_blank" rel="noreferrer"
                 onClick={ev => ev.stopPropagation()}>
                ↓
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Inspector panel ───────────────────────────────────────── */
function InspectorPanel({ seg, onEdit, onDelete, onClose }) {
  if (!seg) {
    return (
      <div className="rdc-inspector">
        <div className="rdc-inspector-empty">
          Click a clip on the timeline to inspect it · Click a lane to list all clips
        </div>
      </div>
    );
  }

  const color = GENE_COLOR[seg.gene] || GENE_COLOR.other;
  const s = parseTs(seg.startTs);
  const e = parseTs(seg.endTs);
  const duration = s != null && e != null ? fmtTs(e - s) : null;

  return (
    <div className="rdc-inspector">
      <div className="rdc-inspector-seg">
        <div className="rdc-inspector-head">
          <span className="rdc-inspector-title">{seg.label || <em style={{ opacity: .5 }}>Untitled</em>}</span>
          <span className="rdc-inspector-gene" style={{ color, borderColor: color }}>
            {geneLabel(seg.gene)}
          </span>
          <span className="rdc-inspector-ts">
            {seg.startTs || "—"}
            {seg.endTs ? <> → {seg.endTs}</> : null}
            {duration ? <span className="rdc-inspector-dur"> ({duration})</span> : null}
          </span>
        </div>
        {seg.notes && <div className="rdc-inspector-notes">{seg.notes}</div>}
        <div className="rdc-inspector-actions">
          {seg.downloadUrl && (
            <a className="rdc-dl-btn" href={seg.downloadUrl} target="_blank" rel="noreferrer">
              ↓ Download
            </a>
          )}
          <button className="rdc-btn rdc-btn--ghost" onClick={onEdit}>Edit</button>
          <button
            className="rdc-btn rdc-btn--danger"
            onClick={() => { if (window.confirm(`Delete "${seg.label}"?`)) onDelete(seg.id); }}
          >
            Delete
          </button>
          <button className="rdc-close rdc-inspector-close" onClick={onClose} title="Deselect">✕</button>
        </div>
      </div>
    </div>
  );
}

/* ── Export helpers ────────────────────────────────────────── */
function segmentsToText(segments, item) {
  const lines = [
    `Reel DNA Timeline — ${item.reelUrl}`,
    `Platform: ${platformLabel(item.platform)}`,
    `Captured: ${item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}`,
    "",
  ];
  segments.forEach((seg, i) => {
    lines.push(`[${i + 1}] ${seg.label} (${geneLabel(seg.gene)})`);
    if (seg.startTs || seg.endTs) lines.push(`    Time: ${seg.startTs || ""}${seg.endTs ? " → " + seg.endTs : ""}`);
    if (seg.notes)       lines.push(`    Notes: ${seg.notes}`);
    if (seg.downloadUrl) lines.push(`    Download: ${seg.downloadUrl}`);
    lines.push("");
  });
  return lines.join("\n");
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ── Main modal ────────────────────────────────────────────── */
export function ReelDeconstructor({ item, onClose, onSave }) {
  const [segments, setSegments]     = useState(() => item.timeline || []);
  const [selectedId, setSelectedId] = useState(null);
  const [laneListGene, setLaneListGene] = useState(null);
  const [adding, setAdding]         = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [totalSec, setTotalSec]     = useState(30);
  const [reelLenInput, setReelLenInput] = useState("0:30");
  const [dragTargetGene, setDragTargetGene] = useState(null);
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);

  /* Refs for imperatively updating clip DOM during drag */
  const clipRefs  = useRef({});
  const trackRefs = useRef({});
  const dragRef   = useRef(null); // { type, segId, origStart, origEnd, origGene, startX, trackEl }
  const segsRef   = useRef(segments);
  segsRef.current = segments;

  const markDirty = useCallback((newSegs) => {
    setSegments(newSegs);
    setDirty(true);
  }, []);

  const selectedSeg = segments.find(s => s.id === selectedId) || null;

  /* ── Drag state machine ─────────────────────────────────── */

  const commitDrag = useCallback((finalSegs) => {
    markDirty(finalSegs);
    setDragTargetGene(null);
    dragRef.current = null;
  }, [markDirty]);

  const onPointerMove = useCallback((ev) => {
    const d = dragRef.current;
    if (!d) return;

    const trackEl = d.trackEl;
    const trackWidth = trackEl.clientWidth;
    if (!trackWidth) return;

    const ts = segsRef.current.find(s => s.id === d.segId);
    if (!ts) return;

    const dx = ev.clientX - d.startX;
    const dSec = (dx / trackWidth) * d.totalSec;

    const clipEl = clipRefs.current[d.segId];

    if (d.type === "move") {
      const dur = d.origEnd != null ? d.origEnd - d.origStart : 5;
      const newStart = clamp(snapTo(d.origStart + dSec), 0, d.totalSec - (dur || 0.5));
      const newEnd   = newStart + dur;
      const leftPct  = clamp((newStart / d.totalSec) * 100, 0, 99);
      const widthPct = clamp((dur / d.totalSec) * 100, 1.5, 100 - leftPct);
      if (clipEl) { clipEl.style.left = `${leftPct}%`; clipEl.style.width = `${widthPct}%`; }

      // Cross-lane detection
      const hovered = document.elementFromPoint(ev.clientX, ev.clientY);
      let hoveredGene = null;
      for (const [gene, el] of Object.entries(trackRefs.current)) {
        if (el && el.contains(hovered)) { hoveredGene = gene; break; }
      }
      setDragTargetGene(hoveredGene !== d.origGene ? hoveredGene : null);

    } else if (d.type === "resize-left") {
      const newStart = clamp(snapTo(d.origStart + dSec), 0, d.origEnd - MIN_CLIP_SEC);
      const newEnd   = d.origEnd;
      const leftPct  = clamp((newStart / d.totalSec) * 100, 0, 99);
      const widthPct = clamp(((newEnd - newStart) / d.totalSec) * 100, 1.5, 100 - leftPct);
      if (clipEl) { clipEl.style.left = `${leftPct}%`; clipEl.style.width = `${widthPct}%`; }

    } else if (d.type === "resize-right") {
      const newEnd  = clamp(snapTo(d.origEnd + dSec), d.origStart + MIN_CLIP_SEC, d.totalSec);
      const leftPct = clamp((d.origStart / d.totalSec) * 100, 0, 99);
      const widthPct = clamp(((newEnd - d.origStart) / d.totalSec) * 100, 1.5, 100 - leftPct);
      if (clipEl) { clipEl.style.width = `${widthPct}%`; }
    }

    if (clipEl) clipEl.classList.add("dragging");
  }, []);

  const onPointerUp = useCallback((ev) => {
    const d = dragRef.current;
    if (!d) return;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);

    const clipEl = clipRefs.current[d.segId];
    if (clipEl) clipEl.classList.remove("dragging");

    const trackEl = d.trackEl;
    const trackWidth = trackEl.clientWidth;
    const dx = ev.clientX - d.startX;
    const dSec = trackWidth ? (dx / trackWidth) * d.totalSec : 0;

    const cur = segsRef.current.find(s => s.id === d.segId);
    if (!cur) { dragRef.current = null; setDragTargetGene(null); return; }

    let updated = { ...cur };

    if (d.type === "move") {
      const dur = d.origEnd != null ? d.origEnd - d.origStart : 5;
      const newStart = clamp(snapTo(d.origStart + dSec), 0, d.totalSec - (dur || 0.5));
      const newEnd   = newStart + dur;
      updated.startTs = fmtTs(newStart);
      updated.endTs   = fmtTs(newEnd);

      // Cross-lane drop
      const hovered = document.elementFromPoint(ev.clientX, ev.clientY);
      for (const [gene, el] of Object.entries(trackRefs.current)) {
        if (el && el.contains(hovered) && gene !== d.origGene) {
          updated.gene = gene;
          break;
        }
      }
    } else if (d.type === "resize-left") {
      const newStart = clamp(snapTo(d.origStart + dSec), 0, d.origEnd - MIN_CLIP_SEC);
      updated.startTs = fmtTs(newStart);
    } else if (d.type === "resize-right") {
      const newEnd = clamp(snapTo(d.origEnd + dSec), d.origStart + MIN_CLIP_SEC, d.totalSec);
      updated.endTs = fmtTs(newEnd);
    }

    commitDrag(segsRef.current.map(s => s.id === d.segId ? updated : s));
  }, [onPointerMove, commitDrag]);

  const startDrag = useCallback((ev, seg, type) => {
    ev.preventDefault();
    const origStart = parseTs(seg.startTs) ?? 0;
    const origEnd   = parseTs(seg.endTs)   ?? origStart + 5;

    // Find which track element this clip belongs to
    const trackEl = trackRefs.current[seg.gene];
    if (!trackEl) return;

    dragRef.current = {
      type,
      segId: seg.id,
      origStart,
      origEnd,
      origGene: seg.gene,
      startX: ev.clientX,
      trackEl,
      totalSec,
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [totalSec, onPointerMove, onPointerUp]);

  const onPointerDownBody  = useCallback((ev, seg) => startDrag(ev, seg, "move"), [startDrag]);
  const onPointerDownLeft  = useCallback((ev, seg) => startDrag(ev, seg, "resize-left"), [startDrag]);
  const onPointerDownRight = useCallback((ev, seg) => startDrag(ev, seg, "resize-right"), [startDrag]);

  /* ── Segment CRUD ───────────────────────────────────────── */

  const addSegment = (seg) => {
    markDirty([...segsRef.current, seg]);
    setAdding(false);
    setSelectedId(seg.id);
    setLaneListGene(null);
  };

  const handleAddToLane = useCallback((gene) => {
    const seg = BLANK(gene);
    markDirty([...segsRef.current, seg]);
    setSelectedId(seg.id);
    setLaneListGene(null);
    setAdding(false);
    setEditingId(seg.id); // open inline edit immediately
  }, [markDirty]);

  const saveEdit = (updated) => {
    markDirty(segsRef.current.map(s => s.id === updated.id ? updated : s));
    setEditingId(null);
  };

  const deleteSegment = (id) => {
    markDirty(segsRef.current.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleLaneClick = useCallback((gene) => {
    setLaneListGene(prev => prev === gene ? null : gene);
    setSelectedId(null);
  }, []);

  const handleSelectClip = useCallback((id) => {
    setSelectedId(id);
    setLaneListGene(null);
  }, []);

  /* ── Save / export ──────────────────────────────────────── */

  const save = async () => {
    setSaving(true);
    await onSave(segments);
    setSaving(false);
    setDirty(false);
  };

  const exportTxt = () => {
    const text = segmentsToText(segments, item);
    const slug = item.reelUrl.replace(/[^a-z0-9]+/gi, "-").slice(-40);
    downloadText(text, `reel-dna-${slug}.txt`);
  };

  /* ── Reel length input (controlled) ─────────────────────── */

  const commitReelLen = (val) => {
    const s = parseTs(val);
    if (s != null && s > 0) {
      setTotalSec(s);
      setReelLenInput(fmtTs(s));
    } else {
      setReelLenInput(fmtTs(totalSec)); // revert
    }
  };

  /* ── Keyboard ───────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Cleanup drag listeners on unmount */
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="rdc-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rdc-modal">

        {/* ── Header ── */}
        <div className="rdc-header">
          <div className="rdc-header-title">
            <span className="rdc-label">Reel Deconstructor</span>
            <a className="rdc-url" href={item.reelUrl} target="_blank" rel="noreferrer">
              {item.reelUrl}
            </a>
          </div>
          <div className="rdc-header-actions">
            <div className="rdc-duration-set">
              <span className="rdc-dim">Reel length</span>
              <input
                className="rdc-input sm"
                style={{ width: 64 }}
                placeholder="0:30"
                value={reelLenInput}
                onChange={e => setReelLenInput(e.target.value)}
                onBlur={e => commitReelLen(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.target.blur(); } }}
              />
            </div>
            {segments.length > 0 && (
              <button className="rdc-btn rdc-btn--ghost" onClick={exportTxt}>Export .txt</button>
            )}
            <button className="rdc-btn rdc-btn--primary" disabled={!dirty || saving} onClick={save}>
              {saving ? "Saving…" : dirty ? "Save timeline" : "Saved"}
            </button>
            <button className="rdc-btn rdc-btn--ghost" onClick={() => { setAdding(true); setEditingId(null); setSelectedId(null); setLaneListGene(null); }}>
              Edit timeline
            </button>
            <button className="rdc-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* ── Track grid ── */}
        <div className="rdc-track-grid">
          <TimelineRuler totalSec={totalSec} />
          {LANE_ORDER.map(gene => (
            <TrackLane
              key={gene}
              gene={gene}
              segments={segments}
              totalSec={totalSec}
              selectedId={selectedId}
              onSelect={handleSelectClip}
              onAddToLane={handleAddToLane}
              onLaneClick={handleLaneClick}
              isDragTarget={dragTargetGene === gene}
              clipRefs={clipRefs}
              trackRefs={trackRefs}
              onPointerDownBody={onPointerDownBody}
              onPointerDownLeft={onPointerDownLeft}
              onPointerDownRight={onPointerDownRight}
            />
          ))}
        </div>

        {/* ── Lane track list ── */}
        {laneListGene && (
          <LaneTrackList
            gene={laneListGene}
            segments={segments}
            selectedId={selectedId}
            onSelect={handleSelectClip}
            onClose={() => setLaneListGene(null)}
          />
        )}

        {/* ── Inspector / inline edit ── */}
        {editingId ? (
          <div className="rdc-inspector rdc-inspector--editing">
            <SegmentForm
              initial={segments.find(s => s.id === editingId)}
              onSave={saveEdit}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <InspectorPanel
            seg={selectedSeg}
            onEdit={() => setEditingId(selectedId)}
            onDelete={deleteSegment}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* ── Add segment ── */}
        <div className="rdc-body">
          {adding ? (
            <SegmentForm onSave={addSegment} onCancel={() => setAdding(false)} />
          ) : (
            <button className="rdc-add-btn" onClick={() => { setAdding(true); setEditingId(null); }}>
              + Add segment
            </button>
          )}
        </div>

        {/* ── Footer legend ── */}
        <div className="rdc-footer">
          {LANE_ORDER.map(gene => (
            <span key={gene} className="rdc-legend-item">
              <span className="rdc-legend-dot" style={{ background: GENE_COLOR[gene] }} />
              {LANE_LABEL[gene]}
            </span>
          ))}
        </div>

      </div>
    </div>
  );
}
