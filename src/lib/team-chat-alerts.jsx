/* =========================================================
   Team-chat alerts — new Rocket.Chat message notifications.

   The Teams chat is a cross-origin iframe (chat.footagebrain.com),
   so the app can't read it directly. Instead the backend proxies
   Rocket.Chat with an admin token and exposes
     GET /fb/api/rocketchat/dashboard/recent-messages?since=<iso>
   which returns recent channel messages (the caller's OWN messages
   already excluded server-side). This provider polls that endpoint
   while the tab is visible and turns new messages into:
     · an audible Web Audio "ping",
     · a floating toast (latestToast),
     · a rolling recent-messages list (the My Work card),
     · an unread-count badge (unseenCount).

   All state is device-local (localStorage), scoped per signed-in
   person — mute toggle, a last-seen cursor, the recent buffer, and a
   seen-id ring used for cross-tab de-dupe + single-ping election.

   Degrades silently: if the endpoint isn't deployed yet (404) or
   errors, the provider stays inert — empty card, no pings, no crash.
   ========================================================= */

import React from "react";
import { useAuth } from "../auth.jsx";
import { fetchRecentTeamMessages } from "./social-client.js";

const K_MUTED    = "fb.teamChatAlerts.muted.v1";     // { [personId]: boolean }
const K_LASTSEEN = "fb.teamChatAlerts.lastSeen.v1";  // { [personId]: isoTs }
const K_RECENT   = "fb.teamChatAlerts.recent.v1";    // { [personId]: Item[] }
const K_SEEN     = "fb.teamChatAlerts.seen.v1";      // { [personId]: id[] }

const RECENT_CAP = 30;
const SEEN_CAP   = 200;
const POLL_MS    = 20000;

function loadMap(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : {}; }
  catch (_) { return {}; }
}
function saveMap(key, m) {
  try { localStorage.setItem(key, JSON.stringify(m)); } catch (_) {}
}

/* ── Web Audio "ping" — deferred AudioContext (SSR/build-safe; created on
   first use, never at module load). Mirrors space-audio.js. ── */
let _audioCtx = null;
function _getCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!_audioCtx) { try { _audioCtx = new AC(); } catch (_) { return null; } }
  return _audioCtx;
}
/* OS "tray" notification via the browser Notification API. Fires only when the
   app ISN'T focused (the in-app toast covers the focused case) and permission
   was granted. Clicking it focuses the window and jumps to the Team tab. */
function showDesktopNote(msg) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && document.hasFocus()) return;
    const n = new Notification(`New Teams message${msg.room ? ` · #${msg.room}` : ""}`, {
      body: `${msg.sender ? msg.sender + ": " : ""}${msg.text || ""}`.slice(0, 180),
      tag: msg.id,          // collapse repeats for the same message id
    });
    n.onclick = () => {
      try { window.focus(); window.__navigate?.("team"); n.close(); } catch (_) {}
    };
  } catch (_) { /* notifications unsupported / blocked — silent no-op */ }
}

function playPing() {
  const ctx = _getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.27);
  } catch (_) { /* autoplay blocked / no WebAudio — silent no-op */ }
}

const TeamChatAlertsContext = React.createContext(null);

function TeamChatAlertsProvider({ children }) {
  const { person: me } = useAuth();
  const pid = me?.id || null;

  const [recent, setRecent]       = React.useState(() => loadMap(K_RECENT));
  const [muted, setMuted]         = React.useState(() => loadMap(K_MUTED));
  const [lastSeen, setLastSeen]   = React.useState(() => loadMap(K_LASTSEEN));
  const [latestToast, setLatestToast] = React.useState(null);
  const [desktopPerm, setDesktopPerm] = React.useState(
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission)
  );

  const sinceRef = React.useRef("");        // server_time cursor for the next poll
  const baselinedRef = React.useRef(false); // first poll = baseline (no ping/no unseen)
  const mutedRef = React.useRef(muted);     // read inside the poll without re-subscribing
  React.useEffect(() => { mutedRef.current = muted; }, [muted]);

  const myRecent = (pid && recent[pid]) || EMPTY_ARR;
  const myMuted  = !!(pid && muted[pid]);
  const myLastSeen = (pid && lastSeen[pid]) || "";

  /* Resume the AudioContext on the first user gesture so the ping isn't
     swallowed by the browser autoplay policy. One-shot. */
  React.useEffect(() => {
    const resume = () => { const c = _getCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  /* Cross-tab sync: refresh recent/muted/lastSeen when another tab writes. */
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key === K_RECENT)   setRecent(loadMap(K_RECENT));
      if (e.key === K_MUTED)    setMuted(loadMap(K_MUTED));
      if (e.key === K_LASTSEEN) setLastSeen(loadMap(K_LASTSEEN));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* Re-baseline whenever the signed-in person changes. */
  React.useEffect(() => {
    sinceRef.current = "";
    baselinedRef.current = false;
  }, [pid]);

  /* claimNew: returns the subset of message ids not yet in this person's seen
     ring, and atomically records them (re-reading localStorage so a sibling
     tab's writes are honoured → only the first tab pings for a given id). */
  const claimNew = React.useCallback((ids) => {
    if (!pid || !ids.length) return [];
    const map = loadMap(K_SEEN);
    const ring = Array.isArray(map[pid]) ? map[pid] : [];
    const have = new Set(ring);
    const fresh = ids.filter((id) => !have.has(id));
    if (!fresh.length) return [];
    const nextRing = ring.concat(fresh).slice(-SEEN_CAP);
    map[pid] = nextRing;
    saveMap(K_SEEN, map);
    return fresh;
  }, [pid]);

  /* The poll loop. Runs while the tab is visible; pauses when hidden and
     fires immediately again on focus/visibility. */
  React.useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      // Polls even when the tab is hidden (browsers throttle background timers,
      // which is fine) so desktop/tray notifications still fire while you're away.
      try {
        const res = await fetchRecentTeamMessages({ since: sinceRef.current });
        if (cancelled) return;
        const list = Array.isArray(res?.messages) ? res.messages : [];
        if (res?.server_time) sinceRef.current = res.server_time;

        const first = !baselinedRef.current;
        baselinedRef.current = true;

        // De-dupe + claim across tabs by message id.
        const fresh = claimNew(list.map((m) => m.id).filter(Boolean));
        if (fresh.length) {
          const freshSet = new Set(fresh);
          const freshMsgs = list.filter((m) => freshSet.has(m.id));

          // Merge into the rolling recent buffer (newest first).
          setRecent((prev) => {
            const mine = Array.isArray(prev[pid]) ? prev[pid] : [];
            const byId = new Map(mine.map((m) => [m.id, m]));
            for (const m of freshMsgs) byId.set(m.id, m);
            const merged = Array.from(byId.values())
              .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))
              .slice(0, RECENT_CAP);
            const next = { ...prev, [pid]: merged };
            saveMap(K_RECENT, next);
            return next;
          });

          // First poll is a baseline (existing backlog) — don't ping/toast.
          if (!first) {
            const newest = freshMsgs
              .slice()
              .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))[0];
            if (newest && !mutedRef.current) {
              playPing();
              setLatestToast({ ...newest, _shownAt: Date.now() });
              showDesktopNote(newest);
            }
          }
        }
      } catch (_) {
        // network / endpoint-not-deployed → stay inert.
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(tick, POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [pid, claimNew]);

  /* DEV-ONLY test hook: window.__simulateTeamMessage("text", "Sender", "room")
     drives a synthetic message through the exact ping/toast/card/badge path so
     the notifier can be exercised locally before the backend route is deployed.
     Stripped from production builds (import.meta.env.DEV is false there). */
  React.useEffect(() => {
    if (!import.meta.env?.DEV || !pid) return;
    let n = 0;
    window.__simulateTeamMessage = (text = "Test message", sender = "Teammate", room = "pipeline") => {
      const msg = {
        id: `sim-${Date.now()}-${n++}`,
        room, roomType: "c", sender, senderId: "sim",
        text, ts: new Date().toISOString(), url: "",
      };
      const fresh = claimNew([msg.id]);
      if (!fresh.length) return;
      setRecent((prev) => {
        const mine = Array.isArray(prev[pid]) ? prev[pid] : [];
        const merged = [msg, ...mine].slice(0, RECENT_CAP);
        const next = { ...prev, [pid]: merged };
        saveMap(K_RECENT, next);
        return next;
      });
      if (!mutedRef.current) { playPing(); setLatestToast({ ...msg, _shownAt: Date.now() }); showDesktopNote(msg); }
      return "simulated";
    };
    return () => { try { delete window.__simulateTeamMessage; } catch (_) {} };
  }, [pid, claimNew]);

  const unseenCount = React.useMemo(() => {
    if (!pid) return 0;
    let n = 0;
    for (const m of myRecent) if ((m.ts || "") > myLastSeen) n++;
    return n;
  }, [pid, myRecent, myLastSeen]);

  const markAllRead = React.useCallback(() => {
    if (!pid) return;
    const nowIso = new Date().toISOString();
    setLastSeen((prev) => {
      const next = { ...prev, [pid]: nowIso };
      saveMap(K_LASTSEEN, next);
      return next;
    });
    setLatestToast(null);
  }, [pid]);

  const toggleMuted = React.useCallback(() => {
    if (!pid) return;
    setMuted((prev) => {
      const next = { ...prev, [pid]: !prev[pid] };
      saveMap(K_MUTED, next);
      return next;
    });
  }, [pid]);

  const dismissToast = React.useCallback(() => setLatestToast(null), []);

  /* Ask the browser for OS/tray notification permission (needs a user gesture →
     called from the card's "Enable desktop alerts" button). */
  const enableDesktop = React.useCallback(async () => {
    if (typeof Notification === "undefined") { setDesktopPerm("unsupported"); return "unsupported"; }
    if (Notification.permission === "granted") { setDesktopPerm("granted"); return "granted"; }
    try {
      const res = await Notification.requestPermission();
      setDesktopPerm(res);
      return res;
    } catch (_) {
      setDesktopPerm(Notification.permission);
      return Notification.permission;
    }
  }, []);

  const value = React.useMemo(() => ({
    recentMessages: myRecent,
    unseenCount,
    totalUnread: unseenCount,
    muted: myMuted,
    toggleMuted,
    markAllRead,
    latestToast,
    dismissToast,
    desktopPerm,
    enableDesktop,
  }), [myRecent, unseenCount, myMuted, toggleMuted, markAllRead, latestToast, dismissToast, desktopPerm, enableDesktop]);

  return (
    <TeamChatAlertsContext.Provider value={value}>
      {children}
    </TeamChatAlertsContext.Provider>
  );
}

const EMPTY_ARR = [];

function useTeamChatAlerts() {
  const ctx = React.useContext(TeamChatAlertsContext);
  // Fail soft: components rendered before/outside the provider see inert defaults.
  if (!ctx) return {
    recentMessages: EMPTY_ARR, unseenCount: 0, totalUnread: 0,
    muted: false, toggleMuted: () => {}, markAllRead: () => {},
    latestToast: null, dismissToast: () => {},
    desktopPerm: "default", enableDesktop: () => {},
  };
  return ctx;
}

export { TeamChatAlertsProvider, useTeamChatAlerts };
