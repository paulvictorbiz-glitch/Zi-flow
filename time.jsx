/* =========================================================
   Clock + SLA display helpers.

   One TimeProvider mounted near the root ticks every 30s and
   broadcasts the current Date through context. Components that
   render age/due strings call useNow() to subscribe; React
   re-renders them when the tick fires.

   The formatters are stage-aware: a reel in `posted` shows
   "12d ago", in `review` shows "3h wait", in `ready` shows
   "scheduled", and any reel past its due renders "Xh over"
   regardless of stage. The legacy `r.age` / `r.due` strings
   are preserved as fallbacks for rows that haven't been
   re-seeded with real timestamps yet.
   ========================================================= */

import React from "react";

const MIN  = 60 * 1000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- Context + provider ---------- */
const TimeContext = React.createContext(new Date());

function TimeProvider({ children, tickMs = 30000 }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return <TimeContext.Provider value={now}>{children}</TimeContext.Provider>;
}

function useNow() {
  return React.useContext(TimeContext);
}

/* ---------- Duration formatting ---------- */
function formatDuration(ms) {
  const s = Math.abs(ms) / 1000;
  if (s < 60)    return "just now";
  if (s < HOUR / 1000) return Math.floor(s / 60) + "m";
  if (s < DAY  / 1000) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (m > 0 && h < 6) ? (h + "h " + m + "m") : (h + "h");
  }
  return Math.floor(s / 86400) + "d";
}

/* ---------- Per-stage age display ----------
   Returns the short pill/badge string that today's static `age`
   field carried. Stage-aware so the phrasings remain readable
   (the board's "queued 4h" vs "3h wait" vs "idle 3h"). */
function formatAge(reel, now) {
  if (!reel) return "";
  const stageEntered = reel.stageEnteredAt ? new Date(reel.stageEnteredAt) : null;
  const due          = reel.dueAt ? new Date(reel.dueAt) : null;

  // If past due, overdue framing wins for any active stage.
  if (due && now > due && reel.stage !== "ready" && reel.stage !== "posted") {
    return formatDuration(now - due) + " over";
  }

  if (!stageEntered) return reel.age || "";  // fallback to legacy string
  const inStage = now - stageEntered;

  switch (reel.stage) {
    case "posted":   return formatDuration(inStage) + " ago";
    case "ready":    return "scheduled";
    case "selected": return "queued " + formatDuration(inStage);
    case "review":   return formatDuration(inStage) + " wait";
    case "variants":
      // "idle Xh" if no progress within 30 minutes — matches the
      // original UX where variants-stage idle was the headline.
      if (inStage > 30 * MIN && reel.blocker) return "idle " + formatDuration(inStage);
      return formatDuration(inStage) + " in stage";
    case "main":
    case "idea":
    default:         return formatDuration(inStage);
  }
}

/* ---------- Due display ---------- */
function formatDue(reelOrTask, now) {
  if (!reelOrTask) return "";
  const dueAt = reelOrTask.dueAt ? new Date(reelOrTask.dueAt) : null;
  if (!dueAt) return reelOrTask.due || "";  // fallback to legacy string

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const dayStart   = new Date(dueAt); dayStart.setHours(0, 0, 0, 0);
  const diffDays   = Math.round((dayStart - todayStart) / DAY);

  const hh = String(dueAt.getHours()).padStart(2, "0");
  const mm = String(dueAt.getMinutes()).padStart(2, "0");
  const time = hh + ":" + mm;

  if (diffDays === 0)  return "today " + time;
  if (diffDays === 1)  return "tomorrow " + time;
  if (diffDays === -1) return "yest " + time;
  if (diffDays > 1 && diffDays < 7)  return DAY_NAMES[dueAt.getDay()] + " " + time;
  if (diffDays < 0)  return Math.abs(diffDays) + "d ago";
  // > 1 week out → ISO-ish month-day
  const month = String(dueAt.getMonth() + 1).padStart(2, "0");
  const day   = String(dueAt.getDate()).padStart(2, "0");
  return month + "-" + day + " " + time;
}

/* ---------- Derived SLA state ----------
   Returns "ok" | "warn" | "block" based purely on time vs due,
   so cards can light up even if no human has set r.state. Per-
   stage thresholds approximate the production rules described
   in the original seed comments. */
function slaState(reel, now) {
  if (!reel) return "ok";
  const due = reel.dueAt ? new Date(reel.dueAt) : null;
  if (due && now > due) return "block";  // past due → block

  if (reel.stage === "review") {
    const entered = reel.stageEnteredAt ? new Date(reel.stageEnteredAt) : null;
    if (entered) {
      const wait = now - entered;
      if (wait > 24 * HOUR) return "block";
      if (wait > 4  * HOUR) return "warn";
    }
  }
  if (due) {
    const left = due - now;
    if (left < 2 * HOUR && left > 0) return "warn";
  }
  return "ok";
}

export { TimeProvider, useNow, formatAge, formatDue, formatDuration, slaState };
