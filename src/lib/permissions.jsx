/* =========================================================
   Permissions provider — the runtime that the Owner-only admin page
   writes to and the rest of the app reads from.

   Exposes:
     · canView(viewKey, roleOverride?)  → boolean (tab visible?)
     · can(actionKey, roleOverride?)    → boolean (action allowed?)
     · config                           → current per-role config
     · setCap / resetRole / resetAll    → admin mutations (in-memory)
     · save()                           → persist to Supabase + localStorage
     · dirty, savedAt, loaded
     · effectiveRole / setEffectiveRole → the role gating is evaluated
                                          against (the active perspective)

   GATING MODEL
   ------------
   Gating is evaluated against the *effective role* — the perspective
   currently shown in the topbar. For a non-owner that is always their
   own role (they can't switch). For the owner it is whatever perspective
   they've selected, so previewing "variant" shows the variant's
   restricted view (handy for QA). The `owner` perspective is always full
   access. Admin-page access keys off the user's REAL role, not the
   perspective, so the owner can always get back to settings.

   PERSISTENCE
   -----------
   Loads from localStorage immediately (synchronous, zero-flicker), then
   fetches from Supabase `app_settings` once an auth session exists. The
   Supabase copy is the source of truth — it propagates to all users (Jay,
   Alex, etc.). Save() writes to both so the local copy stays warm.

   FAIL-OPEN: if the stored config is missing/corrupt, we fall back to
   defaults (which mirror today's behavior) so nobody is ever locked out.
   ========================================================= */

import React from "react";
import { defaultConfig, defaultPermsForRole, EDITABLE_ROLES, DEMO_VIEWS, DEMO_ACTIONS } from "./permissions-catalog.js";
import { supabase } from "./supabase-client.js";
import { useAuth } from "../auth.jsx";

/* ---------------------------------------------------------------
   Real-role helpers — the single front-end source of truth for
   "is this the OWNER (or a reviewer)".

   IMPORTANT: these read the SIGNED-IN user's REAL role, NOT the
   perspective the owner may be previewing. Perspective-driven
   tab/action gating is canView()/can() (effectiveRole); these are
   for owner-only affordances (settings, owner UI) that must stay
   true even while the owner previews a restricted role.
   --------------------------------------------------------------- */
function isOwnerRole(person) {
  return person?.role === "owner";
}

/* The review queue belongs to the owner AND reviewers — used so the
   "Needs you" badge and the My Work review list agree by construction. */
function ownsReviewQueue(person) {
  return person?.role === "owner" || person?.role === "reviewer";
}

/* Hook form of isOwnerRole, reading the live auth person. */
function useIsOwner() {
  const { person } = useAuth();
  return isOwnerRole(person);
}

const PermissionsContext = React.createContext(null);

const STORAGE_KEY = "fb_role_permissions_v1";
const SETTINGS_KEY = "role_permissions";

/* Merge a loaded config over defaults so newly-added capability keys
   (added in code after a config was saved) default to allowed rather
   than undefined.

   Role entries (skilled/variant/reviewer) are merged against fresh
   defaults so new cap keys always fall-open. Person-level entries
   (UUID or named IDs like "testerboy") are passed through as-is —
   they hold explicit overrides set by the owner and must not be
   wiped by this function. */
function withDefaults(loaded) {
  const base = defaultConfig();
  if (!loaded || typeof loaded !== "object") return base;
  const roleKeys = new Set(EDITABLE_ROLES.map(r => r.key));
  const out = {};
  // Merge role entries against fresh defaults
  for (const r of EDITABLE_ROLES) {
    const def = defaultPermsForRole(r.key);
    const got = loaded[r.key] || {};
    out[r.key] = {
      views:   { ...def.views,   ...(got.views   || {}) },
      actions: { ...def.actions, ...(got.actions || {}) },
    };
  }
  // Pass through person-level entries unchanged
  for (const key of Object.keys(loaded)) {
    if (!roleKeys.has(key)) {
      out[key] = loaded[key];
    }
  }
  return out;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return withDefaults(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveLocal(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore storage errors */ }
}

async function loadRemote() {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data) return null;
    return withDefaults(data.value);
  } catch {
    return null;
  }
}

async function saveRemote(cfg) {
  try {
    await supabase
      .from("app_settings")
      .upsert({ key: SETTINGS_KEY, value: cfg, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error("Failed to save permissions to Supabase:", e);
  }
}

function PermissionsProvider({ children }) {
  const { person: signedInPerson } = useAuth();
  const [config, setConfig] = React.useState(() => loadLocal() || defaultConfig());
  const [savedConfig, setSavedConfig] = React.useState(config);
  const [savedAt, setSavedAt] = React.useState(null);
  const [loaded] = React.useState(true); // localStorage is sync; Supabase updates silently
  const [effectiveRole, setEffectiveRole] = React.useState("owner");
  const [effectivePersonId, setEffectivePersonId] = React.useState(null);

  // Fetch from Supabase once auth session is available; re-fetch on sign-in.
  React.useEffect(() => {
    const syncFromRemote = async () => {
      const remote = await loadRemote();
      if (remote) {
        setConfig(remote);
        setSavedConfig(remote);
        saveLocal(remote);
      }
    };

    // Try immediately (works if already signed in)
    syncFromRemote();

    // Also re-sync on sign-in so Jay gets fresh settings after auth
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") syncFromRemote();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const canView = React.useCallback((viewKey, roleOverride) => {
    const r = roleOverride || effectiveRole;
    if (r === "owner") return true;
    // Demo account: fail-CLOSED against an explicit allowlist (cannot be
    // loosened by the stored config). See DEMO_VIEWS in permissions-catalog.
    if (r === "demo") return DEMO_VIEWS.has(viewKey);
    // Person-level override takes precedence over role-level
    if (effectivePersonId && config[effectivePersonId]?.views?.[viewKey] !== undefined) {
      return !!config[effectivePersonId].views[viewKey];
    }
    const v = config[r]?.views?.[viewKey];
    return v === undefined ? true : !!v; // fail-open
  }, [config, effectiveRole, effectivePersonId, signedInPerson]);

  const can = React.useCallback((actionKey, roleOverride) => {
    const r = roleOverride || effectiveRole;
    if (r === "owner") return true;
    // Demo account: fail-CLOSED against an explicit allowlist. Demo writes
    // never persist (per-session sandbox) but we still hide owner-only/
    // destructive affordances. See DEMO_ACTIONS in permissions-catalog.
    if (r === "demo") return DEMO_ACTIONS.has(actionKey);
    // Person-level override takes precedence over role-level
    if (effectivePersonId && config[effectivePersonId]?.actions?.[actionKey] !== undefined) {
      return !!config[effectivePersonId].actions[actionKey];
    }
    const a = config[r]?.actions?.[actionKey];
    return a === undefined ? true : !!a; // fail-open
  }, [config, effectiveRole, effectivePersonId, signedInPerson]);

  /* ----- admin mutations (in-memory until save()) ----- */
  const setCap = React.useCallback((roleKey, kind, capKey, allowed) => {
    setConfig(prev => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        [kind]: { ...prev[roleKey]?.[kind], [capKey]: allowed },
      },
    }));
  }, []);

  /* Seed a person-level config entry the first time the owner clicks a
     toggle for a person who doesn't yet have one. Copies their role
     defaults so the initial state is "same as role" rather than blank. */
  const ensurePersonConfig = React.useCallback((personId, roleKey) => {
    setConfig(prev => {
      if (prev[personId]) return prev;
      const roleDefaults = prev[roleKey] || defaultPermsForRole(roleKey);
      return {
        ...prev,
        [personId]: {
          views:   { ...roleDefaults.views },
          actions: { ...roleDefaults.actions },
        },
      };
    });
  }, []);

  const resetRole = React.useCallback((roleKey) => {
    setConfig(prev => ({ ...prev, [roleKey]: defaultPermsForRole(roleKey) }));
  }, []);

  const resetAll = React.useCallback(() => setConfig(defaultConfig()), []);

  const save = React.useCallback(async () => {
    saveLocal(config);
    await saveRemote(config);
    setSavedConfig(config);
    setSavedAt(new Date());
    return true;
  }, [config]);

  const dirty = React.useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig]
  );

  const value = React.useMemo(() => ({
    config, canView, can,
    setCap, resetRole, resetAll, save,
    dirty, savedAt, loaded,
    effectiveRole, setEffectiveRole,
    effectivePersonId, setEffectivePersonId,
    ensurePersonConfig,
  }), [config, canView, can, setCap, resetRole, resetAll, save, dirty, savedAt, loaded, effectiveRole, effectivePersonId, ensurePersonConfig]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

function usePermissions() {
  const ctx = React.useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used inside <PermissionsProvider>");
  return ctx;
}

export { PermissionsProvider, usePermissions, useIsOwner, isOwnerRole, ownsReviewQueue };
