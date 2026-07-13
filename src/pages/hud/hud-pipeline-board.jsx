/* =========================================================
   HUD Pipeline Board — compact interactive lanes × stages grid
   Mounted by the /space HUD for the 'pipeline' card (replaces the
   read-only PipelineExpanded). Drag any editor's reel chip across
   lanes/stages → calls the SAME actions.moveStage the real Pipeline
   uses, so a move here reflects everywhere.

   Owner-only surface (the HUD is owner-gated). FLAT 2D DOM — native
   HTML5 drag-drop works because no ancestor here is transformed.
   Self-contained: reads store/roster via hooks; only props are
   onOpenTab + onClose. Scoped css lives in ./hud-pipeline-board.css
   (.hudpb-* only). Never throws past its own boundary.
   ========================================================= */

import React, { useMemo, useState, useCallback } from "react";
import { useWorkflow } from "../../store/store.jsx";
import { useRoster } from "../../lib/roster.jsx";
import { STAGES, STAGE_LABEL } from "../../lib/shared-data.jsx";
import "./hud-pipeline-board.css";

/* Lane row order — skilled first, then owner, then variant, then rest.
   Mirrors pipeline.jsx so the mini board reads the same top-to-bottom. */
const LANE_ROLE_ORDER = { skilled: 0, owner: 1, variant: 2 };

export function HudPipelineBoard({ onOpenTab, onClose }) {
  const wf = useWorkflow() || {};
  const { reels = [], reviewLaneCards = [], actions = {}, hiddenLaneIds } = wf;
  const { peopleList = [] } = useRoster() || {};

  const [dragging, setDragging] = useState(null);   // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  const [schedule, setSchedule] = useState(null);   // { reelId, lane } when dropping into posted
  const [scheduleDate, setScheduleDate] = useState("");

  /* Reviewers don't get a personal lane — they share the "review" lane. */
  const reviewerIds = useMemo(
    () => new Set(peopleList.filter((p) => p.role === "reviewer").map((p) => p.id)),
    [peopleList]
  );

  const hiddenSet = useMemo(
    () => new Set(Array.isArray(hiddenLaneIds) ? hiddenLaneIds : []),
    [hiddenLaneIds]
  );

  /* Rows = one lane per non-reviewer person + the shared "review" lane. */
  const lanes = useMemo(() => {
    const personLanes = peopleList
      .filter((p) => p.role !== "reviewer")
      .slice()
      .sort(
        (a, b) =>
          (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) ||
          (LANE_ROLE_ORDER[a.role] ?? 9) - (LANE_ROLE_ORDER[b.role] ?? 9)
      )
      .map((p) => ({ id: p.id, name: p.name }));
    const reviewer = peopleList.find((p) => p.role === "reviewer");
    personLanes.push({ id: "review", name: reviewer?.name || "Review" });
    return personLanes.filter((l) => !hiddenSet.has(l.id));
  }, [peopleList, reviewerIds, hiddenSet]);

  /* Board items = canonical reels + reviewer shadow cards. Lane derived from
     owner unless the record carries an explicit lane; reviewer-owned reels
     fold into the shared "review" lane (matches pipeline.jsx). */
  const items = useMemo(
    () =>
      [...reels, ...reviewLaneCards]
        .filter((r) => r && !r.archivedAt)
        .map((r) => {
          const lane = r.lane || r.owner;
          return { ...r, lane: reviewerIds.has(lane) ? "review" : lane };
        }),
    [reels, reviewLaneCards, reviewerIds]
  );

  /* cell key = `${lane}::${stage}` → reels in that cell */
  const cells = useMemo(() => {
    const m = {};
    items.forEach((r) => {
      const k = (r.lane || "") + "::" + (r.stage || "not_started");
      (m[k] = m[k] || []).push(r);
    });
    return m;
  }, [items]);

  /* The single move action — same as the real Pipeline. Optimistic in-store,
     then persisted. moveStage never throws (locked-reassign dispatches an
     error + returns), but guard defensively so the panel can't crash the HUD. */
  const move = useCallback(
    (id, patch) => {
      try {
        actions.moveStage?.(id, patch);
      } catch {
        /* swallow — never throw past the panel boundary */
      }
    },
    [actions]
  );

  const clearDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const handleDrop = (laneId, stageKey) => {
    const dragged = dragging;
    clearDrag();
    if (!dragged) return;
    /* No-op if it's already in this exact cell. */
    if ((dragged.lane || dragged.owner) === laneId && dragged.stage === stageKey) return;

    /* Dropping into "posted" mirrors the real Pipeline: prompt for a schedule
       date via a small inline input, then move with scheduledPostDate. */
    if (stageKey === "posted") {
      setSchedule({ reelId: dragged.id, lane: laneId });
      setScheduleDate("");
      return;
    }
    move(dragged.id, { lane: laneId, stage: stageKey });
  };

  const commitSchedule = () => {
    if (!schedule) return;
    move(schedule.reelId, {
      lane: schedule.lane,
      stage: "posted",
      scheduledPostDate: scheduleDate || null,
    });
    setSchedule(null);
    setScheduleDate("");
  };

  const openTab = (key) => {
    try {
      onOpenTab?.(key);
    } catch {
      /* never throw */
    }
  };

  return (
    <div className="hudpb-root">
      <div className="hudpb-head">
        <div className="hudpb-title">Pipeline</div>
        <div className="hudpb-actions">
          <button
            type="button"
            className="hudpb-link"
            onClick={() => openTab("pipeline")}
          >
            Open full Pipeline ↗
          </button>
        </div>
      </div>

      <div
        className="hudpb-grid"
        style={{
          gridTemplateColumns: `minmax(84px, 108px) repeat(${STAGES.length}, minmax(84px, 1fr))`,
        }}
      >
        {/* Column header row */}
        <div className="hudpb-corner">Editor</div>
        {STAGES.map((s) => (
          <div key={s} className="hudpb-colhead" title={STAGE_LABEL[s] || s}>
            {STAGE_LABEL[s] || s}
          </div>
        ))}

        {/* Lane rows */}
        {lanes.map((lane) => (
          <React.Fragment key={lane.id}>
            <div className="hudpb-lanehead" title={lane.name}>
              {lane.name}
            </div>
            {STAGES.map((stageKey) => {
              const key = lane.id + "::" + stageKey;
              const cellReels = cells[key] || [];
              const isTarget = dropTarget === key;
              return (
                <div
                  key={stageKey}
                  className={
                    "hudpb-cell" +
                    (cellReels.length === 0 ? " is-empty" : "") +
                    (isTarget ? " is-target" : "")
                  }
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dropTarget !== key) setDropTarget(key);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === key) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(lane.id, stageKey);
                  }}
                >
                  {cellReels.map((r) => {
                    const isDrag = dragging && dragging.id === r.id;
                    const label = r.title || "Untitled";
                    return (
                      <div
                        key={r.id}
                        className={"hudpb-chip" + (isDrag ? " is-dragging" : "")}
                        draggable
                        onDragStart={(e) => {
                          setDragging(r);
                          e.dataTransfer.effectAllowed = "move";
                          try {
                            e.dataTransfer.setData("text/plain", String(r.id));
                          } catch {
                            /* some browsers require setData; ignore failures */
                          }
                        }}
                        onDragEnd={clearDrag}
                        title={label}
                      >
                        {r.displayNumber != null && (
                          <span className="hudpb-chip-num">#{r.displayNumber}</span>
                        )}
                        <span className="hudpb-chip-title">{label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {lanes.length === 0 && (
        <div className="hudpb-empty">No editor lanes to show.</div>
      )}

      <div className="hudpb-hint">Drag a chip across a cell to move or reassign it.</div>

      {/* Inline schedule-date prompt for drops into "Posted" */}
      {schedule && (
        <div className="hudpb-sched-backdrop" onClick={() => setSchedule(null)}>
          <div className="hudpb-sched" onClick={(e) => e.stopPropagation()}>
            <div className="hudpb-sched-title">Move to Posted</div>
            <div className="hudpb-sched-sub">Set a scheduled post date (optional).</div>
            <input
              type="date"
              className="hudpb-sched-input"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
            />
            <div className="hudpb-sched-foot">
              <button
                type="button"
                className="hudpb-btn"
                onClick={() => setSchedule(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hudpb-btn is-primary"
                onClick={commitSchedule}
              >
                Move to Posted
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HudPipelineBoard;
