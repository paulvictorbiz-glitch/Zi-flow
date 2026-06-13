export const NOMINAL_POLL_SEC = 15;
export const GAP_CAP_MS = 90 * 1000;
export const ONLINE_WINDOW_MS = 45 * 1000;
export const SESSION_GAP_MIN = 4;

export function startOfDayLocal(offsetDays = 0, base) {
  const d = base ? new Date(base) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export function analyzeDay(rowsAsc, nowMs) {
  const n = rowsAsc.length;
  const span = rowsAsc.map((r, i) => {
    const t = new Date(r.ts).getTime();
    const next = i + 1 < n ? new Date(rowsAsc[i + 1].ts).getTime() : nowMs;
    return Math.min(Math.max(next - t, 0), GAP_CAP_MS);
  });
  let total = 0, active = 0;
  const proj = {}, hourly = Array(24).fill(0);
  for (let i = 0; i < n; i++) {
    total += span[i];
    if (rowsAsc[i].focused) active += span[i];
    const p = rowsAsc[i].project_title;
    if (p) proj[p] = (proj[p] || 0) + span[i];
    hourly[new Date(rowsAsc[i].ts).getHours()] += span[i];
  }
  const sessions = []; let cur = null;
  for (let i = 0; i < n; i++) {
    const r = rowsAsc[i], t = new Date(r.ts).getTime(), p = r.project_title || null;
    const gap = cur ? t - cur.lastT : Infinity;
    const projChanged = cur && p && cur.project && p !== cur.project;
    if (cur && gap <= SESSION_GAP_MIN * 60000 && !projChanged) {
      cur.lastT = t; cur.end = r.ts; cur.ms += span[i]; if (r.focused) cur.activeMs += span[i];
      if (p) { cur.projects[p] = (cur.projects[p] || 0) + span[i]; if (!cur.project) cur.project = p; }
    } else {
      if (cur) sessions.push(cur);
      cur = { start: r.ts, end: r.ts, lastT: t, ms: span[i], activeMs: r.focused ? span[i] : 0, projects: {}, project: p };
      if (p) cur.projects[p] = span[i];
    }
  }
  if (cur) sessions.push(cur);
  return {
    totalMin: total / 60000, activeMin: active / 60000, idleMin: Math.max(0, total - active) / 60000,
    sessions: sessions.reverse(),
    projects: Object.entries(proj).map(([k, v]) => [k, v / 60000]).sort((a, b) => b[1] - a[1]),
    hourly: hourly.map(ms => ms / 60000),
  };
}

export function fmtDuration(min) {
  const m = Math.round(min);
  if (m <= 0) return "0m";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export async function loadDayRows(worker, dayStart, supabaseClient) {
  const dayEnd = startOfDayLocal(1, dayStart);
  const all = []; let from = 0; const page = 1000;
  for (let guard = 0; guard < 25; guard++) {
    const { data, error } = await supabaseClient
      .from("capcut_activity")
      .select("ts, running, focused, project_title")
      .eq("worker", worker)
      .gte("ts", dayStart.toISOString()).lt("ts", dayEnd.toISOString())
      .order("ts", { ascending: true }).range(from, from + page - 1);
    if (error) { console.error("capcut day:", error.message); break; }
    all.push(...(data || []));
    if (!data || data.length < page) break;
    from += page;
  }
  return all;
}
