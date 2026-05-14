/* =========================================================
   My Work — role-aware "what needs me now" dashboard.

   Three render paths today:
     · skilled  → 3-column DnD lanes (Not started / In progress
                  / Completed) showing reels owned by Judy. Each
                  card carries: clip count, logline preview,
                  current-state link, due-date+time picker, and
                  a "for revision" badge with the reviewer's note
                  if the reel was just sent back.
     · variant  → execution queue for Jay (unchanged for now).
     · owner / reviewer → minimal review queue. One row per
                  reel currently in `review` stage with an
                  Accept / Send-back-with-note action. Used by
                  both Paul and Leroy.
   ========================================================= */

import React, { useState } from "react";
import { DPill, Pill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";
import { useNow, formatDue } from "./time.jsx";
import { PEOPLE } from "./shared-data.jsx";

/* Build the revision history array, folding the older single-field
   shape into one entry so display code only handles one schema. */
function getRevisionHistory(detail) {
  const arr = Array.isArray(detail?.revisionHistory) ? detail.revisionHistory : [];
  if (arr.length) return arr;
  if (detail?.revisionNote) {
    return [{
      action: "sent_back",
      ts:     detail.revisionAt || null,
      by:     detail.revisionBy || null,
      note:   detail.revisionNote,
    }];
  }
  return [];
}

function formatHistoryTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return datePart + " · " + hh + ":" + mm;
}

/* Action-button gating per step 5:
   - Owner role = god-mode (always allowed).
   - Anyone else: only the matching role's actions are exposed. */
function useCanAct(requiredRole) {
  const { person } = useAuth();
  if (!person) return false;
  if (person.role === "owner") return true;
  if (Array.isArray(requiredRole)) return requiredRole.includes(person.role);
  return person.role === requiredRole;
}

function MyWork({ role, onOpen }) {
  // Owner and Reviewer share the same review-queue dashboard.
  if (role === "owner" || role === "reviewer") return <ReviewQueueWork onOpen={onOpen} />;
  if (role === "variant") return <VariantWork onOpen={onOpen} />;
  return <SkilledWork onOpen={onOpen} />;
}

/* ─────────────────────────────────────────────────────── */
/* Skilled editor dashboard — 3-column DnD                */
/* ─────────────────────────────────────────────────────── */

const SKILLED_COLS = [
  { key: "not_started", title: "Not started" },
  { key: "in_progress", title: "In progress" },
  { key: "review",      title: "Review"      },
  { key: "completed",   title: "Completed"   },
];

function SkilledWork({ onOpen }) {
  const { reels, actions, attachedFootage } = useWorkflow();
  const me = "alex";
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);

  const [dragId, setDragId] = useState(null);
  const [dropCol, setDropCol] = useState(null);

  const handleDrop = (targetStage) => {
    if (!dragId) return;
    actions.moveStage(dragId, { stage: targetStage });
    setDragId(null);
    setDropCol(null);
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — Judy A · skilled editor</h1>
          <div className="sub">
            Drag a card between columns to update its status.
          </div>
        </div>
      </div>

      <div className="mywork-grid">
        {SKILLED_COLS.map(col => {
          const rows = mine.filter(r => r.stage === col.key);
          const isTarget = dropCol === col.key;
          return (
            <div className="mw-col" key={col.key}
                 onDragOver={e => { if (dragId) { e.preventDefault(); if (dropCol !== col.key) setDropCol(col.key); } }}
                 onDragLeave={() => { if (dropCol === col.key) setDropCol(null); }}
                 onDrop={e => { e.preventDefault(); handleDrop(col.key); }}
                 style={{
                   outline: isTarget ? "2px dashed var(--c-cyan)" : "",
                   outlineOffset: isTarget ? "-4px" : "",
                   transition: "outline 0.1s",
                 }}>
              <div className="mw-col-head">
                <div className="mw-h">{col.title}</div>
                <span className="count-tag">{rows.length}</span>
              </div>
              <div className="mw-list">
                {rows.map(r => (
                  <div key={r.id}
                       draggable
                       onDragStart={e => { setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                       onDragEnd={() => { setDragId(null); setDropCol(null); }}
                       style={{ opacity: dragId === r.id ? 0.4 : 1 }}>
                    <WorkCard
                      reel={r}
                      onOpen={onOpen}
                      clipCount={attachedFootage.filter(f => f.reel_id === r.id).length}
                      onDueChange={(iso) => actions.updateReel(r.id, { dueAt: iso })}
                    />
                  </div>
                ))}
                {rows.length === 0 && <EmptyLane label="Drop a reel here." />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Variant editor dashboard — unchanged                    */
/* ─────────────────────────────────────────────────────── */

function VariantWork({ onOpen }) {
  const { reels, tasks } = useWorkflow();
  const me = "sam";
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);
  const myTasks = tasks.filter(t => t.to === me);
  const now = useNow();

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — Jay · variant editor</h1>
          <div className="sub">Reels assigned to you.</div>
        </div>
      </div>

      <div className="variant-queue" style={{ padding: "16px 22px" }}>
        {mine.length === 0 && (
          <div className="dim mono" style={{ padding: 12 }}>No reels assigned to you yet.</div>
        )}
        {mine.map(r => (
          <div key={r.id} className={"vslot " + (r.state || "ok")}
               onClick={() => onOpen({ id: r.id, title: r.title })}
               style={{ cursor: "pointer" }}>
            <div className="vslot-head">
              <div>
                <div className="mono dim">{r.id}</div>
                <div className="serif-i" style={{ fontSize: 18, color: "#eef3fb", marginTop: 2 }}>{r.title}</div>
              </div>
              <Pill tone={r.state === "block" ? "block" : r.state === "warn" ? "warn" : "ok"}>
                {r.blocker ? "blocked" : "active"}
              </Pill>
            </div>
            {r.blocker && (
              <div className="vslot-blocker">
                <span style={{ color: "var(--c-red)" }}>●</span> {r.blocker}
              </div>
            )}
            <div className="vslot-block">
              <div className="h-sub">Deadline</div>
              <div className="mono" style={{ color: "var(--c-amber)" }}>{formatDue(r, now) || "—"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Review queue dashboard — Paul + Leroy                   */
/* ─────────────────────────────────────────────────────── */

function ReviewQueueWork({ onOpen }) {
  const { reels } = useWorkflow();
  const { person } = useAuth();
  const inReview = reels.filter(r => r.stage === "review" && !r.archivedAt);
  const heading = person?.name || "Reviewer";
  const subtitle = person?.role === "owner" ? "owner · creative director" : "reviewer";

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — {heading} · {subtitle}</h1>
          <div className="sub">
            {inReview.length === 0
              ? "Nothing waiting on you."
              : `${inReview.length} reel${inReview.length === 1 ? "" : "s"} waiting on review.`}
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        {inReview.length === 0 && (
          <div style={{
            border: "1px dashed var(--line-hard)",
            borderRadius: 6,
            padding: "20px",
            textAlign: "center",
            color: "var(--fg-dim)",
            fontSize: 13,
          }}>
            Review queue is clear.
          </div>
        )}
        {inReview.map(r => (
          <ReviewRow key={r.id} reel={r} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ reel, onOpen }) {
  const { actions } = useWorkflow();
  const { person } = useAuth();
  const now = useNow();
  const canAct = useCanAct(["owner", "reviewer"]);
  const [note, setNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const accept = () => {
    actions.approveReview(reel.id, { by: person?.id || null });
    setNote("");
  };
  const sendBack = () => {
    actions.sendBack(reel.id, { note, by: person?.id || null });
    setNote("");
  };

  // Prior review-round history — only render if there's at least one
  // "sent_back" entry (i.e. the reel has been here before).
  const history = getRevisionHistory(reel.detail);
  const priorSendBacks = history.filter(h => h.action === "sent_back");
  const lastSendBack = priorSendBacks[priorSendBacks.length - 1];

  const logPreview = (reel.logline || "").trim().slice(0, 140);

  return (
    <div style={{
      border: "1px dashed var(--line-hard)",
      borderRadius: 6,
      padding: "14px 16px",
      background: "var(--bg-1)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        cursor: "pointer",
      }} onClick={() => onOpen({ id: reel.id, title: reel.title })}>
        <span className="mono dim" style={{ fontSize: 11 }}>{reel.id}</span>
        <span className="serif-i" style={{ fontSize: 17, color: "var(--fg)", flex: 1 }}>
          {reel.title}
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          waiting · {formatDue(reel, now) || "no due"}
        </span>
      </div>

      {logPreview && (
        <div style={{
          fontSize: 12, color: "var(--fg-mute)", lineHeight: 1.45,
        }}>
          {logPreview}{(reel.logline || "").length > 140 ? "…" : ""}
        </div>
      )}

      {reel.attachUrl && (
        <a href={reel.attachUrl} target="_blank" rel="noopener noreferrer"
           onClick={e => e.stopPropagation()}
           style={{
             fontSize: 11.5, color: "var(--c-cyan)",
             fontFamily: "var(--f-mono)", textDecoration: "none",
             alignSelf: "flex-start",
           }}>
          ↗ Current reel state
        </a>
      )}

      {lastSendBack && (
        <div style={{
          border: "1px dashed var(--c-amber-soft)",
          background: "rgba(245,194,102,0.04)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 11.5,
          lineHeight: 1.45,
        }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
            color: "var(--c-amber)",
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            <span>Your last note</span>
            {lastSendBack.by && (
              <span style={{ color: "var(--fg-dim)" }}>
                · {PEOPLE[lastSendBack.by]?.short || lastSendBack.by}
              </span>
            )}
            {lastSendBack.ts && (
              <span style={{ color: "var(--fg-dim)" }}>· {formatHistoryTs(lastSendBack.ts)}</span>
            )}
          </div>
          <div style={{ color: "var(--fg)" }}>
            {lastSendBack.note || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}
          </div>
          {priorSendBacks.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <a href="#"
                 onClick={e => { e.preventDefault(); setHistoryOpen(o => !o); }}
                 style={{
                   fontSize: 10.5,
                   fontFamily: "var(--f-mono)",
                   color: "var(--c-cyan)",
                   textDecoration: "none",
                 }}>
                {historyOpen ? "hide" : "show"} {priorSendBacks.length - 1} earlier note{priorSendBacks.length - 1 === 1 ? "" : "s"}
              </a>
              {historyOpen && (
                <div style={{
                  marginTop: 6,
                  display: "flex", flexDirection: "column", gap: 6,
                  borderTop: "1px dashed var(--line-hard)",
                  paddingTop: 6,
                }}>
                  {priorSendBacks.slice(0, -1).reverse().map((h, i) => (
                    <div key={i}>
                      <div style={{
                        color: "var(--fg-dim)",
                        fontFamily: "var(--f-mono)",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                      }}>
                        {h.by ? (PEOPLE[h.by]?.short || h.by) : "anon"} · {formatHistoryTs(h.ts)}
                      </div>
                      <div style={{ color: "var(--fg-mute)", fontSize: 11.5 }}>
                        {h.note || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Notes (optional — included if you send back)…"
        disabled={!canAct}
        style={{
          background: "var(--bg-2)",
          border: "1px dashed var(--line-hard)",
          borderRadius: 4,
          color: "var(--fg)",
          fontFamily: "var(--f-sans)",
          fontSize: 12,
          padding: "8px 10px",
          resize: "vertical",
          minHeight: 48,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {canAct ? (
          <React.Fragment>
            <DPill onClick={sendBack}>Send back</DPill>
            <DPill primary onClick={accept}>Accept</DPill>
          </React.Fragment>
        ) : (
          <span className="mono dim" style={{ fontSize: 10.5 }}>
            sign in as owner or reviewer to act
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Shared sub-pieces                                       */
/* ─────────────────────────────────────────────────────── */

/* Convert a Date / ISO string to the `YYYY-MM-DDTHH:MM` format
   required by <input type="datetime-local">. */
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
       + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fromDatetimeLocalValue(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function WorkCard({ reel, onOpen, clipCount, onDueChange }) {
  // Most recent "sent_back" entry — only renders the orange badge if
  // it's the latest history event (i.e. no later approval).
  const history = getRevisionHistory(reel.detail);
  const last = history[history.length - 1];
  const revision = last && last.action === "sent_back" ? last : null;
  const revisionNote = revision?.note;
  const revisionTs   = revision?.ts;
  const revisionBy   = revision?.by ? (PEOPLE[revision.by]?.short || revision.by) : null;
  const logPreview = (reel.logline || "").trim().slice(0, 100);

  // Stop drag from triggering on the date input / link interactions.
  const stop = (e) => e.stopPropagation();

  return (
    <div className="work-card"
         onClick={() => onOpen({ id: reel.id, title: reel.title })}
         style={{ cursor: "pointer" }}>
      <div className="wc-head">
        <div>
          <div className="mono dim">{reel.id}</div>
          <div className="serif-i" style={{ fontSize: 17, color: "#eef3fb", marginTop: 2 }}>
            {reel.title}
          </div>
        </div>
      </div>

      {revisionNote && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginTop: 8,
          padding: "8px 10px",
          background: "rgba(245,194,102,0.08)",
          border: "1px dashed var(--c-amber-soft)",
          borderRadius: 4,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--c-amber)",
            flexShrink: 0,
            marginTop: 4,
          }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
            <div style={{
              color: "var(--c-amber)",
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 2,
              display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap",
            }}>
              <span>For revision</span>
              {revisionBy && <span style={{ color: "var(--fg-dim)" }}>· {revisionBy}</span>}
              {revisionTs && <span style={{ color: "var(--fg-dim)" }}>· {formatHistoryTs(revisionTs)}</span>}
            </div>
            <div style={{ color: "var(--fg)" }}>{revisionNote || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}</div>
            {history.length > 1 && (
              <div style={{
                marginTop: 4, fontSize: 10,
                fontFamily: "var(--f-mono)", color: "var(--fg-dim)",
              }}>
                {history.filter(h => h.action === "sent_back").length} prior round{history.filter(h => h.action === "sent_back").length === 1 ? "" : "s"} · open reel to view
              </div>
            )}
          </div>
        </div>
      )}

      {logPreview && (
        <div className="wc-next" style={{ marginTop: 8 }}>
          {logPreview}{(reel.logline || "").length > 100 ? "…" : ""}
        </div>
      )}

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 10,
        fontSize: 11,
        color: "var(--fg-mute)",
        fontFamily: "var(--f-mono)",
        flexWrap: "wrap",
      }}>
        <span title="Clips attached">📎 {clipCount}</span>
        {reel.attachUrl && (
          <a href={reel.attachUrl} target="_blank" rel="noopener noreferrer"
             onClick={stop}
             style={{ color: "var(--c-cyan)", textDecoration: "none" }}>
            ↗ Current state
          </a>
        )}
      </div>

      <div style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "var(--fg-dim)",
        fontFamily: "var(--f-mono)",
      }}>
        <span>Due:</span>
        <input
          type="datetime-local"
          value={toDatetimeLocalValue(reel.dueAt)}
          onClick={stop}
          onMouseDown={stop}
          onChange={e => {
            stop(e);
            onDueChange(fromDatetimeLocalValue(e.target.value));
          }}
          style={{
            background: "var(--bg-2)",
            border: "1px dashed var(--line-hard)",
            borderRadius: 3,
            color: "var(--fg)",
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            padding: "3px 6px",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

function EmptyLane({ label }) {
  return <div className="mw-empty">{label}</div>;
}

export { MyWork };
