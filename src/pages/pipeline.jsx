/* =========================================================
   Pipeline Board — owner lanes (rows) × workflow stage (cols)
   ========================================================= */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { DPill, ReelCard } from "../components/components.jsx";
import BoxTable from "../components/box-table.jsx";
import PipelineGraph from "./pipeline-graph.jsx";
import { useWorkflow } from "../store/store.jsx";
import { STAGES, STAGE_LABEL } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import { usePermissions, useIsOwner } from "../lib/permissions.jsx";
import { useIsMobile } from "../lib/use-is-mobile.js";

const SOL_PIPELINE_CSS = `
[data-theme="solarin"] .pl-wrap {
  padding: 28px 16px; box-sizing: border-box;
}
[data-theme="solarin"] .pl-header { margin-bottom: 20px; }
[data-theme="solarin"] .pl-board {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px);
}
[data-theme="solarin"] .pl-col-header-row {
  display: grid; grid-template-columns: 170px repeat(5,1fr);
  background: var(--s-inner-dark); padding: 0;
}
[data-theme="solarin"] .pl-col-head {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: var(--peach);
  padding: 10px 14px;
  border-right: 1px solid var(--s-divider-soft);
}
[data-theme="solarin"] .pl-owner-row {
  display: grid; grid-template-columns: 170px repeat(5,1fr);
  border-top: 1px solid var(--s-divider-soft);
}
[data-theme="solarin"] .pl-owner-cell {
  padding: 12px 14px; border-right: 1px solid var(--s-divider-soft);
  display: flex; align-items: center; gap: 10px;
}
[data-theme="solarin"] .pl-owner-name {
  font-family: var(--f-ui); font-size: 13px; font-weight: 600;
  color: var(--s-fg-soft);
}
[data-theme="solarin"] .pl-owner-role {
  font-family: var(--f-label); font-size: 10px; color: var(--s-fg-muted);
  text-transform: uppercase; letter-spacing: .06em;
}
[data-theme="solarin"] .pl-stage-cell {
  padding: 10px 10px; border-right: 1px solid var(--s-divider-soft);
  display: flex; flex-direction: column; gap: 6px;
}
`;

/* Mobile board layout (T2 owns .pl-*). At ≤768px the 5 stage columns can't
   share a phone width and stay legible — the inline `1fr` tracks just shrink to
   ~30px and cards collapse into vertical slivers. Here we floor each stage
   column via --pl-col-min and slim the lane gutter via --pl-lane-w, so the
   board grows past the viewport and horizontal-scrolls (the .board
   overflow-x:auto from styles-mobile.css is the scroll container). Desktop
   never sets these vars → the inline fallbacks (200px / 0px) keep ≥769px
   byte-identical. */
const PL_MOBILE_CSS = `
@media (max-width: 768px) {
  .pl-board {
    --pl-lane-w: 120px;
    --pl-col-min: 158px;
  }
  /* Lane / column heads read fine at the slimmer gutter, just tighten padding. */
  .pl-board .lane-head { padding: 12px 10px; }
  .pl-board .col-head { padding: 10px 10px; }
  /* Give tapped cards a real touch target — the compact grid tiles stay, but
     list-mode cards shouldn't clamp so hard they're unreadable. */
  .pl-board .cell { min-height: 96px; }
}
@media (max-width: 480px) {
  .pl-board {
    --pl-lane-w: 104px;
    --pl-col-min: 150px;
  }
}

/* ── Mobile pipeline list (<PipelineMobile>) — only ever rendered ≤768px, so
   these classes never exist on desktop and need no width gate. ─────────────── */
.plm-wrap { display: flex; flex-direction: column; gap: 14px; padding: 8px 12px 20px; }
.plm-stage { border: 1px solid var(--line, rgba(255,255,255,.1)); border-radius: 10px; overflow: hidden; background: var(--bg-1, #0f1311); }
.plm-stage-head {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-0, #0b0e0d);
  border-bottom: 1px solid var(--line, rgba(255,255,255,.1));
}
.plm-stage-toggle {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  background: none; border: none; cursor: pointer;
  color: var(--fg, #e8efec);
  font-family: var(--f-mono, ui-monospace, monospace);
  font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
  padding: 12px 10px; text-align: left;
}
.plm-stage-chev { color: var(--fg-dim, #8fa39c); font-size: 11px; width: 12px; }
.plm-stage-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plm-stage-count {
  flex-shrink: 0; min-width: 22px; text-align: center;
  padding: 1px 7px; border-radius: 999px;
  background: var(--bg-3, rgba(255,255,255,.08)); color: var(--fg-dim, #8fa39c);
  font-size: 11px;
}
.plm-stage-table {
  flex-shrink: 0; margin-right: 8px;
  background: none; border: 1px solid var(--line-hard, rgba(255,255,255,.16));
  border-radius: 6px; color: var(--c-cyan, #58d0c4);
  font-family: var(--f-mono, ui-monospace, monospace); font-size: 11px;
  padding: 5px 9px; min-height: 30px; cursor: pointer;
}
.plm-cards { display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.plm-empty { color: var(--fg-mute, #6d7f78); font-family: var(--f-mono, ui-monospace, monospace); font-size: 12px; padding: 6px 2px; }
.plm-card { display: flex; flex-direction: column; gap: 6px; }
.plm-card-lane {
  font-family: var(--f-mono, ui-monospace, monospace); font-size: 10px;
  letter-spacing: .06em; text-transform: uppercase; color: var(--fg-mute, #6d7f78);
}
/* ReelCard fills the column and is never clamped to the board's compact tile. */
.plm-card .reel { width: 100%; box-sizing: border-box; height: auto; }
.plm-move {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--f-mono, ui-monospace, monospace); font-size: 11px;
  color: var(--fg-dim, #8fa39c);
}
.plm-move-lbl { flex-shrink: 0; text-transform: uppercase; letter-spacing: .05em; }
.plm-move-sel {
  flex: 1 1 auto; min-width: 0;
  background: var(--bg-2, #101413); color: var(--fg, #e8efec);
  border: 1px solid var(--line-hard, rgba(255,255,255,.16)); border-radius: 6px;
  font-family: var(--f-mono, ui-monospace, monospace); font-size: 12px;
  padding: 8px 10px; min-height: 38px;
}
.plm-more {
  background: none; border: 1px dashed var(--line-hard, rgba(255,255,255,.2));
  border-radius: 8px; color: var(--c-cyan, #58d0c4);
  font-family: var(--f-mono, ui-monospace, monospace); font-size: 12px;
  padding: 10px; cursor: pointer; margin-top: 2px;
}
`;

/* Board columns derived from the canonical STAGES list. Labels are
   upper-cased here because the board column heads use that style;
   list-view / archived-view consume STAGE_LABEL as-is (title case). */
const PIPELINE_STAGES = STAGES.map((key) => ({ key, label: STAGE_LABEL[key].toUpperCase() }));

/* Lane row order — skilled editor first, then owner, then variant,
   then anyone else. Reviewers don't get a personal lane; they share
   the special "review" workflow lane appended last. */
const LANE_ROLE_ORDER = { skilled: 0, owner: 1, variant: 2 };

/* ── Mobile pipeline: single-column, stage-grouped list of full ReelCards ──
   The desktop lane×stage grid is unreadable on a phone, so on mobile we group
   every card by STAGE (owner shown as a small caption on each card, since the
   lane dimension collapses) and stack readable, tappable cards vertically:
     · tap a card → opens the full detail/editor (onOpen)
     · the card's ⋯ kebab → duplicate / archive / delete (ReelCard's own menu)
     · "Move to" select → change stage (onMove; reuses the board's guards)
   Stages with many reels render a capped preview + a button into the (now
   phone-friendly) dense BoxTable for bulk triage. */
const PLM_INLINE_LIMIT = 20;
function PipelineMobile({ stages, itemsByStage, laneNameById, onOpen, onMove, onExpand, canMove }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <div className="plm-wrap">
      {stages.map(stage => {
        const list = itemsByStage[stage.key] || [];
        const isCollapsed = collapsed.has(stage.key);
        const shown = isCollapsed ? [] : list.slice(0, PLM_INLINE_LIMIT);
        const overflow = list.length - shown.length;
        return (
          <section className="plm-stage" key={stage.key}>
            <div className="plm-stage-head">
              <button type="button" className="plm-stage-toggle"
                      onClick={() => toggle(stage.key)} aria-expanded={!isCollapsed}>
                <span className="plm-stage-chev">{isCollapsed ? "▸" : "▾"}</span>
                <span className="plm-stage-name">{stage.label}</span>
                <span className="plm-stage-count">{list.length}</span>
              </button>
              {list.length > 0 && (
                <button type="button" className="plm-stage-table"
                        title="Open this stage in a dense table (search · bulk move · duplicate)"
                        onClick={() => onExpand(stage.key)}>⤢ Table</button>
              )}
            </div>
            {!isCollapsed && (
              <div className="plm-cards">
                {list.length === 0 && <div className="plm-empty">No reels in this stage.</div>}
                {shown.map(r => (
                  <div className="plm-card" key={r.id}>
                    <div className="plm-card-lane">{laneNameById[r.lane] || r.lane || "—"}</div>
                    <ReelCard reel={r} state={r.state} compact={false}
                              onOpen={(reel, e) => onOpen(reel, e || {})} />
                    {canMove && (
                      <label className="plm-move">
                        <span className="plm-move-lbl">Move to</span>
                        <select className="plm-move-sel" value={stage.key}
                                onChange={(e) => onMove(r, e.target.value)}>
                          {stages.map(s => (
                            <option key={s.key} value={s.key}>{STAGE_LABEL[s.key] || s.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                ))}
                {overflow > 0 && (
                  <button type="button" className="plm-more" onClick={() => onExpand(stage.key)}>
                    View all {list.length} in dense table →
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Pipeline({ onOpen }) {
  const { reels, reviewLaneCards, actions, hiddenLaneIds } = useWorkflow();
  const { peopleList } = useRoster();
  const { can } = usePermissions();
  const isOwner = useIsOwner();
  const { isMobile } = useIsMobile();
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleDate, setScheduleDate] = useState("");

  /* Row / column visibility — persisted to localStorage */
  const [hiddenLanes, setHiddenLanes] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pipeline_hidden_lanes") || "[]")); }
    catch { return new Set(); }
  });
  /* The finished columns (Completed + Posted) are collapsed BY DEFAULT so the
     active-work columns get the width and the card text stays readable. New
     visitors get them hidden; existing users get them hidden once (a one-time
     v1 seed) — after that, anyone's manual show/hide choice is respected. */
  const [hiddenCols, setHiddenCols] = useState(() => {
    const DEFAULT_HIDDEN = ["completed", "posted"];
    try {
      const stored = localStorage.getItem("pipeline_hidden_cols");
      const seeded = localStorage.getItem("pipeline_hidden_cols_seeded_v1") === "1";
      let set;
      if (stored == null) {
        set = new Set(DEFAULT_HIDDEN); // first ever visit on this device
      } else {
        set = new Set(JSON.parse(stored));
        if (!seeded) DEFAULT_HIDDEN.forEach(k => set.add(k)); // apply once to existing users
      }
      localStorage.setItem("pipeline_hidden_cols_seeded_v1", "1");
      return set;
    } catch { return new Set(DEFAULT_HIDDEN); }
  });
  /* Optional series/playlist grouping — clusters same-series reels within each
     cell and shows a series header. Off by default (= current flat board). */
  const [groupBySeries, setGroupBySeries] = useState(
    () => localStorage.getItem("pipeline_group_by_series") === "1");
  const [cardView, setCardView] = useState(
    () => localStorage.getItem("pipeline_card_view") || "list");
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  const [lanesMenuOpen, setLanesMenuOpen] = useState(false);
  const lanesMenuRef = useRef(null);
  const [laneCtxMenu, setLaneCtxMenu] = useState(null);
  /* Full-screen dense-table overlay for one box (lane × stage). Built for
     boxes with hundreds of reels (bulk triage). { laneId, laneName, stageKey } */
  const [expandBox, setExpandBox] = useState(null);

  useEffect(() => {
    localStorage.setItem("pipeline_hidden_lanes", JSON.stringify([...hiddenLanes]));
  }, [hiddenLanes]);

  /* When user_preferences loads from DB (hiddenLaneIds), merge into local set.
     DB is authoritative when non-empty; local localStorage is the fallback. */
  useEffect(() => {
    if (!hiddenLaneIds || hiddenLaneIds.length === 0) return;
    setHiddenLanes(new Set(hiddenLaneIds));
  }, [hiddenLaneIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    localStorage.setItem("pipeline_hidden_cols", JSON.stringify([...hiddenCols]));
  }, [hiddenCols]);
  useEffect(() => {
    localStorage.setItem("pipeline_group_by_series", groupBySeries ? "1" : "0");
  }, [groupBySeries]);
  useEffect(() => {
    localStorage.setItem("pipeline_card_view", cardView);
  }, [cardView]);

  /* Close column menu on outside click */
  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  /* Close lanes menu on outside click */
  useEffect(() => {
    if (!lanesMenuOpen) return;
    const handler = (e) => {
      if (lanesMenuRef.current && !lanesMenuRef.current.contains(e.target)) setLanesMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [lanesMenuOpen]);

  /* Close lane context menu on outside click */
  useEffect(() => {
    if (!laneCtxMenu) return;
    const handler = () => setLaneCtxMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [laneCtxMenu]);

  const toggleLane = (laneId) => {
    setHiddenLanes(prev => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId); else next.add(laneId);
      return next;
    });
    actions.toggleLaneHidden(laneId);
  };
  const toggleCol = (colKey) => setHiddenCols(prev => {
    const next = new Set(prev);
    if (next.has(colKey)) next.delete(colKey); else next.add(colKey);
    return next;
  });

  /* Board rows, built live from the team roster: one lane per
     non-reviewer member (so a newly-added editor gets their own row),
     plus the shared "review" lane named after the reviewer. */
  /* Reviewers don't get a personal lane — their work lives in the single
     shared "review" lane below. Without this filter a reviewer showed up
     TWICE (their own person row + the review row, which is named after the
     reviewer): the "two Leroy Crosby lanes" bug. Keyed on role, so it holds
     for any current/future reviewer, and for more than one of them. */
  const reviewerIds = useMemo(
    () => new Set(peopleList.filter(p => p.role === "reviewer").map(p => p.id)),
    [peopleList]
  );

  const lanes = useMemo(() => {
    const personLanes = peopleList
      .filter(p => p.role !== "reviewer")
      .sort((a, b) =>
        (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) ||
        (LANE_ROLE_ORDER[a.role] ?? 9) - (LANE_ROLE_ORDER[b.role] ?? 9))
      .map(p => ({ id: p.id, name: p.name }));
    const reviewer = peopleList.find(p => p.role === "reviewer");
    personLanes.push({ id: "review", name: reviewer?.name || "Reviewer" });
    return personLanes;
  }, [peopleList]);

  const [dragging, setDragging] = useState(null); // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  const [dropOnCard, setDropOnCard] = useState(null); // { id, before } — reorder target
  const [blockedStage, setBlockedStage] = useState(null); // stage key flashing red after a blocked drop
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
      .map(r => {
        const lane = r.lane || r.owner;
        // A reel owned by / pinned to a reviewer has no personal lane to land
        // in anymore — fold it into the shared "review" lane so it's never
        // dropped from the board (and never resurrects a duplicate reviewer row).
        return { ...r, lane: reviewerIds.has(lane) ? "review" : lane };
      }),
    [reels, reviewLaneCards, reviewerIds]
  );

  /* Build cell index → reels (filtered) */
  const cells = useMemo(() => {
    const m = {};
    items.forEach(r => {
      const k = r.lane + "::" + r.stage;
      (m[k] = m[k] || []).push(r);
    });
    // Apply the user's manual order. Cards without a board_order keep their
    // existing relative order and sit after the ordered ones. When grouping by
    // series, cluster same-series reels first (untagged reels sort last), then
    // fall back to board_order within each series.
    const seriesKey = (r) => (r.series ? r.series.toLowerCase() : "￿");
    Object.values(m).forEach(list =>
      list.sort((a, b) =>
        (groupBySeries ? seriesKey(a).localeCompare(seriesKey(b)) : 0) ||
        (a.board_order ?? Infinity) - (b.board_order ?? Infinity)));
    return m;
  }, [items, groupBySeries]);

  /* Flash the Completed column header red for 700 ms to signal a blocked drop. */
  const flashBlocked = useCallback((stage) => {
    setBlockedStage(stage);
    setTimeout(() => setBlockedStage(null), 700);
  }, []);

  const canMove = can("moveReel");

  const handleDrop = (lane, stage) => {
    if (!dragging) return;

    /* Outer gate: if the role can't move reel cards at all, abort. */
    if (!canMove) {
      setDragging(null);
      setDropTarget(null);
      return;
    }

    /* Block non-owners from dropping into the Completed column. */
    if (stage === "completed" && !can("moveToCompleted")) {
      flashBlocked("completed");
      setDragging(null);
      setDropTarget(null);
      return;
    }

    /* Intercept drops into "posted" — show the schedule date modal
       before committing the move. Group drags to "posted" are also
       caught; we clear the selection and treat it as a single move
       so the modal flow stays simple. */
    if (stage === "posted") {
      const groupMove = selectedIds.size > 1 && selectedIds.has(dragging.id);
      if (groupMove) setSelectedIds(new Set());
      setScheduleModal({ reelId: dragging.id, lane, fromStage: dragging.stage });
      setScheduleDate("");
      setDragging(null);
      setDropTarget(null);
      return;
    }

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

  /* Drop a card ONTO another card → reorder within (or move into) that card's
     cell, persisting the new order via board_order. Group drags fall back to a
     plain cell move. */
  const handleCardDrop = (target, before) => {
    setDropOnCard(null);
    if (!dragging || dragging.id === target.id) { setDragging(null); setDropTarget(null); return; }

    /* Outer gate: no move capability → abort before any reorder/move. */
    if (!canMove) { setDragging(null); setDropTarget(null); return; }

    /* Same completed-column gate — covers drops onto cards, not just empty cells. */
    if (target.stage === "completed" && !can("moveToCompleted")) {
      flashBlocked("completed");
      setDragging(null);
      setDropTarget(null);
      return;
    }

    if (selectedIds.size > 1 && selectedIds.has(dragging.id)) {
      handleDrop(target.lane, target.stage);   // group move — no reorder
      return;
    }
    const dragged = dragging;
    const cellKey = target.lane + "::" + target.stage;
    const sameCell = dragged.lane === target.lane && dragged.stage === target.stage;
    const list = (cells[cellKey] || []).filter(r => r.id !== dragged.id);
    let ti = list.findIndex(r => r.id === target.id);
    if (ti < 0) ti = list.length;
    list.splice(before ? ti : ti + 1, 0, dragged);
    if (!sameCell) actions.moveStage(dragged.id, { lane: target.lane, stage: target.stage });
    // Reindex the cell so the order persists (only write the ones that changed).
    list.forEach((r, i) => { if (r.board_order !== i) actions.updateReel(r.id, { board_order: i }); });
    setDragging(null); setDropTarget(null);
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

  const visibleStages = PIPELINE_STAGES.filter(s => !hiddenCols.has(s.key));

  /* ── Mobile layout support ────────────────────────────────────────────────
     The lane×stage grid is unusable on a phone (5+ columns squeeze every card
     down to an unreadable sliver). On mobile we render a single-column,
     stage-grouped list of full ReelCards instead — see <PipelineMobile>. These
     memos/handler feed it, reusing the exact same store actions as the board so
     open / duplicate / archive / move behave identically. */
  const itemsByStage = useMemo(() => {
    const m = {};
    for (const r of items) (m[r.stage] = m[r.stage] || []).push(r);
    Object.values(m).forEach(list =>
      list.sort((a, b) => (a.board_order ?? Infinity) - (b.board_order ?? Infinity)));
    return m;
  }, [items]);
  const laneNameById = useMemo(
    () => Object.fromEntries(lanes.map(l => [l.id, l.name])),
    [lanes]);

  /* Move a single card to another stage (the mobile replacement for drag/drop).
     Mirrors handleDrop's guards: the Completed gate and the Posted → schedule-
     modal intercept, so scheduling still runs on mobile. Lane is preserved. */
  const moveCardToStage = (reel, stage) => {
    if (!canMove || !stage || stage === reel.stage) return;
    if (stage === "completed" && !can("moveToCompleted")) { flashBlocked("completed"); return; }
    if (stage === "posted") {
      setScheduleModal({ reelId: reel.id, lane: reel.lane, fromStage: reel.stage });
      setScheduleDate("");
      return;
    }
    actions.moveStage(reel.id, { lane: reel.lane, stage });
  };

  return (
    <div className="pl-wrap">
      <style>{SOL_PIPELINE_CSS}</style>
      <style>{PL_MOBILE_CSS}</style>
      <div className="page-head pl-header">
        <div className="titles">
          <h1>Pipeline</h1>
          <div className="sub">
            {isMobile
              ? "Grouped by stage. Tap a card to open · ⋯ to duplicate/archive · Move to… to change stage."
              : "Rows = who owns it. Columns = where it is. Drag to move."}
          </div>
        </div>
        {!isMobile && (
        <div className="actions">
          <DPill active={groupBySeries} onClick={() => setGroupBySeries(v => !v)}>Group by series</DPill>
          {/* Column visibility menu */}
          <div ref={colMenuRef} style={{ position: "relative" }}>
            <DPill onClick={() => setColMenuOpen(o => !o)}>
              Columns {hiddenCols.size > 0 ? `(${hiddenCols.size} hidden)` : "▾"}
            </DPill>
            {colMenuOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                background: "var(--bg-1)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 0", minWidth: 180,
                boxShadow: "0 4px 16px rgba(0,0,0,.35)",
              }}>
                {PIPELINE_STAGES.map(s => (
                  <label key={s.key} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 16px", cursor: "pointer",
                    color: hiddenCols.has(s.key) ? "var(--fg-dim)" : "var(--fg-0)",
                  }}>
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(s.key)}
                      onChange={() => toggleCol(s.key)}
                      style={{ accentColor: "var(--c-cyan)", width: 15, height: 15 }}
                    />
                    {s.label}
                  </label>
                ))}
                {hiddenCols.size > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                    <button onClick={() => setHiddenCols(new Set())} style={{
                      display: "block", width: "100%", background: "none", border: "none",
                      color: "var(--c-cyan)", cursor: "pointer", padding: "6px 16px", textAlign: "left", fontSize: 13,
                    }}>Show all columns</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Lanes visibility toolbar + card view toggle (desktop board only) */}
      {!isMobile && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 4px", position: "relative" }}>
        <div style={{ position: "relative" }} ref={lanesMenuRef}>
          <button
            onClick={() => setLanesMenuOpen(o => !o)}
            style={{
              background: "var(--bg-2)", border: "1px solid var(--line-hard)",
              borderRadius: 4, color: hiddenLanes.size > 0 ? "var(--c-amber)" : "var(--fg-dim)",
              fontFamily: "var(--f-mono)", fontSize: 11, padding: "4px 10px", cursor: "pointer"
            }}
          >
            Lanes{hiddenLanes.size > 0 ? ` (${hiddenLanes.size} hidden)` : ""}
          </button>
          {lanesMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999,
              background: "var(--bg-2)", border: "1px solid var(--line-hard)",
              borderRadius: 6, padding: "8px 0", minWidth: 200,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
            }}>
              <div style={{ padding: "4px 14px 8px", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Team lanes
              </div>
              {lanes.map(lane => (
                <label key={lane.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={!hiddenLanes.has(lane.id)}
                    onChange={() => toggleLane(lane.id)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: hiddenLanes.has(lane.id) ? "var(--fg-dim)" : "var(--fg)" }}>
                    {lane.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="view-toggle">
          {["list", "2x2", "3x3"].map(v => (
            <button key={v} className={cardView === v ? "is-active" : ""} onClick={() => setCardView(v)}>
              {v === "list" ? "≡ List" : v === "2x2" ? "⊞ 2×2" : "⊟ 3×3"}
            </button>
          ))}
          {/* Owner-only Obsidian-style graph of editors ↔ reels ↔ shared content. */}
          {isOwner && (
            <button className={cardView === "graph" ? "is-active" : ""} onClick={() => setCardView("graph")}>
              ◉ Graph
            </button>
          )}
        </div>
      </div>
      )}

      {isMobile ? (
        <PipelineMobile
          stages={PIPELINE_STAGES}
          itemsByStage={itemsByStage}
          laneNameById={laneNameById}
          onOpen={handleCardClick}
          onMove={moveCardToStage}
          onExpand={(stageKey) => setExpandBox({ laneName: "All lanes", stageKey, allStage: true })}
          canMove={canMove}
        />
      ) : isOwner && cardView === "graph" ? (
        <PipelineGraph reels={items} peopleList={peopleList} onOpenReel={(r) => handleCardClick(r, {})} />
      ) : (
      /* Board grid */
      <div className="board pl-board" style={{
        /* Widths come from CSS vars so the mobile stylesheet (PL_MOBILE_CSS)
           can floor each stage column to a readable min-width — the board then
           overflows and horizontal-scrolls instead of squishing 5 columns into
           a phone width. Desktop resolves the fallbacks (200px / 0px) →
           byte-identical to the previous static template. */
        gridTemplateColumns: `var(--pl-lane-w, 200px) repeat(${visibleStages.length}, minmax(var(--pl-col-min, 0px), 1fr))`,
      }}>
        {/* Column heads (offset by lane gutter) */}
        <div className="col-head pl-col-head" style={{ background: "var(--bg-0)" }}>
          <div className="lbl">OWNER / ROLE</div>
          <div className="meta">Rows = who has what.</div>
          <div className="meta">Columns = where it is.</div>
        </div>
        {visibleStages.map(s => {
          const count = items.filter(r => r.stage === s.key).length;
          const isBlocked = blockedStage === s.key;
          return (
            <div
              className="col-head pl-col-head"
              key={s.key}
              style={isBlocked ? {
                outline: "2px solid var(--c-red)",
                background: "var(--c-red-soft)",
                transition: "background 0.1s, outline 0.1s",
              } : undefined}
            >
              <div className="lbl" style={isBlocked ? { color: "var(--c-red)" } : undefined}>
                {isBlocked ? "✕ " : ""}{s.label}
              </div>
              <div className="meta">{isBlocked ? "not allowed" : count + " reel" + (count === 1 ? "" : "s")}</div>
            </div>
          );
        })}

        {/* Lanes */}
        {lanes.map((lane, laneIdx) => {
          if (hiddenLanes.has(lane.id)) return null;
          const laneCount = items.filter(r => r.lane === lane.id).length;
          return (
          <React.Fragment key={lane.id}>
            <div
              className="lane-head pl-owner-cell"
              onContextMenu={e => { e.preventDefault(); if (isOwner) setLaneCtxMenu({ laneId: lane.id, x: e.clientX, y: e.clientY }); }}
            >
              <div className="name">{lane.name}</div>
              <div className="stats">{laneCount} reel{laneCount === 1 ? "" : "s"}</div>
            </div>
            {visibleStages.map(stage => {
              const reels = cells[lane.id + "::" + stage.key] || [];
              const targetKey = lane.id + "::" + stage.key;
              const isTarget = dropTarget === targetKey;
              return (
                <div
                  className={
                    "cell pl-stage-cell" +
                    (reels.length === 0 ? " empty" : "") +
                    (isTarget ? " drop-target" : "") +
                    (cardView !== "list" ? " cell--" + cardView : "")
                  }
                  key={stage.key}
                  style={{ position: "relative" }}
                  onDragOver={e => {
                    if (!dragging) return;
                    /* No move capability → never show a drop target. */
                    if (!canMove) return;
                    /* Don't highlight Completed as a valid drop target when blocked. */
                    if (stage.key === "completed" && !can("moveToCompleted")) return;
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
                  {/* A busy box (hundreds of reels) sprawls the cell and stretches
                      the whole grid row, so collapse it to a single clickable count
                      tile — the dense table opens on click. Small boxes keep cards. */}
                  {reels.length >= 6 ? (
                    <button
                      type="button"
                      className="pl-box-collapsed"
                      title={`Open ${reels.length} reels in a dense table`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandBox({ laneId: lane.id, laneName: lane.name, stageKey: stage.key });
                      }}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: 2, width: "100%", minHeight: 66,
                        padding: "10px 8px", cursor: "pointer", borderRadius: 8,
                        border: "1px dashed var(--bd, rgba(255,255,255,0.2))",
                        background: "var(--bg-2, rgba(20,22,28,0.6))",
                        color: "var(--c-cyan, #2dd4bf)",
                      }}
                    >
                      <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{reels.length}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>reels · ⤢ open</span>
                    </button>
                  ) : reels.map((r, idx) => {
                    const isSelected = selectedIds.has(r.id);
                    const groupActive = isSelected && selectedIds.size > 1;
                    const isThisDrag = dragging && dragging.id === r.id;
                    const isInGroupDrag = dragging && selectedIds.has(dragging.id) && selectedIds.size > 1 && isSelected;
                    /* When grouping, drop a thin series label at each group boundary.
                       In card (grid) views the label spans the full row so the
                       grouping reads correctly across the 2×2 / 3×3 tiles. */
                    const showSeriesHeader = groupBySeries &&
                      (idx === 0 || (reels[idx - 1].series || "") !== (r.series || ""));
                    return (
                      <React.Fragment key={r.id}>
                      {showSeriesHeader && (
                        <div className="pipe-series-header"
                             style={cardView !== "list" ? { gridColumn: "1 / -1" } : undefined}>
                          {r.series ? `⛓ ${r.series}` : "· no series"}
                        </div>
                      )}
                      <div
                        draggable={canMove}
                        onDragStart={e => {
                          setDragging(r);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { setDragging(null); setDropTarget(null); setDropOnCard(null); }}
                        onDragOver={e => {
                          if (!dragging || dragging.id === r.id) return;
                          /* No move capability → never accept a card-reorder drop. */
                          if (!canMove) return;
                          /* Block the drop cursor on cards inside a protected column. */
                          if (r.stage === "completed" && !can("moveToCompleted")) return;
                          e.preventDefault(); e.stopPropagation();
                          if (dropTarget) setDropTarget(null);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const before = (e.clientY - rect.top) < rect.height / 2;
                          if (!dropOnCard || dropOnCard.id !== r.id || dropOnCard.before !== before) {
                            setDropOnCard({ id: r.id, before });
                          }
                        }}
                        onDrop={e => {
                          e.preventDefault(); e.stopPropagation();
                          handleCardDrop(r, dropOnCard?.id === r.id ? dropOnCard.before : true);
                        }}
                        className={"sol-card stage-" + (r.stage || "not-started") + (isThisDrag ? " is-drag-wrap" : "")}
                        style={{
                          opacity: isThisDrag || isInGroupDrag ? 0.4 : 1,
                          borderTop: dropOnCard?.id === r.id && dropOnCard.before ? "2px solid var(--c-cyan)" : "2px solid transparent",
                          borderBottom: dropOnCard?.id === r.id && !dropOnCard.before ? "2px solid var(--c-cyan)" : "2px solid transparent",
                          borderRadius: 4,
                        }}
                      >
                        <ReelCard
                          reel={r}
                          state={r.state}
                          isSelected={isSelected}
                          compact={cardView !== "list"}
                          onOpen={(reel, e) => handleCardClick(reel, e || {})}
                        />
                      </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
          );
        })}
      </div>
      )}

      {/* Lane right-click context menu */}
      {laneCtxMenu && (
        <div
          style={{ position: "fixed", top: laneCtxMenu.y, left: laneCtxMenu.x, zIndex: 9999,
                   background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                   borderRadius: 4, padding: "4px 0", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}
          onMouseLeave={() => setLaneCtxMenu(null)}
        >
          <button
            style={{ display: "block", width: "100%", background: "none", border: "none",
                     color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12,
                     padding: "7px 16px", cursor: "pointer", textAlign: "left" }}
            onClick={() => { toggleLane(laneCtxMenu.laneId); setLaneCtxMenu(null); }}
          >
            Hide this lane
          </button>
        </div>
      )}

      {/* Dense-table overlay for one box (bulk triage of hundreds of reels).
          Reels are read live from `cells` so moves/archives update the list. */}
      {expandBox && (
        <BoxTable
          laneName={expandBox.laneName}
          stageLabel={STAGE_LABEL[expandBox.stageKey] || expandBox.stageKey}
          stageKey={expandBox.stageKey}
          reels={expandBox.allStage
            ? (itemsByStage[expandBox.stageKey] || [])
            : (cells[expandBox.laneId + "::" + expandBox.stageKey] || [])}
          peopleList={peopleList}
          actions={actions}
          canArchive={can("archiveReel")}
          canDelete={can("deleteReel")}
          canCreate={can("createReel")}
          onClose={() => setExpandBox(null)}
          onOpenReel={(r) => handleCardClick(r, {})}
        />
      )}

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

      {/* Schedule date modal — shown when a card is dropped into "posted" */}
      {scheduleModal && (
        <div className="m-backdrop" onClick={() => setScheduleModal(null)}>
          <div className="m-shell" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <div className="m-head">
              <div>
                <div className="m-eyebrow">Move to Posted</div>
                <div className="m-title">Schedule post date</div>
                <div className="m-sub">
                  Set the date this reel is scheduled to be posted. You can leave it blank.
                </div>
              </div>
              <button className="m-x" onClick={() => setScheduleModal(null)}>✕</button>
            </div>
            <div className="m-body">
              <div className="m-field">
                <div className="m-label">Post date</div>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="m-input"
                />
              </div>
            </div>
            <div className="m-foot">
              <span />
              <div style={{ display: "flex", gap: 8 }}>
                <DPill onClick={() => setScheduleModal(null)}>Cancel</DPill>
                <DPill primary onClick={() => {
                  actions.moveStage(scheduleModal.reelId, {
                    lane: scheduleModal.lane,
                    stage: "posted",
                    scheduledPostDate: scheduleDate || null,
                  });
                  setScheduleModal(null);
                }}>Move to Posted</DPill>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { Pipeline };
