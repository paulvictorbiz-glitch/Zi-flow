/* Main shell with tabs, role-aware perspective, and global Create FAB. */

import React, { useState, useEffect, useMemo } from "react";
import { DPill } from "./components/components.jsx";
import { ROLES } from "./lib/shared-data.jsx";
import { WorkflowProvider, useWorkflow } from "./store/store.jsx";
import { MyWork } from "./pages/my-work.jsx";
import { Pipeline } from "./pages/pipeline.jsx";
import { ListView } from "./pages/list-view.jsx";
import { CalendarView } from "./pages/calendar-view.jsx";
import { ReelDetail } from "./pages/detail.jsx";
import { ExportView } from "./pages/export-view.jsx";
import { FootageLibrary } from "./pages/footage-library.jsx";
import { Analytics } from "./pages/analytics.jsx";
import { CreateFab } from "./components/fab.jsx";
import { AuthProvider, AuthGate, IdentityGate, useAuth } from "./auth.jsx";
import { TimeProvider } from "./lib/time.jsx";
import { ArchivedView } from "./pages/archived-view.jsx";
import { Locations } from "./pages/locations.jsx";
import { Coverage } from "./pages/coverage.jsx";
import { IdeaGenerator } from "./pages/idea-generator.jsx";
import { Activity } from "./pages/activity.jsx";
import { LocationsProvider } from "./lib/locations-data.jsx";
import { NotificationsProvider, useNotifications } from "./components/notifications.jsx";
import { PermissionsProvider, usePermissions } from "./lib/permissions.jsx";
import { RosterProvider, useRoster } from "./lib/roster.jsx";
import { RolesAdmin } from "./pages/roles-admin.jsx";

/* Priority order for picking a safe landing tab when a role can't see the
   current view. Excludes "detail" (needs a selected reel) and "settings"
   (owner-only gear). Kept in landing-usefulness order, not tab order. */
const VIEW_ORDER = ["pipeline", "mywork", "footage", "coverage", "locations", "analytics", "export", "generate"];

/* Tab strip definition (order shown). `key` matches the `view` string and
   the permission catalog's view keys, so canView() gates each tab. Numbers
   are assigned dynamically over the *visible* set so they stay contiguous
   when a role has tabs removed. */
const TABS = [
  { key: "mywork",    label: "My work" },
  { key: "pipeline",  label: "Pipeline" },
  { key: "detail",    label: "Reel detail" },
  { key: "footage",   label: "Footage" },
  { key: "export",    label: "Export" },
  { key: "analytics", label: "Analytics" },
  { key: "locations", label: "Locations" },
  { key: "coverage",  label: "Coverage" },
  { key: "generate",  label: "Generate" },
  { key: "activity",  label: "Activity" },
];

function AppShell() {
  const { person: me, signOut } = useAuth();
  const { reels } = useWorkflow();
  const { peopleById, peopleList } = useRoster();
  const { totalUnread } = useNotifications();
  const { canView, setEffectiveRole, setEffectivePersonId } = usePermissions();
  const [view, setView]                 = useState("pipeline");
  const [pipelineMode, setPipelineMode] = useState("board");   // board | list | calendar
  const [selectedReel, setSelectedReel] = useState(null);
  const [role, setRole]                 = useState(() => me?.id ?? "paul");
  const [roleMenu, setRoleMenu]         = useState(false);

  /* "Needs you" badge — count of non-archived reels currently
     assigned to the signed-in person that still need work (any
     stage before posted). Stage transitions auto-reassign owner
     per STAGE_ROLE, so this stays accurate without manual updates. */
  const needsYouCount = useMemo(() => {
    if (!me) return 0;
    return reels.filter(r =>
      !r.archivedAt &&
      r.owner === me.id &&
      r.stage !== "posted"
    ).length;
  }, [reels, me]);

  // Re-sync the perspective default if `me` arrives after first render
  useEffect(() => { if (me) setRole(me.id); }, [me?.id]);

  /* Gating is evaluated against the active perspective. For a non-owner
     that's locked to their own role; for the owner it follows whichever
     perspective they're previewing (so they can QA a restricted view).
     `role` is now a person ID — derive the role key before passing it
     to the permissions system so tab-gating still works correctly. */
  useEffect(() => {
    const personRole = peopleById[role]?.role || role;
    setEffectiveRole(personRole);
  }, [role, setEffectiveRole, peopleById]);

  // Keep effectivePersonId in sync with the active perspective (person id)
  useEffect(() => {
    // `role` is a person ID; non-owners are always their own person.
    // For the owner, role tracks whichever person they're previewing.
    const personId = me?.role === "owner"
      ? (peopleById[role]?.id || me?.id || null)
      : (me?.id || null);
    setEffectivePersonId(personId);
  }, [role, me?.id, me?.role, peopleById, setEffectivePersonId]);

  /* Safety net: if the current tab isn't visible to the active role,
     bounce to the first allowed tab so a restricted user never lands on
     a blank screen. "settings" (owner gear) and "activity" are not
     role-gated tabs, so they're left alone. */
  useEffect(() => {
    if (view === "settings") return;
    if (!canView(view)) {
      const firstAllowed = VIEW_ORDER.find(v => canView(v));
      if (firstAllowed) setView(firstAllowed);
    }
  }, [view, canView]);

  const openReel = reel => {
    setSelectedReel(reel);
    setView("detail");
  };

  /* Expose openReel so the FAB's create-reel flow can deep-link
     straight into the new reel after dispatch. */
  useEffect(() => { window.__openReel = openReel; });

  /* Prevent Backspace from navigating the browser back when the
     user isn't typing in a field. Some browsers / embedded
     webviews still treat Backspace as "history.back" outside of
     editable elements — and accidental Backspaces on a dashboard
     would silently drop in-flight edits. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Backspace") return;
      const t = e.target;
      const tag = t?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        t?.isContentEditable;
      if (!editable) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Only the owner may switch perspectives. The avatar in the topbar shows
     the perspective the owner is currently viewing; everyone else sees just
     their own icon. */
  const isOwner = me?.role === "owner";
  const shownPerson = isOwner ? (peopleById[role] || me) : me;
  // Role key the rest of the app (MyWork, permissions) needs.
  const viewingRoleKey = shownPerson?.role || "skilled";

  /* Tabs visible to the active perspective (hidden ones are removed). */
  const visibleTabs = TABS.filter(t => canView(t.key));

  return (
    <div className="app">
      {/* Top bar */}
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>Workflow</span>
        </div>
        <div className="crumb">
          <span className="now">
            {view === "pipeline"  ? "Pipeline · " + pipelineMode :
             view === "mywork"    ? "My work" :
             view === "detail"    ? "Reel detail" :
             view === "footage"   ? "Footage library" :
             view === "coverage"  ? "Coverage" :
             view === "locations" ? "Locations" :
             view === "export"    ? "Export prep" : "Analytics"}
          </span>
          <span className="sep">/</span>
          <span>
            {view === "detail"
              ? (selectedReel ? selectedReel.id + " · " + selectedReel.title : "REEL-201 · Temple crowd sequence")
              : "Production track · live"}
          </span>
        </div>
        <div className="topbar-spacer" />

        {/* Identity / perspective. Owners can switch perspectives (dropdown);
            everyone else just sees their own icon. Clicking opens the menu. */}
        <div className={"role-switch" + (isOwner ? "" : " icon-only")}
             onClick={() => setRoleMenu(o => !o)}
             title={shownPerson?.name || me?.name || ""}>
          <span className={"avatar-chip " + (shownPerson?.role || "")}>{shownPerson?.avatar}</span>
          {isOwner && <span className="rs-caret">▾</span>}
          {roleMenu && me && (
            <div className="role-menu" onClick={e => e.stopPropagation()}>
              {isOwner && (
                <React.Fragment>
                  <div className="rm-h">Switch perspective</div>
                  {peopleList.map(p => (
                    <div key={p.id}
                         className={"rm-opt " + (p.id === role ? "active" : "")}
                         onClick={() => { setRole(p.id); setRoleMenu(false); }}>
                      <span className={"avatar-chip " + (p.role || "")}>{p.avatar}</span>
                      <div>
                        <div className="rm-name">{p.name}</div>
                        <div className="rm-role">{ROLES[p.role]?.label || p.role}</div>
                      </div>
                      {p.id === role && <span className="mono cyan">●</span>}
                    </div>
                  ))}
                </React.Fragment>
              )}
              {isOwner && (
                <div className="rm-opt"
                     style={{ borderTop: "1px dashed var(--line-hard)", marginTop: 6, paddingTop: 10 }}
                     onClick={() => { setView("settings"); setRoleMenu(false); }}>
                  <span className="avatar-chip" style={{ fontSize: 13 }}>⚙</span>
                  <div>
                    <div className="rm-name">Roles &amp; permissions</div>
                    <div className="rm-role">Edit what each role can see &amp; do</div>
                  </div>
                </div>
              )}
              <div className="rm-footer" style={{
                borderTop: isOwner ? "1px dashed var(--line-hard)" : "none",
                marginTop: isOwner ? 6 : 0,
                fontFamily: "var(--f-mono)", fontSize: 10.5,
                color: "var(--fg-mute)", display: "flex",
                justifyContent: "space-between", alignItems: "center",
                gap: 14, padding: "8px 12px",
              }}>
                <span>signed in · <b style={{ color: "var(--fg)" }}>{me.short || me.name}</b></span>
                <a href="#" style={{ color: "var(--c-cyan)" }}
                   onClick={e => { e.preventDefault(); signOut(); }}>sign out</a>
              </div>
            </div>
          )}
        </div>

        <div className="topbar-actions">
          <DPill>Search reels / blockers</DPill>
          {/* Comments bell — total unread human comments across
              every non-archived reel for the signed-in user.
              Clicking opens the My work tab so you can drill in. */}
          <DPill tone={totalUnread > 0 ? "amber" : undefined}
                 active={totalUnread > 0}
                 onClick={() => setView("mywork")}
                 title={totalUnread + " unread comment" + (totalUnread === 1 ? "" : "s")}>
            <span style={{ marginRight: 6 }}>🔔</span>
            {totalUnread > 0 ? totalUnread + " unread" : "No new comments"}
          </DPill>
        </div>
      </div>

      {/* Tab strip */}
      <div className="tabstrip">
        {visibleTabs.map((t, i) => (
          <button key={t.key}
                  className={"tab " + (view === t.key ? "is-active" : "")}
                  onClick={() => setView(t.key)}>
            <span className="n">{i + 1} ·</span> {t.label}
            {t.key === "mywork" && needsYouCount > 0 && (
              <span className="needs-badge" title={needsYouCount + " reel" + (needsYouCount === 1 ? "" : "s") + " waiting on you"}>
                {needsYouCount}
              </span>
            )}
          </button>
        ))}
        {/* Pipeline sub-mode chips — only when on Pipeline */}
        {view === "pipeline" && (
          <React.Fragment>
            <span style={{ width: 14 }} />
            <span className="mono dim" style={{ alignSelf: "center" }}>view</span>
            <DPill active={pipelineMode === "board"}    onClick={() => setPipelineMode("board")}>Board</DPill>
            <DPill active={pipelineMode === "list"}     onClick={() => setPipelineMode("list")}>List</DPill>
            <DPill active={pipelineMode === "calendar"} onClick={() => setPipelineMode("calendar")}>Calendar</DPill>
            <DPill active={pipelineMode === "archived"} onClick={() => setPipelineMode("archived")}>Archived</DPill>
          </React.Fragment>
        )}
        <span style={{ flex: 1 }} />
        <span className="mono dim" style={{ alignSelf: "center" }}>realtime · live</span>
      </div>

      {/* Body */}
      {view === "mywork"    && <MyWork    role={viewingRoleKey} personId={shownPerson?.id} onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "board"    && <Pipeline    onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "list"     && <ListView    role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "calendar" && <CalendarView role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "archived" && <ArchivedView onOpen={openReel} />}
      {view === "detail"    && <ReelDetail reel={selectedReel} onBack={() => setView("pipeline")} />}
      {view === "footage"   && <FootageLibrary onOpen={openReel} />}
      {view === "export"    && <ExportView onOpen={openReel} />}
      {view === "analytics" && <Analytics />}
      {view === "locations" && <Locations />}
      {view === "coverage"  && <Coverage />}
      {view === "generate"  && <IdeaGenerator />}
      {view === "activity"  && <Activity />}
      {view === "settings"  && isOwner && <RolesAdmin onBack={() => setView("pipeline")} />}

      {/* Global create FAB */}
      <CreateFab />
    </div>
  );
}

function App() {
  return (
    <TimeProvider>
      <AuthProvider>
        <AuthGate>
          <IdentityGate>
            <RosterProvider>
              <WorkflowProvider>
                <LocationsProvider>
                  <NotificationsProvider>
                    <PermissionsProvider>
                      <AppShell />
                    </PermissionsProvider>
                  </NotificationsProvider>
                </LocationsProvider>
              </WorkflowProvider>
            </RosterProvider>
          </IdentityGate>
        </AuthGate>
      </AuthProvider>
    </TimeProvider>
  );
}

export { App };
