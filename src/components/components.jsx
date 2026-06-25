/* ===========================================================
   Shared components for the Workflow ops app.
   =========================================================== */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNow, formatAge } from "../lib/time.jsx";
import { useAnchoredPosition } from "../lib/use-anchored-position.js";
import { useWorkflow } from "../store/store.jsx";
import { useNotifications } from "./notifications.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import { useRoster } from "../lib/roster.jsx";

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
// The 8 card colours the user can pick (must match CARD_COLORS in detail.jsx
// and the --c-* tokens in styles.css). Default is cyan.
const CARD_COLORS = ["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"];

function ReelCard({ reel, onOpen, state, isSelected, compact = false }) {
  // state: 'ok' | 'warn' | 'block' | 'selected'
  /* Per-card action menu (archive / delete) — gated by role permissions.
     Pulled up here because `collapsed` (derived from store) is read by `cls`
     below; declaring it later would hit the const TDZ. */
  const { actions, reelChatRefs, collapsedReelIds } = useWorkflow();
  const collapsed = (collapsedReelIds || []).includes(reel.id);
  const cls = [
    "reel",
    compact ? "reel--compact" : "",
    collapsed ? "collapsed" : "",
    state === "block" ? "is-blocked" : "",
    state === "warn" ? "is-warn" : "",
    state === "selected" ? "is-selected" : "",
    isSelected ? "is-multi-selected" : "",
  ].filter(Boolean).join(" ");
  const cardColor = CARD_COLORS.includes(reel.tone) ? reel.tone : "cyan";
  // A coloured left bar marks the card's chosen colour on the board.
  const cardStyle = { boxShadow: `inset 4px 0 0 0 var(--c-${cardColor})` };
  const pillTone = state === "block" ? "block" : state === "warn" ? "warn" : cardColor;

  const openReel = (e) => onOpen && onOpen(reel, e);

  /* Live-ticking age string. `status` overrides remain authored
     by step 1's seed mapping for cases where the board wanted a
     different phrasing than the operational `age` (e.g. "post 2h"
     vs the canonical "scheduled") — we honor those when present
     so the board look stays stable. */
  const now = useNow();
  const liveAge = reel.stageEnteredAt ? formatAge(reel, now) : (reel.age || "");
  const pillText = reel.status || liveAge;

  const { can } = usePermissions();
  const { unreadByReel } = useNotifications();
  const unreadCount = unreadByReel[reel.id] || 0;

  /* Reel ↔ team-chat links. The app can't read Rocket.Chat messages (chat is an
     iframe embed); these refs are the lightweight app-side layer that lets the
     card deep-link back to the conversation. */
  const chatRefs = useMemo(
    () => (reelChatRefs || []).filter(r => (r.reelId ?? r.reel_id) === reel.id),
    [reelChatRefs, reel.id]);

  const openChatRef = (e, ref) => {
    e.stopPropagation();
    const url = ref.messageUrl
      || `https://chat.footagebrain.com/channel/${encodeURIComponent(ref.channel || "team")}`;
    window.open(url, "_blank", "noopener");
  };
  const canArchive = can("archiveReel");
  const canDelete = can("deleteReel");
  const canCreate = can("createReel");
  const showMenu = canArchive || canDelete || canCreate;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDupePicker, setShowDupePicker] = useState(false);
  const { peopleList } = useRoster();
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);
  // The menu is portaled to <body> so it escapes the grid card's overflow
  // clamp + sibling-card stacking (memory: portal-escape-overflow-clip).
  const menuPos = useAnchoredPosition(menuOpen, menuBtnRef, { width: 180, align: "right", gap: 4 });
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      const inBtn = menuBtnRef.current && menuBtnRef.current.contains(e.target);
      if (!inMenu && !inBtn) setMenuOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);
  // Reset picker view whenever the menu closes.
  useEffect(() => { if (!menuOpen) setShowDupePicker(false); }, [menuOpen]);

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
  const onDuplicateFor = (person) => {
    const firstName = person.short || (person.name || "").split(" ")[0] || person.id;
    setMenuOpen(false);
    actions.duplicateReel(reel.id, person.id, firstName);
  };

  return (
    <div
      className={cls}
      onClick={openReel}
      /* Compact (grid) cards clip to 58px via overflow:hidden; while the kebab
         menu is open, let the dropdown escape that clamp (inline overrides the
         stylesheet rule — styles.css is edit-locked). */
      style={menuOpen && compact ? { ...cardStyle, overflow: "visible", zIndex: 5 } : cardStyle}
    >
      <div className="head">
        <div>
          {!collapsed && !compact && (
            <div className="id">
              {reel.id}
              {unreadCount > 0 && (
                <span className="unread-dot"
                      title={unreadCount + " unread comment" + (unreadCount === 1 ? "" : "s")}>
                  {unreadCount}
                </span>
              )}
              {chatRefs.length > 0 && (
                <span className="unread-dot"
                      title={"Discussed in team chat — open the latest conversation"}
                      style={{ cursor: "pointer" }}
                      onClick={e => openChatRef(e, chatRefs[0])}>
                  💬 {chatRefs.length}
                </span>
              )}
            </div>
          )}
          <div className="title">
            {reel.mediaPath && (
              <span
                title="Reel state video attached"
                style={{ fontSize: 10, marginRight: 4, verticalAlign: "middle", opacity: 0.85 }}
              >🎥</span>
            )}
            {reel.title}
          </div>
          {!collapsed && !compact && reel.series && (
            <div className="reel-series" title={"Series: " + reel.series}>
              ⛓ {reel.series}
            </div>
          )}
          {!collapsed && !compact && reel.stage === "posted" && reel.scheduledPostDate && (
            <div className="mono dim reel-duedate" style={{ fontSize: 10, marginTop: 2 }}
                 title="Scheduled post date">
              📅 {reel.scheduledPostDate}
            </div>
          )}
        </div>
        {!collapsed && !compact && pillText && <Pill tone={pillTone}>{pillText}</Pill>}
        {!collapsed && showMenu && (
          <button
            ref={menuBtnRef}
            className="reel-menu-btn"
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            aria-label="Card actions"
            /* Hover-reveal is unreliable on dense grid tiles — keep the kebab
               visible in compact view so card-view actions are discoverable. */
            style={compact ? { opacity: 1 } : undefined}
          >⋯</button>
        )}
        {!collapsed && showMenu && menuOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            className="reel-menu"
            onClick={e => e.stopPropagation()}
            /* Portaled to <body>; fixed coords from the kebab rect so it
               can't be clipped by the card or painted under sibling cards.
               z-index 85 keeps it above every card (≤80) but below the
               modal backdrop (90) — so the Rocket.Chat recording-picker
               modal still covers it cleanly. */
            style={{
              position: "fixed",
              left: menuPos.left,
              ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
              right: "auto",
              marginTop: 0,
              maxHeight: menuPos.maxHeight,
              overflowY: "auto",
              zIndex: 85,
            }}
          >
            {showDupePicker ? (<>
              <div style={{ padding:"5px 10px 3px", fontFamily:"var(--f-mono)", fontSize:10, color:"var(--fg-dim,#888)", textTransform:"uppercase", letterSpacing:".06em" }}>Duplicate for:</div>
              {(peopleList || []).filter(p => !p.archivedAt).map(p => (
                <div key={p.id} className="reel-menu-opt" onClick={() => onDuplicateFor(p)}>
                  {p.short || (p.name || "").split(" ")[0] || p.id}
                </div>
              ))}
              <div className="reel-menu-opt" style={{ opacity:.6, fontSize:11 }} onClick={() => setShowDupePicker(false)}>← Back</div>
            </>) : (<>
              {canArchive && <div className="reel-menu-opt" onClick={onArchive}>Archive</div>}
              {canDelete && <div className="reel-menu-opt danger" onClick={onDelete}>Delete</div>}
              {canCreate && <div className="reel-menu-opt" onClick={() => setShowDupePicker(true)}>Duplicate →</div>}
            </>)}
          </div>,
          document.body
        )}
      </div>
      {!collapsed && !compact && reel.note && <div className="note">{reel.note}</div>}
      {!collapsed && !compact && reel.links && reel.links.length > 0 && (
        <div className="links" onClick={e => e.stopPropagation()}>
          {reel.links.map((l, i) => (
            <a key={i} className="link" href="#"
               onClick={e => { e.preventDefault(); e.stopPropagation(); }}>{l}</a>
          ))}
        </div>
      )}
      {!compact && (
        <div className="foot">
          <span>{collapsed ? "" : (reel.foot || "")}</span>
          <span
            className="collapse"
            onClick={e => { e.stopPropagation(); actions.toggleReelCollapsed(reel.id); }}
          >{collapsed ? "Expand" : "Collapse"}</span>
        </div>
      )}
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
