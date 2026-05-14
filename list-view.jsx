/* =========================================================
   List View — dense operational table for fast scanning.
   Columns: ID · title · assignee · stage · blocker · due ·
            deps · linked assets · status · next action
   ========================================================= */

import React, { useState, useMemo } from "react";
import { DPill, Pill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { useNow, formatAge, formatDue } from "./time.jsx";
import { PEOPLE, ROLES, STAGE_LABEL, STAGE_TONE } from "./shared-data.jsx";

function ListView({ role, onOpen }) {
  const { reels } = useWorkflow();
  const now = useNow();
  const [sort, setSort] = useState("stage");
  const [filterStage, setFilterStage] = useState("all");
  const [showBlockedOnly, setShowBlockedOnly] = useState(false);

  const rows = useMemo(() => {
    let arr = reels.filter(r => !r.archivedAt);
    if (role !== "all") arr = arr.filter(r => r.owner === ROLES[role]?.person);
    if (filterStage !== "all") arr = arr.filter(r => r.stage === filterStage);
    if (showBlockedOnly) arr = arr.filter(r => r.state === "block" || r.state === "warn");
    if (sort === "stage") {
      const order = ["idea","selected","main","review","variants","ready","posted"];
      arr.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    } else if (sort === "due") {
      arr.sort((a, b) => (a.due || "z").localeCompare(b.due || "z"));
    } else if (sort === "age") {
      arr.sort((a, b) => (b.age || "").localeCompare(a.age || ""));
    }
    return arr;
  }, [reels, role, sort, filterStage, showBlockedOnly]);

  return (
    <div>
      {/* Filter bar */}
      <div className="list-filterbar">
        <span className="mono muted">scope</span>
        <DPill active={filterStage === "all"}      onClick={() => setFilterStage("all")}>All stages</DPill>
        {["main","review","variants","ready"].map(s => (
          <DPill key={s} active={filterStage === s} onClick={() => setFilterStage(s)}>{STAGE_LABEL[s]}</DPill>
        ))}
        <DPill active={showBlockedOnly} tone="red" onClick={() => setShowBlockedOnly(b => !b)}>
          Blocked / warn
        </DPill>
        <span style={{ flex: 1 }} />
        <span className="mono muted">sort</span>
        <DPill active={sort === "stage"} onClick={() => setSort("stage")}>Stage</DPill>
        <DPill active={sort === "due"}   onClick={() => setSort("due")}>Due</DPill>
        <DPill active={sort === "age"}   onClick={() => setSort("age")}>Aging</DPill>
        <span className="mono muted">{rows.length} reels</span>
      </div>

      <div className="list-scroll">
        <table className="list-table">
          <thead>
            <tr>
              <th style={{ width: 86 }}>ID</th>
              <th>Reel</th>
              <th style={{ width: 110 }}>Stage</th>
              <th style={{ width: 130 }}>Assignee</th>
              <th>Blocker / waiting on</th>
              <th style={{ width: 110 }}>Due</th>
              <th style={{ width: 110 }}>Aging</th>
              <th style={{ width: 100 }}>Assets</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={"row " + (r.state || "")}
                  onClick={() => onOpen({ id: r.id, title: r.title })}>
                <td className="id">{r.id}</td>
                <td>
                  <div className="serif-i" style={{ fontSize: 14.5, color: "#eef3fb" }}>{r.title}</div>
                  {r.downstream && (
                    <div className="mono muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                      ↘ {r.downstream}
                    </div>
                  )}
                </td>
                <td><Pill tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Pill></td>
                <td>
                  <span className={"avatar-chip " + (PEOPLE[r.owner]?.role || "")}>
                    {PEOPLE[r.owner]?.avatar}
                  </span>
                  <span style={{ marginLeft: 8, color: "var(--fg-mute)" }}>{PEOPLE[r.owner]?.short}</span>
                </td>
                <td>
                  {r.blocker
                    ? <span style={{ color: r.state === "block" ? "var(--c-red)" : "var(--c-amber)" }}>{r.blocker}</span>
                    : <span className="dim">—</span>}
                  {r.blockerRole && (
                    <div className="mono dim" style={{ marginTop: 3 }}>
                      role-locked · {r.blockerRole}
                    </div>
                  )}
                </td>
                <td className="mono">{formatDue(r, now) || <span className="dim">—</span>}</td>
                <td className={"mono " + (r.state === "block" ? "neg" : r.state === "warn" ? "warn-txt" : "")}>
                  {formatAge(r, now)}
                </td>
                <td>
                  <div className="asset-chips">
                    {r.fb > 0   && <span className="ac cyan">FB · {r.fb}</span>}
                    {r.refs > 0 && <span className="ac">REF · {r.refs}</span>}
                    {r.fb === 0 && r.refs === 0 && <span className="dim mono">—</span>}
                  </div>
                </td>
                <td style={{ color: "var(--fg)" }}>{r.next || <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { ListView };
