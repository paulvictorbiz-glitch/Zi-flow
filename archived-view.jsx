/* =========================================================
   Archived view — lists every reel with archived_at IS NOT NULL
   so the team can browse / restore them. Hard delete is offered
   to the owner role only (and a confirm() prompt protects
   against thumbs).
   ========================================================= */

import React from "react";
import { DPill, Pill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";
import { useNow, formatAge, formatDue } from "./time.jsx";
import { PEOPLE, STAGE_LABEL, STAGE_TONE } from "./shared-data.jsx";

function ArchivedView({ onOpen }) {
  const { reels, actions } = useWorkflow();
  const { person } = useAuth();
  const now = useNow();
  const archived = reels
    .filter(r => r.archivedAt)
    .sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));

  const isOwner = person?.role === "owner";

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Archived reels</h1>
          <div className="sub">
            Reels that were archived from the pipeline. They don't appear on
            the board, list, calendar, or My Work. Restore brings them back
            to whatever stage they were in. Hard delete (owner only) is
            permanent.
          </div>
        </div>
        <div className="actions">
          <DPill tone="amber" active>{archived.length} archived</DPill>
        </div>
      </div>

      <div className="list-scroll">
        <table className="list-table">
          <thead>
            <tr>
              <th style={{ width: 86 }}>ID</th>
              <th>Reel</th>
              <th style={{ width: 110 }}>Stage</th>
              <th style={{ width: 130 }}>Owner</th>
              <th style={{ width: 130 }}>Due</th>
              <th style={{ width: 150 }}>Archived</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {archived.map(r => (
              <tr key={r.id} className="row">
                <td className="id">{r.id}</td>
                <td>
                  <div className="serif-i" style={{ fontSize: 14.5, color: "#eef3fb" }}>{r.title}</div>
                </td>
                <td><Pill tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Pill></td>
                <td>
                  <span className={"avatar-chip " + (PEOPLE[r.owner]?.role || "")}>
                    {PEOPLE[r.owner]?.avatar}
                  </span>
                  <span style={{ marginLeft: 8, color: "var(--fg-mute)" }}>{PEOPLE[r.owner]?.short}</span>
                </td>
                <td className="mono">{formatDue(r, now) || <span className="dim">—</span>}</td>
                <td className="mono dim">
                  {r.archivedAt
                    ? formatAge({ stageEnteredAt: r.archivedAt, stage: "posted" }, now)
                    : <span className="dim">—</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <DPill onClick={() => onOpen({ id: r.id, title: r.title })}>Open</DPill>
                    <DPill primary onClick={() => actions.restoreReel(r.id)}>Restore</DPill>
                    {isOwner && (
                      <DPill tone="red"
                             onClick={() => {
                               if (confirm("Delete " + r.id + " permanently? This cannot be undone.")) {
                                 actions.deleteReel(r.id);
                               }
                             }}>
                        Delete
                      </DPill>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {archived.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-mute)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
                  No archived reels.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { ArchivedView };
