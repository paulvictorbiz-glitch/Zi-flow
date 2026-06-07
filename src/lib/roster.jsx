/* =========================================================
   Roster — the live team directory, read from Supabase `people`.

   This replaces the old hardcoded PEOPLE / PIPELINE_LANES constants.
   The four seeded slots (paul/alex/sam/maya) AND any members the
   owner creates from the Roles & Permissions panel all flow through
   here, so a new hire shows up in lanes, pickers, and avatars without
   any code change.

   Two ways to read the roster:
     · useRoster()  — React hook for components (peopleById, peopleList,
                      canonicalPersonId).
     · getRoster() / personName() / isKnownPerson() — plain functions
       backed by a module-level cache, for non-React code that can't
       use hooks (the workflow store's reducer + persist helpers).

   `ROLES` / `STAGE_ROLE` stay static in shared-data.jsx — roles are a
   fixed set; only the people filling them are dynamic.
   ========================================================= */

import React from "react";
import { supabase } from "./supabase-client.js";

const RosterContext = React.createContext(null);

/* ---------- module-level cache (for non-hook callers) ---------- */
let rosterCache = { byId: {}, list: [] };

function buildCache(list) {
  const byId = {};
  for (const p of list) byId[p.id] = p;
  return { byId, list };
}

/** Full cache: { byId, list }. */
function getRoster() { return rosterCache; }

/** Short display name for a person id, falling back to the id itself. */
function personName(id) {
  if (!id) return id;
  const p = rosterCache.byId[id];
  return p ? (p.short || p.name || id) : id;
}

/** True if `id` is a real person in the roster (used to tell an
    explicit lane-reassign apart from the "review" workflow lane). */
function isKnownPerson(id) { return !!rosterCache.byId[id]; }

/* ---------- provider ---------- */
function RosterProvider({ children }) {
  const [people, setPeople] = React.useState(rosterCache.list);
  const [loaded, setLoaded] = React.useState(false);

  const apply = React.useCallback((list) => {
    rosterCache = buildCache(list);   // keep the non-hook cache in sync
    setPeople(list);
  }, []);

  const reload = React.useCallback(() => {
    return supabase
      .from("people")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.error("Roster load failed:", error); return; }
        apply(data || []);
      });
  }, [apply]);

  // Initial load.
  React.useEffect(() => {
    let cancelled = false;
    reload().finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [reload]);

  // Realtime: a member the owner adds/edits/removes shows up live.
  React.useEffect(() => {
    const channel = supabase
      .channel("roster-realtime")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "people" },
          () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  const value = React.useMemo(() => {
    const byId = {};
    for (const p of people) byId[p.id] = p;
    // Canonical holder for a role = earliest-created person with that
    // role. The seeded four sort first, so this returns paul/alex/sam/
    // maya — matching the static ROLES mapping used for auto-handoff.
    const canonicalByRole = {};
    for (const p of people) {
      if (p.role && !(p.role in canonicalByRole)) canonicalByRole[p.role] = p.id;
    }
    return {
      people,
      peopleList: people,
      peopleById: byId,
      loaded,
      reload,
      canonicalPersonId: (role) => canonicalByRole[role] || null,
    };
  }, [people, loaded, reload]);

  return <RosterContext.Provider value={value}>{children}</RosterContext.Provider>;
}

function useRoster() {
  const ctx = React.useContext(RosterContext);
  if (!ctx) throw new Error("useRoster must be used inside <RosterProvider>");
  return ctx;
}

export { RosterProvider, useRoster, getRoster, personName, isKnownPerson };
