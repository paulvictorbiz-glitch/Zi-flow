/* =========================================================
   TrainingProgressWidget — dashboard view of training progress.

   Two modes:
     · EDITOR (default, !isOwner): a single progress bar for `personId`
       — % of the 6 pillar modules complete + current level label.
       Reads this person's training_progress rows directly.
     · OWNER (isOwner): a roster list. Calls actions.loadTrainingProgressAll()
       once and computes each editor's completed-module count
       (rows where done===true). Renders name + mini bar + "X/6 · NN%".
       Each row → onOpenPerson(personId) (optional; Layer 3 wires nav).

   Progress granularity here is module-DONE count (the right granularity
   for "X/6 modules"), matching loadTrainingProgressAll's `done` booleans.

   Props:
     personId     — the editor whose own progress to show (editor mode)
     isOwner      — switches to the roster mode
     roster       — peopleList from useRoster() (array of people)
     onOpenPerson — optional (personId) => void, row click in owner mode
   ========================================================= */

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase-client.js";
import { useWorkflow } from "../store/store.jsx";
import { TOTAL_MODULES, levelForCount } from "../lib/training-curriculum.jsx";

function Bar({ pct }) {
  return (
    <div className="tr-bar" style={{ height: 9 }}>
      <div className="tr-bar-fill" style={{ width: Math.min(100, pct).toFixed(1) + "%" }} />
    </div>
  );
}

export function TrainingProgressWidget({ personId, isOwner, roster = [], onOpenPerson, bare = false }) {
  const { actions } = useWorkflow();

  /* ── Owner roster mode ─────────────────────────────────────────── */
  if (isOwner) {
    return <OwnerRoster actions={actions} roster={roster} onOpenPerson={onOpenPerson} bare={bare} />;
  }

  /* ── Editor self mode ──────────────────────────────────────────── */
  return <EditorBar personId={personId} />;
}

/* Editor's own progress — one bar + level. */
function EditorBar({ personId }) {
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!personId) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("training_progress")
        .select("module_id, done")
        .eq("person_id", personId);
      if (cancelled) return;
      const n = (data || []).filter((r) => r.done).length;
      setDoneCount(Math.min(TOTAL_MODULES, n));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [personId]);

  const pct = TOTAL_MODULES ? (doneCount / TOTAL_MODULES) * 100 : 0;
  const { current } = levelForCount(doneCount);

  return (
    <div className="tr-widget">
      <div className="tr-widget-head">
        <span className="tr-widget-title">🎓 Training progress</span>
        <span className="tr-widget-meta">
          {loading ? "…" : `${doneCount}/${TOTAL_MODULES} · ${current.label}`}
        </span>
      </div>
      <Bar pct={loading ? 0 : pct} />
      <div className="tr-widget-sub">
        {loading
          ? "Loading…"
          : doneCount >= TOTAL_MODULES
            ? "All six pillars complete — Reel Pro 🎬"
            : `${Math.round(pct)}% of the six core pillars complete`}
      </div>
    </div>
  );
}

/* Owner's roster — per-editor completed-module count. */
function OwnerRoster({ actions, roster, onOpenPerson, bare = false }) {
  const [rows, setRows] = useState(null); // [{person_id, module_id, done}]

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await actions.loadTrainingProgressAll();
      if (!cancelled) setRows(data || []);
    })();
    return () => { cancelled = true; };
  }, [actions]);

  // completed-module count per person.
  const countByPerson = useMemo(() => {
    const m = {};
    for (const r of rows || []) {
      if (r.done) m[r.person_id] = (m[r.person_id] || 0) + 1;
    }
    return m;
  }, [rows]);

  // Show editors only (exclude the owner; reviewers/skilled/variant keep).
  const editors = useMemo(
    () => (roster || []).filter((p) => p.role !== "owner"),
    [roster]
  );

  const content = (
      rows === null ? (
        <div className="tr-widget-sub">Loading…</div>
      ) : editors.length === 0 ? (
        <div className="tr-widget-sub">No editors on the roster.</div>
      ) : (
        <div className="tr-widget-roster">
          {editors.map((p) => {
            const done = Math.min(TOTAL_MODULES, countByPerson[p.id] || 0);
            const pct = TOTAL_MODULES ? (done / TOTAL_MODULES) * 100 : 0;
            const clickable = typeof onOpenPerson === "function";
            return (
              <div
                key={p.id}
                className={"tr-widget-row" + (clickable ? " is-clickable" : "")}
                onClick={clickable ? () => onOpenPerson(p.id) : undefined}
                title={clickable ? `Open ${p.name || p.short}'s training` : undefined}
                role={clickable ? "button" : undefined}
              >
                <span className="tr-widget-row-name">
                  <span className={"avatar-chip " + (p.role || "")} style={{ fontSize: 12 }}>
                    {p.avatar}
                  </span>
                  {p.short || p.name || p.id}
                </span>
                <span className="tr-widget-row-bar"><Bar pct={pct} /></span>
                <span className="tr-widget-row-count">
                  {done}/{TOTAL_MODULES} · {Math.round(pct)}%
                </span>
              </div>
            );
          })}
        </div>
      )
  );

  if (bare) return content;

  return (
    <div className="tr-widget">
      <div className="tr-widget-head">
        <span className="tr-widget-title">🎓 Team training progress</span>
        <span className="tr-widget-meta">{editors.length} editor{editors.length === 1 ? "" : "s"}</span>
      </div>
      {content}
    </div>
  );
}

export default TrainingProgressWidget;
