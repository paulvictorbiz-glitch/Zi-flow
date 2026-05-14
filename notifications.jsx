/* =========================================================
   Comment notifications.

   Per-user, per-reel "last read" timestamps are kept in
   localStorage. A comment is unread for me if:
     · it isn't a system audit entry (`c.system`),
     · it wasn't authored by me, and
     · its timestamp is newer than my last-read mark on that reel.

   The detail view calls markRead(reelId) when it opens a reel so
   the badge clears. Cross-tab updates: we listen for the
   "storage" event so the bell updates everywhere when one tab
   marks a reel as read.

   Scoped per signed-in person so two people on the same machine
   keep separate notification state.
   ========================================================= */

import React from "react";
import { useAuth } from "./auth.jsx";
import { useWorkflow } from "./store.jsx";

const STORAGE_KEY = "workflow.comments.lastRead.v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
}

const NotificationsContext = React.createContext(null);

function NotificationsProvider({ children }) {
  const { person: me } = useAuth();
  const { reels } = useWorkflow();
  const [store, setStore] = React.useState(loadStore);

  /* Cross-tab sync: when another tab writes the lastRead map,
     refresh our local copy so the bell stays consistent. */
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      setStore(loadStore());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const myMap = (me && store[me.id]) || {};

  const unreadByReel = React.useMemo(() => {
    if (!me) return {};
    const out = {};
    for (const r of reels) {
      if (r.archivedAt) continue;
      const comments = r.detail?.comments || [];
      const last = myMap[r.id] || "";
      let count = 0;
      for (const c of comments) {
        if (c.system) continue;
        if (c.authorId && c.authorId === me.id) continue;
        if ((c.ts || "") > last) count++;
      }
      if (count > 0) out[r.id] = count;
    }
    return out;
  // myMap reference changes when store changes; reels covers comment writes
  }, [reels, me, myMap]);

  const totalUnread = React.useMemo(
    () => Object.values(unreadByReel).reduce((a, b) => a + b, 0),
    [unreadByReel]
  );

  const markRead = React.useCallback((reelId) => {
    if (!me || !reelId) return;
    const reel = reels.find(r => r.id === reelId);
    const comments = reel?.detail?.comments || [];
    /* Mark up to the newest non-system, non-self comment on this
       reel. System and own comments are already filtered from
       unread counts; we still advance past them so the stored
       cursor reflects "I've seen this reel through ts X". */
    let latest = "";
    for (const c of comments) {
      const ts = c.ts || "";
      if (ts > latest) latest = ts;
    }
    if (!latest) return;
    setStore(prev => {
      const meMap = prev[me.id] || {};
      if (meMap[reelId] === latest) return prev;
      const next = { ...prev, [me.id]: { ...meMap, [reelId]: latest } };
      saveStore(next);
      return next;
    });
  }, [me, reels]);

  const value = React.useMemo(
    () => ({ unreadByReel, totalUnread, markRead }),
    [unreadByReel, totalUnread, markRead]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

function useNotifications() {
  const ctx = React.useContext(NotificationsContext);
  /* Fail soft: components that render before the provider mounts
     (or outside of it, e.g. in tests) just see zero unread. */
  if (!ctx) return { unreadByReel: {}, totalUnread: 0, markRead: () => {} };
  return ctx;
}

export { NotificationsProvider, useNotifications };
