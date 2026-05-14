/* ===========================================================
   Shared components for the Workflow ops app.
   =========================================================== */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNow, formatAge } from "./time.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";
import { useNotifications } from "./notifications.jsx";

/* ---------- Status pill ---------- */
function Pill({ tone, dashed, children }) {
  const cls = ["pill", tone || "", dashed ? "dashed" : ""].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}

/* ---------- Dashed pill button ---------- */
function DPill({ tone, active, solid, primary, onClick, children, style }) {
  const cls = [
    "dpill",
    active ? "is-active" : "",
    tone === "amber" ? "is-amber" : "",
    tone === "red" ? "is-red" : "",
    solid ? "is-solid" : "",
    primary ? "is-primary" : "",
  ].filter(Boolean).join(" ");
  return <button className={cls} onClick={onClick} style={style}>{children}</button>;
}

/* ---------- Collapsible card ----------
   Renders the dashed-edge card chrome with header, body and foot.
   `defaultOpen` controls initial state. `title` is the small uppercase
   label, `right` is anything in the top-right (pills, counts).
*/
function Card({ title, right, footLeft, children, defaultOpen = true, tone, solid }) {
  const [open, setOpen] = useState(defaultOpen);
  const cls = [
    "card",
    open ? "" : "collapsed",
    tone || "",
    solid ? "solid" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div className="card-head">
        <div className="h">{title}</div>
        <div className="right">{right}</div>
      </div>
      {open && <div className="card-body">{children}</div>}
      <div className="card-foot">
        <div className="left">{footLeft}</div>
        <div className="collapse" onClick={() => setOpen(o => !o)}>
          {open ? "Collapse" : "Expand"}
        </div>
      </div>
    </div>
  );
}

/* ---------- Reel card (board) ---------- */
function ReelCard({ reel, onOpen, state, isSelected }) {
  // state: 'ok' | 'warn' | 'block' | 'selected'
  const cls = [
    "reel",
    state === "block" ? "is-blocked" : "",
    state === "warn" ? "is-warn" : "",
    state === "selected" ? "is-selected" : "",
    isSelected ? "is-multi-selected" : "",
  ].filter(Boolean).join(" ");
  const pillTone = state === "block" ? "block" : state === "warn" ? "warn" : reel.tone || "cyan";

  const openReel = (e) => onOpen && onOpen(reel, e);

  /* Live-ticking age string. `status` overrides remain authored
     by step 1's seed mapping for cases where the board wanted a
     different phrasing than the operational `age` (e.g. "post 2h"
     vs the canonical "scheduled") — we honor those when present
     so the board look stays stable. */
  const now = useNow();
  const liveAge = reel.stageEnteredAt ? formatAge(reel, now) : (reel.age || "");
  const pillText = reel.status || liveAge;

  /* Per-card action menu (archive / delete) — owner only for delete. */
  const { actions } = useWorkflow();
  const { person } = useAuth();
  const { unreadByReel } = useNotifications();
  const unreadCount = unreadByReel[reel.id] || 0;
  const isOwner = person?.role === "owner";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const onArchive = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    actions.archiveReel(reel.id);
  };
  const onDelete = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (confirm("Delete " + reel.id + " permanently? This cannot be undone.")) {
      actions.deleteReel(reel.id);
    }
  };

  return (
    <div className={cls} onClick={openReel}>
      <div className="head">
        <div>
          <div className="id">
            {reel.id}
            {unreadCount > 0 && (
              <span className="unread-dot"
                    title={unreadCount + " unread comment" + (unreadCount === 1 ? "" : "s")}>
                {unreadCount}
              </span>
            )}
          </div>
          <div className="title">{reel.title}</div>
        </div>
        {pillText && <Pill tone={pillTone}>{pillText}</Pill>}
        <button
          className="reel-menu-btn"
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
          aria-label="Card actions"
        >⋯</button>
        {menuOpen && (
          <div ref={menuRef} className="reel-menu" onClick={e => e.stopPropagation()}>
            <div className="reel-menu-opt" onClick={onArchive}>Archive</div>
            {isOwner && <div className="reel-menu-opt danger" onClick={onDelete}>Delete</div>}
          </div>
        )}
      </div>
      {reel.note && <div className="note">{reel.note}</div>}
      {reel.links && reel.links.length > 0 && (
        <div className="links" onClick={e => e.stopPropagation()}>
          {reel.links.map((l, i) => (
            <a key={i} className="link" href="#"
               onClick={e => { e.preventDefault(); e.stopPropagation(); }}>{l}</a>
          ))}
        </div>
      )}
      <div className="foot">
        <span>{reel.foot || ""}</span>
        <span
          className="collapse"
          onClick={e => { e.stopPropagation(); /* placeholder for per-card collapse */ }}
        >Collapse</span>
      </div>
    </div>
  );
}

/* ---------- Stage spine row ---------- */
function StageSpine({ stages, activeKey }) {
  return (
    <div className="spine">
      {stages.map(s => (
        <div key={s.key} className={"cell" + (s.key === activeKey ? " is-active" : "")}>
          {s.key === activeKey && <div className="bar" />}
          <div className="label">{s.label}</div>
          <div className="meta">{s.meta1}</div>
          {s.meta2 && <div className="meta">{s.meta2}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Roadmap node ---------- */
function RoadmapNode({ num, tone, title, sub, right }) {
  return (
    <div className={"roadmap-node " + (tone || "")}>
      <div className="num">{num}</div>
      <div className="body">
        <div className="title">{title}</div>
        <div className="sub">{sub}</div>
      </div>
      <div>{right}</div>
    </div>
  );
}

/* ---------- Task object (lightweight task request) ---------- */
function TaskObject({ task }) {
  const cls = "task req-" + (task.audience || "owner");
  return (
    <div className={cls}>
      <div>
        <div className="row1">
          <span className="tag type">{task.type}</span>
          <span className="tag assignee">→ {task.assignee}</span>
          {task.due && <span className="tag due">due {task.due}</span>}
        </div>
        <div className="instr">{task.instruction}</div>
      </div>
      <div className="status">{task.status}</div>
    </div>
  );
}

/* ---------- Selector with dropdown ---------- */
function Selector({ label, value, options, onPick }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    const h = e => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  return (
    <div ref={wrap} style={{ position: "relative", flex: 1 }}>
      <div className="selector">
        <div className="lbl">{label}</div>
        <div className="input" onClick={() => setOpen(o => !o)}>
          <span style={{ fontFamily: "var(--f-mono)", color: "var(--c-cyan)" }}>{value.id}</span>
          <span style={{ fontFamily: "var(--f-serif)", fontStyle: "italic", fontSize: 14 }}>
            {value.title}
          </span>
          <span style={{ color: "var(--fg-mute)", fontSize: 11 }}>·</span>
          <span style={{ color: "var(--fg-mute)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>
            posted {value.postedAgo}
          </span>
          <span className="caret">▾</span>
        </div>
      </div>
      {open && (
        <div className="dropdown" style={{ position: "absolute", left: 0, right: 0, top: "100%" }}>
          {options.map(o => (
            <div key={o.id} className="opt" onClick={() => { onPick(o); setOpen(false); }}>
              <span className="id">{o.id}</span>
              <span className="ttl">{o.title}</span>
              <span className="meta">posted {o.postedAgo} · {o.variants}v</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Tiny checkbox ---------- */
function Check({ item, onToggle }) {
  const cls = "check " + (item.done ? "done" : item.warn ? "warn" : item.block ? "block" : "");
  return (
    <div className={cls} onClick={onToggle}>
      <div className="box"></div>
      <div className="lbl">{item.label}</div>
    </div>
  );
}

/* ---------- Mini glyphs (avoid SVG art; pure CSS dots/lines) ---------- */
function ChevronRight() { return <span style={{ color: "var(--fg-faint)", margin: "0 6px" }}>›</span>; }

export {
  Pill, DPill, Card, ReelCard, StageSpine, RoadmapNode,
  TaskObject, Selector, Check, ChevronRight,
};
