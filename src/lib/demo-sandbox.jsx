/* =========================================================
   Demo sandbox — per-session isolation for the shared demo
   account (testuser@gmail.com, people.role = 'demo').

   Goal: friends can click around the LIVE site — create, edit,
   move, delete reels/cards/tasks — and see it all work in their
   own browser session, WITHOUT any of it persisting to the real
   database. On reload they get a fresh copy seeded from the
   `demo=true` baseline. Two browsers on the same login each get
   their own independent session.

   How it works (lightweight, by design):
     · The Supabase RLS from migration 0049 is the HARD guarantee —
       a demo user can only ever read/write `demo=true` rows, never
       real data, even from devtools.
     · This module adds the UX layer on top: when demoMode is on,
       the workflow store SKIPS every Supabase write (the optimistic
       reducer already updated local React state, so the UI reflects
       the change), and realtime is disabled. Nothing is persisted,
       so a reload re-hydrates from the clean baseline → "fresh copy
       each visit", and concurrent sessions never see each other.

   We keep a tiny module-level flag (not just React state) because
   the store's `persist*` functions are module-level and run outside
   React. `setDemoMode()` is called from a hook inside the provider
   tree once the signed-in person is known.
   ========================================================= */

let _demoMode = false;

/** True when the current session belongs to the demo account. */
export function isDemoMode() {
  return _demoMode;
}

/** Set by useSyncDemoMode() once auth resolves the signed-in person. */
export function setDemoMode(on) {
  _demoMode = !!on;
}
