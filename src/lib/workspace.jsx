/* =========================================================
   Workspace — client-scoping foundation (multi-tenant v1).

   Read from Supabase `workspaces` (migration 0115). Every reel /
   review-lane card / footage search belongs to exactly one
   workspace (the shared slug — see CROSS-TEAM CONTRACT C2 below);
   `activeSlug` picks which one the UI + non-React store currently
   operate on. There is NO null / "all workspaces" scope in v1 —
   activeSlug always resolves to a real slug, defaulting to 'paul'.

   Two ways to read/drive it, mirroring src/lib/roster.jsx exactly:
     · useWorkspace()  — React hook for components (activeSlug,
                         workspaces, loaded, setActive, createWorkspace,
                         reload).
     · getActiveWorkspaceSlug() / setActive() / subscribeWorkspace()
       — plain functions backed by a module-level singleton, for
       non-React code that can't use hooks (the workflow store's
       reducer/persist helpers via useSyncExternalStore, and the
       eagerly-bundled footage-brain-client.js).

   FROZEN cross-team contract (orchestrator sign-off — see the
   workflow's C1/C2 entries):
     · Module API names are frozen: getActiveWorkspaceSlug,
       setActive (NOT setActiveWorkspace), subscribeWorkspace,
       createWorkspace, WorkspaceProvider, useWorkspace.
     · getActiveWorkspaceSlug() is synchronous, never null, and does
       zero top-level fetch/await — safe to import eagerly before any
       provider mounts, before auth resolves, even before migration
       0115 is applied.
     · The shared client identifier is ONE lowercase-kebab slug,
       byte-identical everywhere (public.workspaces.slug === reels.
       workspace_id === backend client_id everywhere it appears).
       Validator SLUG_RE below is the canonical copy every team uses
       verbatim — nobody normalizes it differently.
     · Persistence: localStorage fast-path key
       'workflow.activeWorkspace.v1' + user_preferences upsert
       { person_id, key: 'active_workspace', value: { slug } },
       onConflict 'person_id,key' (CLAUDE.md rule 6 — NEVER
       app_settings). Hydrated in its OWN effect keyed on the auth
       person id — never inside an all-or-nothing hydrate.
     · A persisted/unknown slug that isn't in the loaded workspaces
       list resolves to 'paul', never a phantom scope.
   ========================================================= */

import React from "react";
import { supabase } from "./supabase-client.js";
import { useAuth } from "../auth.jsx";

/* Canonical slug validator — copy verbatim, never normalize (C2). */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const LS_KEY = "workflow.activeWorkspace.v1";
const PREF_KEY = "active_workspace";
const DEFAULT_SLUG = "paul";
const FALLBACK_WORKSPACES = [{ slug: DEFAULT_SLUG, name: "Paul Victor", color: null }];

const WorkspaceContext = React.createContext(null);

/* ---------- module-level singleton (for non-hook callers) ---------- */

function readLocalStorageSlug() {
  try {
    const s = window.localStorage.getItem(LS_KEY);
    if (s && SLUG_RE.test(s)) return s;
  } catch { /* no localStorage / blocked — fall through */ }
  return null;
}

function writeLocalStorageSlug(slug) {
  try { window.localStorage.setItem(LS_KEY, slug); } catch { /* noop */ }
}

let activeSlugCache = readLocalStorageSlug() || DEFAULT_SLUG;
let workspacesCache = { list: FALLBACK_WORKSPACES };
let currentPersonId = null; // set by WorkspaceProvider's hydrate effect

const slugListeners = new Set();       // subscribeWorkspace(cb)
const listReloadListeners = new Set(); // internal: provider re-fetches on create/etc.

/** Synchronous, never null. Safe at module-load time (no fetch/await). */
function getActiveWorkspaceSlug() { return activeSlugCache; }

function notifySlugListeners(slug) {
  for (const cb of slugListeners) {
    try { cb(slug); } catch (e) { console.error("workspace subscriber threw:", e); }
  }
}

function notifyListReload() {
  for (const cb of listReloadListeners) {
    try { cb(); } catch { /* noop */ }
  }
}

/* Internal: update the singleton + localStorage + notify, WITHOUT
   touching user_preferences (used for hydrate-from-pref and for the
   "unknown slug -> paul" reconciliation, neither of which should
   re-upsert the value they just read). */
function applySlugInternal(slug) {
  if (slug === activeSlugCache) return;
  activeSlugCache = slug;
  writeLocalStorageSlug(slug);
  notifySlugListeners(slug);
}

/** Canonical setter (frozen name — supersedes draft 'setActiveWorkspace').
    Updates the singleton synchronously, notifies subscribers, writes
    localStorage, then fire-and-forget upserts user_preferences.
    Silently rejects slugs failing SLUG_RE. */
function setActive(slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    console.warn(`workspace.setActive: rejected invalid slug "${slug}"`);
    return;
  }
  applySlugInternal(slug);
  if (currentPersonId) {
    supabase
      .from("user_preferences")
      .upsert(
        { person_id: currentPersonId, key: PREF_KEY, value: { slug }, updated_at: new Date().toISOString() },
        { onConflict: "person_id,key" }
      )
      .then(({ error }) => { if (error) console.warn("workspace pref persist failed:", error.message); })
      .catch((e) => console.warn("workspace pref persist failed:", e?.message || e));
  }
}

/** Returns an unsubscribe fn. Paired with getActiveWorkspaceSlug as the
    exact (subscribe, getSnapshot) pair for React.useSyncExternalStore. */
function subscribeWorkspace(cb) {
  slugListeners.add(cb);
  return () => { slugListeners.delete(cb); };
}

/** Insert a new workspace row (runtime user action — never invoked by
    build/migration agents). Validates, does NOT auto-switch to it,
    and nudges any mounted WorkspaceProvider to refresh its list. */
function createWorkspace(slug, name, color) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return Promise.reject(new Error(`Invalid workspace slug "${slug}" (expected lowercase-kebab, 2-40 chars).`));
  }
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return Promise.reject(new Error("Workspace name is required."));
  }
  const row = { slug, name: trimmedName };
  if (color) row.color = color;
  return supabase
    .from("workspaces")
    .insert(row)
    .select()
    .single()
    .then(({ data, error }) => {
      if (error) {
        const msg = error.message || "";
        if (error.code === "42P01" || /relation .*workspaces.* does not exist/i.test(msg)) {
          throw new Error("Workspaces table not found — migration 0115 must be applied first.");
        }
        if (error.code === "23505" || /duplicate key/i.test(msg)) {
          throw new Error(`Workspace "${slug}" already exists.`);
        }
        throw error;
      }
      notifyListReload();
      return data;
    });
}

/* ---------- provider ---------- */

function WorkspaceProvider({ children }) {
  const { person } = useAuth();
  const [workspaces, setWorkspaces] = React.useState(workspacesCache.list);
  const [activeSlug, setActiveSlugState] = React.useState(activeSlugCache);
  const [loaded, setLoaded] = React.useState(false);

  const apply = React.useCallback((list) => {
    workspacesCache = { list };
    setWorkspaces(list);
  }, []);

  const reload = React.useCallback(() => {
    return supabase
      .from("workspaces")
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          // Pre-0115 (or any transient failure): degrade to the seeded
          // default rather than crash boot — WorkspaceProvider must
          // never throw/suspend.
          console.warn("Workspace list load failed, defaulting to paul:", error.message);
          apply(FALLBACK_WORKSPACES);
          return;
        }
        apply(data && data.length ? data : FALLBACK_WORKSPACES);
      })
      .catch((e) => {
        console.warn("Workspace list load failed, defaulting to paul:", e?.message || e);
        apply(FALLBACK_WORKSPACES);
      });
  }, [apply]);

  // Initial load.
  React.useEffect(() => {
    let cancelled = false;
    reload().finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [reload]);

  // Let createWorkspace() (and any other module-level mutation) nudge
  // this provider to re-fetch immediately, without waiting on realtime.
  React.useEffect(() => {
    listReloadListeners.add(reload);
    return () => { listReloadListeners.delete(reload); };
  }, [reload]);

  // Realtime: a workspace another tab/user creates shows up live.
  React.useEffect(() => {
    const channel = supabase
      .channel("workspace-realtime")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "workspaces" },
          () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  // Stay in sync with the module singleton (setActive may be called
  // from non-React code, e.g. the store, or from another mounted
  // switcher instance).
  React.useEffect(() => subscribeWorkspace(setActiveSlugState), []);

  // Hydrate the persisted per-user choice — its OWN effect keyed on
  // the auth person id, never inside the all-or-nothing list load
  // above (a missing/late person id must never block workspace list
  // boot, and a missing user_preferences row must never brick it).
  const personId = person?.id || null;
  React.useEffect(() => {
    currentPersonId = personId;
    if (!personId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("value")
          .eq("person_id", personId)
          .eq("key", PREF_KEY)
          .maybeSingle();
        if (cancelled) return;
        const slug = data?.value?.slug;
        if (!error && typeof slug === "string" && SLUG_RE.test(slug)) {
          applySlugInternal(slug);
        }
      } catch (e) {
        if (!cancelled) console.warn("Workspace pref hydrate failed:", e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [personId]);

  // Reconcile: once the real list is in, a persisted/local slug that
  // doesn't exist there resolves to 'paul' — never a phantom scope.
  React.useEffect(() => {
    if (!loaded || !workspaces.length) return;
    const exists = workspaces.some((w) => w.slug === activeSlug);
    if (!exists) applySlugInternal(DEFAULT_SLUG);
  }, [loaded, workspaces, activeSlug]);

  const value = React.useMemo(() => ({
    activeSlug,
    workspaces,
    loaded,
    setActive,
    createWorkspace,
    reload,
  }), [activeSlug, workspaces, loaded, reload]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function useWorkspace() {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

export {
  WorkspaceProvider,
  useWorkspace,
  getActiveWorkspaceSlug,
  setActive,
  subscribeWorkspace,
  createWorkspace,
};
