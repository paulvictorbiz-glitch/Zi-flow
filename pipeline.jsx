/* =========================================================
   Pipeline Board — owner lanes (rows) × workflow stage (cols)
   ========================================================= */

import React, { useState, useMemo } from "react";
import { DPill, StageSpine, ReelCard } from "./components.jsx";
import { useWorkflow } from "./store.jsx";

const PIPELINE_STAGES = [
  { key: "idea",      label: "IDEA POOL",   meta1: "4 aging items",      meta2: "2 worth triage" },
  { key: "selected",  label: "SELECTED",    meta1: "2 queued",           meta2: "Alex next up" },
  { key: "main",      label: "MAIN EDIT",   meta1: "3 active",           meta2: "1 blocked on hook" },
  { key: "review",    label: "REVIEW",      meta1: "2 waiting on PV",    meta2: "oldest 28h" },
  { key: "variants",  label: "VARIANTS",    meta1: "Sam has 2 active",   meta2: "1 lane may idle" },
  { key: "ready",     label: "READY",       meta1: "5 ready",            meta2: "next post in 2h" },
  { key: "posted",    label: "POSTED",      meta1: "147 posted",         meta2: "analytics live" },
];

const LANES = [
  {
    id: "alex",
    name: "Judy Adawag",
    role: "Skilled editor · discovery + main edit",
    stats: "3 active · 1 blocked · 2 due today",
    badge: { tone: "cyan", text: "Focus lane" },
  },
  {
    id: "paul",
    name: "Paul Victor",
    role: "Owner · approvals + handoff prep",
    stats: "Bottleneck role · review SLA 6h",
    badge: { tone: "amber", text: "2 reels waiting on you" },
  },
  {
    id: "sam",
    name: "Jay",
    role: "Variant editor · trials and packaging",
    stats: "2 active · may idle if 1 review slips",
  },
  {
    id: "review",
    name: "Leroy Crosby",
    role: "Optional reviewer · captions + brand",
    stats: "1 pass open · 1 cleared today",
  },
];

function Pipeline({ onOpen }) {
  const { reels, reviewLaneCards, actions } = useWorkflow();
  const [filter, setFilter] = useState("all");
  const [dragging, setDragging] = useState(null); // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  /* Multi-select: cards added via Cmd/Ctrl/Shift+click. Dragging
     any one of the selected cards moves the whole group; click
     (no modifier) opens the detail view as before and clears
     the selection. */
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  /* Board items = canonical reels + Maya's shadow cards. Lane is
     derived from owner unless the record carries an explicit lane
     (the shadow cards do). */
  const items = useMemo(() =>
    [...reels, ...reviewLaneCards]
      .filter(r => !r.archivedAt)
      .map(r => ({ ...r, lane: r.lane || r.owner })),
    [reels, reviewLaneCards]
  );

  /* Build cell index → reels (filtered) */
  const cells = useMemo(() => {
    const m = {};
    items.forEach(r => {
      if (filter === "blocked" && !(r.state === "block" || r.state === "warn")) return;
      const k = r.lane + "::" + r.stage;
      (m[k] = m[k] || []).push(r);
    });
    return m;
  }, [items, filter]);

  const handleDrop = (lane, stage) => {
    if (!dragging) return;
    /* If the dragged card is part of the selection, move all
       selected cards together; otherwise move just the dragged
       card. After a group move we clear selection. */
    const groupMove = selectedIds.size > 1 && selectedIds.has(dragging.id);
    if (groupMove) {
      for (const id of selectedIds) {
        actions.moveStage(id, { lane, stage });
      }
      setSelectedIds(new Set());
    } else {
      actions.moveStage(dragging.id, { lane, stage });
    }
    setDragging(null);
    setDropTarget(null);
  };

  /* Card click: with modifier → toggle in selection (no detail);
     without modifier → open detail and clear selection. */
  const handleCardClick = (reel, e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.stopPropagation();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(reel.id)) next.delete(reel.id);
        else next.add(reel.id);
        return next;
      });
      return;
    }
    if (selectedIds.size > 0) setSelectedIds(new Set());
    onOpen(reel);
  };

  const clearSelection = () => setSelectedIds(new Set());

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Pipeline board — owner lanes + stage spine</h1>
          <div className="sub">
            Rows answer <span style={{ color: "var(--fg)" }}>who has what</span>.
            Columns answer <span style={{ color: "var(--fg)" }}>where it is</span>.
            Built for fast bottleneck and idle-risk scanning across 4 operators.
          </div>
        </div>
        <div className="actions">
          <DPill tone="amber" active>● Bottleneck · owner review queue</DPill>
          <DPill>Collapsible cards</DPill>
          <DPill solid>View as day plan</DPill>
        </div>
      </div>

      {/* Stage spine */}
      <StageSpine stages={PIPELINE_STAGES} activeKey="review" />

      {/* Filter row */}
      <div style={{
        display: "flex", gap: 10, padding: "10px 22px",
        borderBottom: "1px dashed var(--line)",
        background: "var(--bg-0)",
        alignItems: "center",
      }}>
        <span className="mono muted">filters</span>
        <DPill active={filter === "all"} onClick={() => setFilter("all")}>All reels</DPill>
        <DPill active={filter === "blocked"} onClick={() => setFilter("blocked")} tone="red">Blocked / warn</DPill>
        <DPill>Owned by me</DPill>
        <DPill>Aging &gt; 24h</DPill>
        <DPill>Has FootageBrain link</DPill>
        <span style={{ flex: 1 }} />
        <span className="mono muted">sort:</span>
        <DPill solid>Aging desc</DPill>
        <DPill>Stage</DPill>
      </div>

      {/* Board grid */}
      <div className="board">
        {/* Column heads (offset by lane gutter) */}
        <div className="col-head" style={{ background: "var(--bg-0)" }}>
          <div className="lbl">OWNER / ROLE</div>
          <div className="meta">Rows = who has what.</div>
          <div className="meta">Columns = where it is.</div>
        </div>
        {PIPELINE_STAGES.map(s => (
          <div className="col-head" key={s.key}>
            <div className="lbl">{s.label}</div>
            <div className="meta">{COL_HINT[s.key]}</div>
          </div>
        ))}

        {/* Lanes */}
        {LANES.map(lane => (
          <React.Fragment key={lane.id}>
            <div className="lane-head">
              <div className="role">{lane.role.split(" · ")[0]}</div>
              <div className="name">{lane.name}</div>
              <div className="mono muted" style={{ fontSize: 10.5 }}>
                {lane.role.includes("·") ? lane.role.split("·").slice(1).join("·").trim() : ""}
              </div>
              <div className="stats">{lane.stats}</div>
              {lane.badge && (
                <span className={"pill " + lane.badge.tone + " dashed"} style={{ alignSelf: "flex-start" }}>
                  {lane.badge.text}
                </span>
              )}
            </div>
            {PIPELINE_STAGES.map(stage => {
              const reels = cells[lane.id + "::" + stage.key] || [];
              const targetKey = lane.id + "::" + stage.key;
              const isTarget = dropTarget === targetKey;
              return (
                <div
                  className={
                    "cell" +
                    (reels.length === 0 ? " empty" : "") +
                    (isTarget ? " drop-target" : "")
                  }
                  key={stage.key}
                  onDragOver={e => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dropTarget !== targetKey) setDropTarget(targetKey);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === targetKey) setDropTarget(null);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    handleDrop(lane.id, stage.key);
                  }}
                >
                  {reels.map(r => {
                    const isSelected = selectedIds.has(r.id);
                    const groupActive = isSelected && selectedIds.size > 1;
                    const isThisDrag = dragging && dragging.id === r.id;
                    const isInGroupDrag = dragging && selectedIds.has(dragging.id) && selectedIds.size > 1 && isSelected;
                    return (
                      <div
                        key={r.id}
                        draggable
                        onDragStart={e => {
                          setDragging(r);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                        className={isThisDrag ? "is-drag-wrap" : ""}
                        style={{
                          opacity: isThisDrag || isInGroupDrag ? 0.4 : 1,
                        }}
                      >
                        <ReelCard
                          reel={r}
                          state={r.state}
                          isSelected={isSelected}
                          onOpen={(reel, e) => handleCardClick(reel, e || {})}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Floating multi-select chip — appears whenever any cards
          are selected. Drag any selected card to move the group. */}
      {selectedIds.size > 0 && (
        <div className="multiselect-chip">
          <span className="ms-count">{selectedIds.size}</span>
          <span className="ms-label">selected · drag any to move the group</span>
          <a href="#" className="ms-clear"
             onClick={e => { e.preventDefault(); clearSelection(); }}>clear</a>
        </div>
      )}
    </div>
  );
}

const COL_HINT = {
  idea:     "Discovery + raw opportunities",
  selected: "Queued and greenlit",
  main:     "Skilled editor work",
  review:   "Owner sign-off + handoff",
  variants: "A/B and packaging",
  ready:    "Ready to post",
  posted:   "Live and measurable",
};

export { Pipeline };
