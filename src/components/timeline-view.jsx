/* =========================================================
   TimelineView — L1 PRESENTATION (prop-driven, no data imports)

   A READ-ONLY, multi-lane CapCut-style timeline for the public
   landing page. No drag, no CRUD, no inspector — it only renders
   segments as positioned blocks on their gene's lane and supports a
   single "highlight" interaction: when `hoveredGene` is set, the
   matching lane lights up and all other lanes dim. This is the
   payoff for hovering a gene node on the helix.

   It REUSES the clip-position math + ruler from the live
   ReelDeconstructor (parseTs / fmtTs / clamp / TimelineRuler) so the
   read-only timeline and the editable one can never drift. It does
   NOT reuse ClipBlock directly because ClipBlock's GENE_COLOR map is
   keyed on the legacy gene set (music/hook/font…) and resolves to CSS
   vars, whereas the demo lanes carry raw hex colors — so we render a
   tiny local read-only block that takes the lane color explicitly but
   uses the SAME left%/width% math as ClipBlock.

   Props:
     segments    — [{ id, label, gene, startTs, endTs, ... }]
     lanes       — [{ key, label, color, order }]  (one per gene)
     totalSec    — number (ruler + clip math)
     hoveredGene — string|null

   Must NOT import reel-dna-demo.jsx — all data is via props.
   ========================================================= */
import React from "react";
import { parseTs, fmtTs, clamp, TimelineRuler } from "../pages/reel-deconstructor.jsx";
import "./timeline-view.css";

/* Read-only clip block. Same left%/width% math as ClipBlock, but the
   color is passed in (lane.color, a raw hex) instead of resolved from
   the legacy GENE_COLOR map. No pointer handlers, no handles. */
function ReadOnlyClip({ seg, totalSec, color }) {
  const s = parseTs(seg.startTs);
  const e = parseTs(seg.endTs);
  if (s == null || !totalSec) return null;

  const leftPct = clamp((s / totalSec) * 100, 0, 99);
  const rawWidth = e != null ? ((e - s) / totalSec) * 100 : 2;
  const widthPct = clamp(Math.max(rawWidth, 1.5), 0, 100 - leftPct);

  const dur = s != null && e != null ? fmtTs(e - s) : null;

  return (
    <div
      className="tlv-clip"
      style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }}
      title={`${seg.label}  ${seg.startTs || ""}${seg.endTs ? " → " + seg.endTs : ""}${dur ? "  (" + dur + ")" : ""}`}
    >
      <span className="tlv-clip-label">{seg.label}</span>
    </div>
  );
}

export function TimelineView({ segments = [], lanes = [], totalSec = 0, hoveredGene = null }) {
  const orderedLanes = [...lanes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const dimmed = hoveredGene != null;

  return (
    <div className={"tlv" + (dimmed ? " tlv--focused" : "")}>
      <div className="tlv-scroll">
        <TimelineRuler totalSec={totalSec} />

        <div className="tlv-lanes">
          {orderedLanes.map((lane) => {
            const segsOnLane = segments.filter((seg) => seg.gene === lane.key);
            const active = hoveredGene === lane.key;
            return (
              <div
                key={lane.key}
                className={
                  "tlv-lane" +
                  (active ? " is-active" : "") +
                  (dimmed && !active ? " is-dim" : "")
                }
              >
                <div className="tlv-lane-label" style={{ color: lane.color }}>
                  <span
                    className="tlv-lane-dot"
                    style={{ background: lane.color }}
                  />
                  {lane.label}
                </div>
                <div className="tlv-lane-track">
                  {segsOnLane.map((seg) => (
                    <ReadOnlyClip
                      key={seg.id}
                      seg={seg}
                      totalSec={totalSec}
                      color={lane.color}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TimelineView;
