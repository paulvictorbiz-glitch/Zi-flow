/* =========================================================
   Calendar View — operational week of due dates: reviews,
   variant deadlines, post windows, decisions. Not a marketing
   calendar — every cell is a thing that needs an action.
   ========================================================= */

import React, { useState } from "react";
import { DPill, Pill } from "./components.jsx";
import { ROLES, CAL_WEEK, CAL_ITEMS, PEOPLE } from "./shared-data.jsx";

function CalendarView({ role, onOpen }) {
  const [mode, setMode] = useState("week"); // week | month
  const [kind, setKind] = useState("all");

  const filterItem = (it) =>
    (kind === "all" || it.kind === kind) &&
    (role === "all" || it.owner === ROLES[role]?.person);

  return (
    <div>
      <div className="list-filterbar">
        <span className="mono muted">view</span>
        <DPill active={mode === "week"}  onClick={() => setMode("week")}>Week</DPill>
        <DPill active={mode === "month"} onClick={() => setMode("month")}>Month</DPill>
        <span style={{ width: 12 }} />
        <span className="mono muted">type</span>
        <DPill active={kind === "all"}      onClick={() => setKind("all")}>All</DPill>
        <DPill active={kind === "decision"} onClick={() => setKind("decision")} tone="amber">Decisions</DPill>
        <DPill active={kind === "review"}   onClick={() => setKind("review")}>Reviews</DPill>
        <DPill active={kind === "variant"}  onClick={() => setKind("variant")}>Variant due</DPill>
        <DPill active={kind === "post"}     onClick={() => setKind("post")}>Post windows</DPill>
        <span style={{ flex: 1 }} />
        <span className="mono muted">week of May 13 · 2026</span>
      </div>

      {mode === "week" ? <WeekGrid filterItem={filterItem} onOpen={onOpen} />
                       : <MonthGrid filterItem={filterItem} onOpen={onOpen} />}
    </div>
  );
}

/* ---------- Week grid: 7 cols x time-of-day rows ---------- */
function WeekGrid({ filterItem, onOpen }) {
  const slots = ["08:00","10:00","12:00","14:00","16:00","18:00","20:00","22:00"];

  // bin items into slot rows by hour
  const slotOf = (t) => {
    const h = parseInt(t.split(":")[0], 10);
    const target = slots.findIndex(s => parseInt(s, 10) >= h);
    return target === -1 ? slots.length - 1 : Math.max(0, target);
  };

  return (
    <div className="cal-week">
      <div className="cal-row cal-head-row">
        <div className="cal-time"></div>
        {CAL_WEEK.map((d, i) => (
          <div className="cal-day-head" key={i}>
            <div className="cal-d">{d.label}</div>
            <div className="cal-n">{d.n}</div>
          </div>
        ))}
      </div>
      {slots.map((s, si) => (
        <div className="cal-row" key={s}>
          <div className="cal-time">{s}</div>
          {CAL_WEEK.map((d, di) => {
            const items = CAL_ITEMS.filter(filterItem).filter(it => it.dow === di && slotOf(it.t) === si);
            return (
              <div className="cal-cell" key={di}>
                {items.map((it, i) => (
                  <div key={i} className={"cal-item " + it.tone}
                       onClick={() => onOpen({ id: it.reel, title: it.title })}>
                    <div className="ci-time">{it.t} · <span className="mono dim">{it.kind}</span></div>
                    <div className="ci-title">{it.title}</div>
                    <div className="ci-foot">
                      <span className="mono dim">{it.reel}</span>
                      <span className={"avatar-chip " + (PEOPLE[it.owner]?.role || "")}>
                        {PEOPLE[it.owner]?.avatar}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------- Month grid — compact day cells with item dots ---------- */
function MonthGrid({ filterItem, onOpen }) {
  // synthesize a 5-week May 2026 grid with this week populated
  const weeks = [];
  let day = -3; // start in late April for first row
  for (let w = 0; w < 5; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      day++;
      row.push({ day, inMonth: day >= 1 && day <= 31 });
    }
    weeks.push(row);
  }

  // map current week (May 13–19) items onto specific days
  const itemsForDay = (d) => {
    const offset = d - 13; // 13 = Mon
    if (offset < 0 || offset > 6) return [];
    return CAL_ITEMS.filter(filterItem).filter(it => it.dow === offset);
  };

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d =>
          <div key={d} className="mh">{d}</div>
        )}
      </div>
      {weeks.map((row, ri) => (
        <div className="cal-month-row" key={ri}>
          {row.map((c, ci) => {
            const items = itemsForDay(c.day);
            return (
              <div key={ci} className={"cal-month-cell " + (c.inMonth ? "" : "off")}>
                <div className="mc-n">{c.inMonth ? c.day : ""}</div>
                <div className="mc-list">
                  {items.slice(0, 3).map((it, i) => (
                    <div key={i} className={"mc-pill " + it.tone}
                         onClick={() => onOpen({ id: it.reel, title: it.title })}>
                      <span className="mono dim">{it.t}</span> {it.title}
                    </div>
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
