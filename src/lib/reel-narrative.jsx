/* =========================================================
   Reel Narrative — pure, stateless formatters for the longform
   "Story panel" (Reel DNA Phase 0). NO React, NO state — this
   mirrors the reel-dna.jsx pure-helper convention so both the
   Story panel and any non-React caller can import freely.

   Every input here is the machine-written `narrative` jsonb
   (contract C2) or a slice of it. EVERY C2 field is optional /
   nullable, so each helper must tolerate undefined / null /
   wrong-shaped input and never throw — the panel renders rows
   mid-analysis (narrative === null) and partial LLM output.
   ========================================================= */

/* The scorecard dimensions, in a FIXED render order. `overall` is
   intentionally NOT in this list — the panel renders it separately. */
export const SCORE_DIMENSIONS = [
  { key: "hook",    label: "Hook" },
  { key: "arc",     label: "Arc" },
  { key: "emotion", label: "Emotion" },
  { key: "pacing",  label: "Pacing" },
  { key: "payoff",  label: "Payoff" },
  { key: "cta",     label: "CTA" },
];

/* The media_status state machine (C1) as a UI-facing catalog. */
export const MEDIA_STATUS_LABEL = {
  idle:            "Idle",
  pending_analyze: "Queued",
  analyzing:       "Deconstructing",
  analyzed:        "Analyzed",
  analyze_failed:  "Failed",
};

/* True while the row is being worked on (queued or running). */
export function isAnalyzing(mediaStatus) {
  return mediaStatus === "pending_analyze" || mediaStatus === "analyzing";
}

/* A finite number, else null. Guards against NaN/Infinity/strings/null. */
function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/* Clamp a number into [lo, hi]; null-safe (null → lo). */
function clamp(v, lo, hi) {
  const n = num(v);
  if (n == null) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/* mmss(ts) — seconds → "M:SS". Tolerates null, arrays ([start,end] →
   formats the start), strings, NaN. Returns "—" when there's nothing
   sensible to show. */
export function mmss(ts) {
  let v = ts;
  if (Array.isArray(v)) v = v[0];
  const n = num(v);
  if (n == null || n < 0) return "—";
  const total = Math.floor(n);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* Format a [start,end] ts pair as "M:SS–M:SS"; null-safe to either end. */
export function tsRange(range) {
  if (!Array.isArray(range)) return mmss(range);
  const a = mmss(range[0]);
  const b = range.length > 1 ? mmss(range[1]) : null;
  if (b && b !== "—") return `${a}–${b}`;
  return a;
}

/* A 0..1 strength → percentage (0..100), clamped. null-safe → 0. */
export function strengthPct(strength) {
  return Math.round(clamp(strength, 0, 1) * 100);
}

/* emotionSparklinePoints(emotion_curve, {width,height}) — map
   [{ts, valence}] (valence -1..1) to an SVG <polyline> points string.
   valence +1 → top, -1 → bottom. Empty / single-point safe:
     · []      → "" (panel hides the chart)
     · [pt]    → a flat 2-point line so a single sample is still visible.
   Drops entries without a finite valence so partial curves render. */
export function emotionSparklinePoints(emotion_curve, opts = {}) {
  const width = num(opts.width) ?? 200;
  const height = num(opts.height) ?? 40;
  const pad = num(opts.pad) ?? 3;
  const curve = Array.isArray(emotion_curve) ? emotion_curve : [];

  // Keep only points with a usable valence; preserve order.
  const vals = curve
    .map((p) => (p && typeof p === "object" ? num(p.valence) : null))
    .filter((v) => v != null)
    .map((v) => clamp(v, -1, 1));

  if (vals.length === 0) return "";

  const n = vals.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const yFor = (v) => pad + (1 - (v + 1) / 2) * innerH; // -1→bottom, +1→top
  const xFor = (i) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * innerW);

  if (n === 1) {
    const y = yFor(vals[0]).toFixed(1);
    // a flat line across the chart so one sample is still visible
    return `${pad.toFixed(1)},${y} ${(width - pad).toFixed(1)},${y}`;
  }

  return vals
    .map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(" ");
}

/* rehookMarkers(rehooks, totalTs, {width,pad}) — map a [number] list of
   re-hook timestamps to {ts, leftPct} for vertical markers over the
   emotion sparkline. Needs a totalTs to position; if absent or zero,
   returns [] (markers simply don't render). Null-safe throughout. */
export function rehookMarkers(rehooks, totalTs) {
  const total = num(totalTs);
  if (!Array.isArray(rehooks) || total == null || total <= 0) return [];
  return rehooks
    .map((ts) => num(ts))
    .filter((t) => t != null && t >= 0)
    .map((t) => ({ ts: t, leftPct: clamp((t / total) * 100, 0, 100) }));
}

/* arcSegments(arc, totalTs?) — normalize arc beats to positioned segments
   {beat, summary, startTs, endTs, leftPct, widthPct} for a horizontal
   timeline bar. Safe on missing ts: if a beat lacks startTs/endTs (or no
   totalTs can be derived), it falls back to an equal-width slice so the
   bar still reads. Drops nothing — every beat gets a segment. */
export function arcSegments(arc, totalTs) {
  const beats = Array.isArray(arc) ? arc.filter((b) => b && typeof b === "object") : [];
  if (beats.length === 0) return [];

  // Derive a total from explicit totalTs, else the max endTs/startTs seen.
  let total = num(totalTs);
  if (total == null || total <= 0) {
    let maxTs = 0;
    for (const b of beats) {
      const e = num(b.endTs);
      const s = num(b.startTs);
      if (e != null) maxTs = Math.max(maxTs, e);
      if (s != null) maxTs = Math.max(maxTs, s);
    }
    total = maxTs > 0 ? maxTs : null;
  }

  // If we still have no usable timeline, fall back to equal slices.
  const haveTimeline =
    total != null &&
    beats.some((b) => num(b.startTs) != null || num(b.endTs) != null);

  if (!haveTimeline) {
    const w = 100 / beats.length;
    return beats.map((b, i) => ({
      beat: b.beat || `Beat ${i + 1}`,
      summary: b.summary || "",
      startTs: num(b.startTs),
      endTs: num(b.endTs),
      leftPct: i * w,
      widthPct: w,
    }));
  }

  return beats.map((b, i) => {
    const next = beats[i + 1];
    const start = num(b.startTs) ?? (i === 0 ? 0 : num(beats[i - 1]?.endTs) ?? 0);
    const end =
      num(b.endTs) ??
      num(next?.startTs) ??
      total;
    const leftPct = clamp((start / total) * 100, 0, 100);
    const rightPct = clamp((end / total) * 100, 0, 100);
    const widthPct = Math.max(rightPct - leftPct, 1); // never zero-width
    return {
      beat: b.beat || `Beat ${i + 1}`,
      summary: b.summary || "",
      startTs: start,
      endTs: end,
      leftPct,
      widthPct,
    };
  });
}

/* retentionFlags(retention_flags, totalTs?) — normalize retention-risk
   spans to {startTs, endTs, reason, leftPct, widthPct}. Position is
   best-effort (needs a total); without it, leftPct/widthPct are null and
   the panel renders them as a plain jump-point list. Null-safe. */
export function retentionFlags(flags, totalTs) {
  const list = Array.isArray(flags) ? flags.filter((f) => f && typeof f === "object") : [];
  if (list.length === 0) return [];
  const total = num(totalTs);
  return list.map((f) => {
    const start = num(f.startTs);
    const end = num(f.endTs);
    let leftPct = null;
    let widthPct = null;
    if (total != null && total > 0 && start != null) {
      leftPct = clamp((start / total) * 100, 0, 100);
      const right = end != null ? clamp((end / total) * 100, 0, 100) : leftPct;
      widthPct = Math.max(right - leftPct, 0.5);
    }
    return { startTs: start, endTs: end, reason: f.reason || "", leftPct, widthPct };
  });
}

/* scorecardBars(scorecard) — array of {key, label, value 0-100} in the
   fixed SCORE_DIMENSIONS order. Missing dimensions get value null (the
   panel renders them dimmed / "n/a"). `overall` is returned separately
   via scorecardOverall(). Null-safe to a missing/partial scorecard. */
export function scorecardBars(scorecard) {
  const sc = scorecard && typeof scorecard === "object" ? scorecard : {};
  return SCORE_DIMENSIONS.map((d) => {
    const v = num(sc[d.key]);
    return { key: d.key, label: d.label, value: v == null ? null : clamp(v, 0, 100) };
  });
}

/* scorecardOverall(scorecard) — the 0-100 overall, or null if absent. */
export function scorecardOverall(scorecard) {
  const sc = scorecard && typeof scorecard === "object" ? scorecard : {};
  const v = num(sc.overall);
  return v == null ? null : clamp(v, 0, 100);
}

/* A 0-100 score → a palette CSS var name, for color-coding bars/overall. */
export function scoreColorVar(value) {
  const n = num(value);
  if (n == null) return "var(--fg-dim)";
  if (n >= 75) return "var(--c-green)";
  if (n >= 50) return "var(--c-amber)";
  return "var(--c-red)";
}

/* The longest timestamp we can infer from a narrative, used to position
   arc/rehook/retention overlays on a shared timeline. Null-safe; returns
   null when nothing positional exists. */
export function narrativeTotalTs(narrative) {
  const nv = narrative && typeof narrative === "object" ? narrative : {};
  let max = 0;
  const consider = (v) => {
    const n = num(v);
    if (n != null && n > max) max = n;
  };
  if (Array.isArray(nv.arc)) for (const b of nv.arc) { if (b) { consider(b.startTs); consider(b.endTs); } }
  if (Array.isArray(nv.retention_flags)) for (const f of nv.retention_flags) { if (f) { consider(f.startTs); consider(f.endTs); } }
  if (Array.isArray(nv.emotion_curve)) for (const e of nv.emotion_curve) { if (e) consider(e.ts); }
  if (Array.isArray(nv.rehooks)) for (const r of nv.rehooks) consider(r);
  if (Array.isArray(nv.hook?.ts)) for (const h of nv.hook.ts) consider(h);
  if (nv.payoff) consider(nv.payoff.ts);
  if (nv.cta) consider(nv.cta.ts);
  return max > 0 ? max : null;
}

/* openLoops(open_loops) — normalize to {seededTs, paidTs, paid, desc};
   `paid` coerced to a strict boolean. Null-safe; drops nothing. */
export function openLoops(loops) {
  const list = Array.isArray(loops) ? loops.filter((l) => l && typeof l === "object") : [];
  return list.map((l) => ({
    seededTs: num(l.seededTs),
    paidTs: num(l.paidTs),
    paid: l.paid === true,
    desc: l.desc || "",
  }));
}

/* hasNarrative(item) — boolean: the row carries a narrative object with at
   least one meaningful key (so the panel shows analysis, not the empty
   hint). An empty object / null / non-object → false. */
export function hasNarrative(item) {
  const nv = item && item.narrative;
  if (!nv || typeof nv !== "object" || Array.isArray(nv)) return false;
  const meaningful = [
    "hook", "arc", "open_loops", "emotion_curve", "rehooks",
    "retention_flags", "payoff", "cta", "scorecard", "verdict",
  ];
  return meaningful.some((k) => {
    const v = nv[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  });
}

/* Progress accessors (C3) — all null-safe. */
export function progressPct(progress) {
  const p = progress && typeof progress === "object" ? progress : {};
  return clamp(p.pct, 0, 100);
}
export function progressStep(progress) {
  const p = progress && typeof progress === "object" ? progress : {};
  return p.step || null;
}
export function progressMsg(progress) {
  const p = progress && typeof progress === "object" ? progress : {};
  return p.msg || "";
}

/* humanLabel — titleize a snake/lower token (e.g. "yt_captions" →
   "Yt captions", "stakes" → "Stakes"). null-safe → "". */
export function humanLabel(token) {
  const s = String(token || "").trim();
  if (!s) return "";
  const spaced = s.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
