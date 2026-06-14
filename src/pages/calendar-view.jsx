/* =========================================================
   Calendar View — live operational calendar built from the
   reels store (replaces the old static May-2026 fixture).

   Dated items come from two places:
     · posted reels   → their scheduledPostDate (set by the
       Move-to-Posted modal), falling back to dueAt → "post"
     · everything else with a dueAt → "review" while in the
       review stage, otherwise "due"

   Reels with no date simply don't appear — this calendar only
   shows things anchored to a day. Week and month grids reuse
   the existing cal-* CSS; ‹ › paging moves by week/month and
   "today" jumps back to the current one.
   ========================================================= */

import React, { useMemo, useState } from "react";
import { DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import { useNow } from "../lib/time.jsx";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/* Local-time date key "YYYY-MM-DD" for a Date. */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}

/* A stored date value is either date-only ("2026-06-15", from the
   schedule modal) or a full ISO datetime (dueAt). Returns
   { key: "YYYY-MM-DD", time: "HH:MM" | null } in local time. */
function splitDateValue(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { key: value, time: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { key: dateKey(d), time: hh + ":" + mm };
}

/* Monday 00:00 of the week containing `base`. */
function mondayOf(base) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  return d;
}

/* Derive every dated calendar item from the live reels. */
function buildItems(reels) {
  const items = [];
  for (const r of reels) {
    if (r.archivedAt) continue;
    if (r.stage === "posted") {
      const at = splitDateValue(r.scheduledPostDate || r.dueAt);
      if (at) items.push({ kind: "post", tone: "ok", label: "post", reel: r, ...at });
    } else if (r.dueAt) {
      const at = splitDateValue(r.dueAt);
      if (!at) continue;
      const kind = r.stage === "review" ? "review" : "due";
      const tone = r.state === "block" ? "block" : kind === "review" ? "warn" : "cyan";
      items.push({ kind, tone, label: kind === "review" ? "review" : "due", reel: r, ...at });
    }
  }
  // Date-only items (scheduled posts) lead each day; timed items follow by time.
  items.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    if (!a.time && b.time) return -1;
    if (a.time && !b.time) return 1;
    return (a.time || "").localeCompare(b.time || "");
  });
  return items;
}

function CalendarItem({ it, onOpen, compact }) {
  const { peopleById } = useRoster();
  const r = it.reel;
  if (compact) {
    return (
      <div className={"mc-pill " + it.tone}
           title={r.title}
           onClick={() => onOpen(r)}>
        <span className="mono dim">{it.time || "—"}</span> {it.label} · {r.title}
      </div>
    );
  }
  return (
    <div className={"cal-item " + it.tone} onClick={() => onOpen(r)}>
      <div className="ci-time">{it.time || "any time"} · <span className="mono dim">{it.label}</span></div>
      <div className="ci-title">{r.title}</div>
      <div className="ci-foot">
        <span className="mono dim">{r.id}</span>
        <span className={"avatar-chip " + (peopleById[r.owner]?.role || "")}>
          {peopleById[r.owner]?.avatar}
        </span>
      </div>
    </div>
  );
}

function CalendarView({ role, onOpen }) {
  const { reels } = useWorkflow();
  const now = useNow();
  const [mode, setMode] = useState("week"); // week | month
  const [kind, setKind] = useState("all");
  const [offset, setOffset] = useState(0);  // weeks or months from today, per mode

  const allItems = useMemo(() => buildItems(reels), [reels]);
  const items = useMemo(
    () => kind === "all" ? allItems : allItems.filter(it => it.kind === kind),
    [allItems, kind]
  );
  const byDay = useMemo(() => {
    const m = {};
    for (const it of items) (m[it.key] = m[it.key] || []).push(it);
    return m;
  }, [items]);

  const todayKey = dateKey(new Date(now));

  /* Range label + grids per mode. */
  const weekStart = useMemo(() => {
    const d = mondayOf(new Date(now));
    d.setDate(d.getDate() + offset * 7);
    return d;
  }, [now, offset]);

  const monthAnchor = useMemo(() => {
    const d = new Date(now);
    d.setDate(1); d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + offset);
    return d;
  }, [now, offset]);

  const rangeLabel = mode === "week"
    ? "week of " + MONTHS[weekStart.getMonth()].slice(0, 3) + " " + weekStart.getDate() + " · " + weekStart.getFullYear()
    : MONTHS[monthAnchor.getMonth()] + " " + monthAnchor.getFullYear();

  const switchMode = (m) => { setMode(m); setOffset(0); };

  return (
    <div>
      <div className="list-filterbar">
        <span className="mono muted">view</span>
        <DPill active={mode === "week"}  onClick={() => switchMode("week")}>Week</DPill>
        <DPill active={mode === "month"} onClick={() => switchMode("month")}>Month</DPill>
        <span style={{ width: 12 }} />
        <span className="mono muted">type</span>
        <DPill active={kind === "all"}    onClick={() => setKind("all")}>All</DPill>
        <DPill active={kind === "post"}   onClick={() => setKind("post")}>Post windows</DPill>
        <DPill active={kind === "review"} onClick={() => setKind("review")} tone="amber">Reviews</DPill>
        <DPill active={kind === "due"}    onClick={() => setKind("due")}>Due</DPill>
        <span style={{ flex: 1 }} />
        <DPill onClick={() => setOffset(o => o - 1)}>‹</DPill>
        <DPill active={offset === 0} onClick={() => setOffset(0)}>today</DPill>
        <DPill onClick={() => setOffset(o => o + 1)}>›</DPill>
        <span className="mono muted">{rangeLabel}</span>
      </div>

      {allItems.length === 0 && (
        <div className="mono dim" style={{ padding: "14px 22px", fontSize: 11.5 }}>
          Nothing dated yet — set a due date on a card, or pick a post date when
          moving a reel to Posted, and it shows up here.
        </div>
      )}

      {mode === "week"
        ? <WeekGrid weekStart={weekStart} byDay={byDay} todayKey={todayKey} onOpen={onOpen} />
        : <MonthGrid monthAnchor={monthAnchor} byDay={byDay} todayKey={todayKey} onOpen={onOpen} />}
    </div>
  );
}

/* ---------- Week grid: 7 day columns, items stacked per day ---------- */
function WeekGrid({ weekStart, byDay, todayKey, onOpen }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * DAY_MS);
    return { date: d, key: dateKey(d) };
  });

  return (
    <div className="cal-week">
      <div className="cal-row cal-head-row">
        <div className="cal-time"></div>
        {days.map((d, i) => (
          <div className="cal-day-head" key={i}
               style={d.key === todayKey ? { background: "rgba(107,214,224,0.06)" } : undefined}>
            <div className="cal-d">{WEEKDAYS[i]}{d.key === todayKey ? " · today" : ""}</div>
            <div className="cal-n">{d.date.getDate()}</div>
          </div>
        ))}
      </div>
      <div className="cal-row" style={{ minHeight: 180 }}>
        <div className="cal-time"></div>
        {days.map((d, i) => (
          <div className="cal-cell" key={i}
               style={d.key === todayKey ? { background: "rgba(107,214,224,0.03)" } : undefined}>
            {(byDay[d.key] || []).map((it, j) => (
              <CalendarItem key={j} it={it} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Month grid: real weeks of the anchor month ---------- */
function MonthGrid({ monthAnchor, byDay, todayKey, onOpen }) {
  const weeks = useMemo(() => {
    const first = mondayOf(monthAnchor);
    const out = [];
    const cursor = new Date(first);
    // Render full weeks until the month is covered (4–6 rows).
    do {
      const row = [];
      for (let i = 0; i < 7; i++) {
        row.push({
          date: new Date(cursor),
          key: dateKey(cursor),
          inMonth: cursor.getMonth() === monthAnchor.getMonth(),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      out.push(row);
    } while (cursor.getMonth() === monthAnchor.getMonth());
    return out;
  }, [monthAnchor]);

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {WEEKDAYS.map(d => <div key={d} className="mh">{d}</div>)}
      </div>
      {weeks.map((row, ri) => (
        <div className="cal-month-row" key={ri}>
          {row.map((c, ci) => {
            const items = byDay[c.key] || [];
            const isToday = c.key === todayKey;
            return (
              <div key={ci}
                   className={"cal-month-cell " + (c.inMonth ? "" : "off")}
                   style={isToday ? { background: "rgba(107,214,224,0.05)" } : undefined}>
                <div className="mc-n" style={isToday ? { color: "var(--c-cyan)" } : undefined}>
                  {c.date.getDate()}{isToday ? " · today" : ""}
                </div>
                <div className="mc-list">
                  {items.slice(0, 3).map((it, i) => (
                    <CalendarItem key={i} it={it} onOpen={onOpen} compact />
                  ))}
                  {items.length > 3 && (
                    <div className="mono dim" style={{ paddingLeft: 4 }}>+{items.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export { CalendarView };
