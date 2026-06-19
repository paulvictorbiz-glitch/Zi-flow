/* =========================================================
   ReelStoryPanel — the longform "Story panel" (Reel DNA Phase 0).
   PRESENTATIONAL ONLY: it reads the machine-written `narrative`
   jsonb (contract C2) + `progress` (C3) off a reel_dna item and
   renders the deconstruction. NO store actions, NO business logic
   — all shaping lives in ../lib/reel-narrative.jsx (pure helpers).

   It is rendered by unified-dna-card.jsx ONLY when item.format
   === 'long', so short-format cards are entirely unaffected.

   States (driven by item.mediaStatus):
     · analyzing / pending_analyze → "Deconstructing…" progress bar
     · analyze_failed              → error message + (panel-side hint;
                                      the Re-analyze button lives in the
                                      card)
     · narrative present           → hook / arc / emotion / loops /
                                      retention / payoff+cta / scorecard
     · idle + no narrative         → small empty hint

   EVERY C2 field is optional — every block null-checks and only
   renders when it has something to show, so partial LLM output
   (hook-only, scorecard-only, empty emotion_curve, arc without ts)
   never throws.
   ========================================================= */

import React from "react";
import "./reel-story-panel.css";
import {
  mmss, tsRange, strengthPct,
  emotionSparklinePoints, rehookMarkers,
  arcSegments, retentionFlags, openLoops,
  scorecardBars, scorecardOverall, scoreColorVar,
  narrativeTotalTs, hasNarrative, isAnalyzing,
  progressPct, progressStep, progressMsg, humanLabel,
} from "../lib/reel-narrative.jsx";

/* ── A 0..1 strength meter ── */
function StrengthMeter({ value, color = "var(--c-cyan)" }) {
  const pct = strengthPct(value);
  return (
    <div className="rsp-meter" title={`${pct}%`}>
      <div className="rsp-meter-fill" style={{ width: pct + "%", background: color }} />
    </div>
  );
}

/* ── Deconstructing progress state ── */
function ProgressState({ progress }) {
  const pct = progressPct(progress);
  const step = progressStep(progress);
  const msg = progressMsg(progress);
  return (
    <div className="rsp-progress">
      <div className="rsp-progress-head">
        <span className="rsp-spinner" aria-hidden="true" />
        <span className="rsp-progress-title">Deconstructing…</span>
        {step && <span className="rsp-progress-step">{humanLabel(step)}</span>}
      </div>
      <div className="rsp-progress-track">
        <div className="rsp-progress-bar" style={{ width: Math.max(pct, 4) + "%" }} />
      </div>
      <div className="rsp-progress-foot">
        {msg ? <span className="rsp-progress-msg">{msg}</span> : <span className="rsp-progress-msg dim">Working…</span>}
        <span className="rsp-progress-pct">{pct}%</span>
      </div>
    </div>
  );
}

/* ── Failed state ── */
function FailedState({ error }) {
  return (
    <div className="rsp-failed">
      <div className="rsp-failed-title">⚠ Analysis failed</div>
      <div className="rsp-failed-msg">
        {error ? String(error) : "The deconstruction could not complete."}
      </div>
      <div className="rsp-failed-hint">Use “Re-analyze” above to try again.</div>
    </div>
  );
}

/* ── Hook card ── */
function HookBlock({ hook }) {
  if (!hook || typeof hook !== "object") return null;
  const hasType = !!hook.type;
  const hasQuote = typeof hook.quote === "string" && hook.quote.trim();
  const hasStrength = typeof hook.strength === "number";
  const hasTs = Array.isArray(hook.ts) && hook.ts.length > 0;
  if (!hasType && !hasQuote && !hasStrength && !hasTs) return null;
  return (
    <section className="rsp-block rsp-hook">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Hook</span>
        {hasTs && <span className="rsp-ts">{tsRange(hook.ts)}</span>}
      </div>
      <div className="rsp-hook-row">
        {hasType && <span className="rsp-chip rsp-chip--cyan">{humanLabel(hook.type)}</span>}
        {hasStrength && (
          <div className="rsp-hook-strength">
            <StrengthMeter value={hook.strength} />
            <span className="rsp-strength-val">{strengthPct(hook.strength)}%</span>
          </div>
        )}
      </div>
      {hasQuote && <blockquote className="rsp-quote">“{hook.quote.trim()}”</blockquote>}
    </section>
  );
}

/* ── Arc timeline bar ── */
function ArcBlock({ arc, totalTs }) {
  const segs = arcSegments(arc, totalTs);
  if (segs.length === 0) return null;
  return (
    <section className="rsp-block rsp-arc">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Story arc</span>
      </div>
      <div className="rsp-arc-bar">
        {segs.map((s, i) => (
          <div
            key={i}
            className="rsp-arc-seg"
            style={{ left: s.leftPct + "%", width: s.widthPct + "%" }}
            title={s.summary || s.beat}
          >
            <span className="rsp-arc-seg-label">{s.beat}</span>
          </div>
        ))}
      </div>
      <div className="rsp-arc-legend">
        {segs.map((s, i) => (
          <div key={i} className="rsp-arc-legend-item">
            <span className="rsp-arc-legend-beat">{s.beat}</span>
            {s.startTs != null && <span className="rsp-ts dim">{mmss(s.startTs)}</span>}
            {s.summary && <span className="rsp-arc-legend-sum">{s.summary}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Emotion sparkline + rehook markers ── */
function EmotionBlock({ emotion_curve, rehooks, totalTs }) {
  const W = 240, H = 44;
  const points = emotionSparklinePoints(emotion_curve, { width: W, height: H });
  if (!points) return null;
  const markers = rehookMarkers(rehooks, totalTs);
  const curve = Array.isArray(emotion_curve) ? emotion_curve : [];
  return (
    <section className="rsp-block rsp-emotion">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Emotion curve</span>
        {markers.length > 0 && <span className="rsp-block-note">{markers.length} re-hook{markers.length === 1 ? "" : "s"}</span>}
      </div>
      <div className="rsp-spark-wrap">
        {/* mid-line (neutral valence) */}
        <svg className="rsp-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="rsp-spark-mid" />
          <polyline points={points} className="rsp-spark-line"
            fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {markers.map((m, i) => (
          <span key={i} className="rsp-rehook" style={{ left: m.leftPct + "%" }}
                title={`Re-hook @ ${mmss(m.ts)}`} />
        ))}
      </div>
      {curve.length > 0 && (
        <div className="rsp-emotion-labels">
          {curve.slice(0, 6).map((p, i) =>
            p && p.label ? (
              <span key={i} className="rsp-chip rsp-chip--ghost">
                {humanLabel(p.label)}{typeof p.ts === "number" ? ` · ${mmss(p.ts)}` : ""}
              </span>
            ) : null
          )}
        </div>
      )}
    </section>
  );
}

/* ── Open loops (seeded → paid) ── */
function OpenLoopsBlock({ open_loops }) {
  const loops = openLoops(open_loops);
  if (loops.length === 0) return null;
  return (
    <section className="rsp-block rsp-loops">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Open loops</span>
      </div>
      <ul className="rsp-loop-list">
        {loops.map((l, i) => (
          <li key={i} className={"rsp-loop" + (l.paid ? " is-paid" : " is-open")}>
            <span className={"rsp-loop-dot" + (l.paid ? " paid" : " open")} aria-hidden="true" />
            <span className="rsp-loop-span">
              {mmss(l.seededTs)} <span className="rsp-loop-arrow">→</span>{" "}
              {l.paid ? mmss(l.paidTs) : <span className="rsp-loop-unpaid">unpaid</span>}
            </span>
            {l.desc && <span className="rsp-loop-desc">{l.desc}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Retention-risk flags (jump points) ── */
function RetentionBlock({ retention_flags, totalTs }) {
  const flags = retentionFlags(retention_flags, totalTs);
  if (flags.length === 0) return null;
  return (
    <section className="rsp-block rsp-retention">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Retention risk</span>
        <span className="rsp-block-note">{flags.length} flag{flags.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="rsp-flag-list">
        {flags.map((f, i) => (
          <li key={i} className="rsp-flag">
            <span className="rsp-flag-ts">
              {f.startTs != null ? mmss(f.startTs) : "—"}
              {f.endTs != null ? `–${mmss(f.endTs)}` : ""}
            </span>
            {f.reason && <span className="rsp-flag-reason">{f.reason}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Payoff + CTA chips ── */
function PayoffCtaBlock({ payoff, cta }) {
  const hasPayoff = payoff && typeof payoff === "object" &&
    (typeof payoff.ts === "number" || typeof payoff.strength === "number" || "present" in payoff);
  const hasCta = cta && typeof cta === "object" &&
    (typeof cta.ts === "number" || "present" in cta);
  if (!hasPayoff && !hasCta) return null;
  return (
    <section className="rsp-block rsp-payoff">
      <div className="rsp-payoff-chips">
        {hasPayoff && (
          <div className="rsp-chip rsp-chip--green">
            Payoff
            {typeof payoff.ts === "number" && <span className="rsp-chip-ts">{mmss(payoff.ts)}</span>}
            {typeof payoff.strength === "number" && (
              <span className="rsp-chip-meta">{strengthPct(payoff.strength)}%</span>
            )}
          </div>
        )}
        {hasCta && (
          <div className={"rsp-chip " + (cta.present === false ? "rsp-chip--ghost" : "rsp-chip--blue")}>
            CTA {cta.present === false ? "absent" : "present"}
            {typeof cta.ts === "number" && <span className="rsp-chip-ts">{mmss(cta.ts)}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Scorecard (bars + overall + verdict) ── */
function ScorecardBlock({ scorecard, verdict }) {
  const bars = scorecardBars(scorecard);
  const overall = scorecardOverall(scorecard);
  const anyBar = bars.some((b) => b.value != null);
  const hasVerdict = typeof verdict === "string" && verdict.trim();
  if (!anyBar && overall == null && !hasVerdict) return null;
  return (
    <section className="rsp-block rsp-scorecard">
      <div className="rsp-block-head">
        <span className="rsp-block-label">Scorecard</span>
        {overall != null && (
          <span className="rsp-overall" style={{ color: scoreColorVar(overall) }}>
            {overall}<span className="rsp-overall-max">/100</span>
          </span>
        )}
      </div>
      {anyBar && (
        <div className="rsp-score-grid">
          {bars.map((b) => (
            <div key={b.key} className="rsp-score-row">
              <span className="rsp-score-label">{b.label}</span>
              <div className="rsp-score-track">
                {b.value != null ? (
                  <div className="rsp-score-fill"
                       style={{ width: b.value + "%", background: scoreColorVar(b.value) }} />
                ) : null}
              </div>
              <span className="rsp-score-val">{b.value != null ? b.value : "—"}</span>
            </div>
          ))}
        </div>
      )}
      {hasVerdict && <p className="rsp-verdict">{verdict.trim()}</p>}
    </section>
  );
}

/* ── Provenance footer (transcript source / model) ── */
function ProvenanceFooter({ narrative }) {
  const src = narrative.transcript_source;
  const model = narrative.model;
  if (!src && !model) return null;
  return (
    <div className="rsp-provenance">
      {src && <span title="Transcript source">{humanLabel(src)}</span>}
      {src && model && <span className="rsp-prov-sep">·</span>}
      {model && <span title="Model">{model}</span>}
    </div>
  );
}

export function ReelStoryPanel({ item }) {
  const it = item || {};
  const mediaStatus = it.mediaStatus || "idle";

  // 1) In-flight → progress bar.
  if (isAnalyzing(mediaStatus)) {
    return (
      <div className="rsp-panel">
        <ProgressState progress={it.progress} />
      </div>
    );
  }

  // 2) Failed → error (Re-analyze button is in the card).
  if (mediaStatus === "analyze_failed") {
    return (
      <div className="rsp-panel">
        <FailedState error={it.mediaError} />
      </div>
    );
  }

  // 3) Narrative present → full deconstruction (each block null-safe).
  if (hasNarrative(it)) {
    const nv = it.narrative || {};
    const total = narrativeTotalTs(nv);
    return (
      <div className="rsp-panel">
        <HookBlock hook={nv.hook} />
        <ArcBlock arc={nv.arc} totalTs={total} />
        <EmotionBlock emotion_curve={nv.emotion_curve} rehooks={nv.rehooks} totalTs={total} />
        <OpenLoopsBlock open_loops={nv.open_loops} />
        <RetentionBlock retention_flags={nv.retention_flags} totalTs={total} />
        <PayoffCtaBlock payoff={nv.payoff} cta={nv.cta} />
        <ScorecardBlock scorecard={nv.scorecard} verdict={nv.verdict} />
        <ProvenanceFooter narrative={nv} />
      </div>
    );
  }

  // 4) Idle, no narrative → empty hint.
  return (
    <div className="rsp-panel">
      <div className="rsp-empty">
        <span className="rsp-empty-icon" aria-hidden="true">🧬</span>
        <span className="rsp-empty-text">
          Not yet deconstructed. Click <strong>Analyze</strong> to break this longform video into
          hook, arc, emotion curve and a 0–100 scorecard.
        </span>
      </div>
    </div>
  );
}

export default ReelStoryPanel;
