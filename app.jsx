/* Main shell with tabs, role-aware perspective, and global Create FAB. */

import React, { useState, useEffect } from "react";
import { DPill } from "./components.jsx";
import { PEOPLE, ROLES } from "./shared-data.jsx";
import { WorkflowProvider } from "./store.jsx";
import { MyWork } from "./my-work.jsx";
import { Pipeline } from "./pipeline.jsx";
import { ListView } from "./list-view.jsx";
import { CalendarView } from "./calendar-view.jsx";
import { ReelDetail } from "./detail.jsx";
import { ExportView } from "./export-view.jsx";
import { Analytics } from "./analytics.jsx";
import { CreateFab } from "./fab.jsx";
import { AuthProvider, AuthGate, IdentityGate, useAuth } from "./auth.jsx";
import { TimeProvider } from "./time.jsx";
import { ArchivedView } from "./archived-view.jsx";

/* Map the four person.role values onto the three role-switcher
   keys. `reviewer` (Maya) has no dedicated dashboard yet, so she
   defaults to viewing the skilled editor's surface. */
function defaultRoleKey(person) {
  if (!person) return "skilled";
  if (person.role === "owner")   return "owner";
  if (person.role === "variant") return "variant";
  return "skilled";
}

function AppShell() {
  const { person: me, signOut } = useAuth();
  const [view, setView]                 = useState("pipeline");
  const [pipelineMode, setPipelineMode] = useState("board");   // board | list | calendar
  const [selectedReel, setSelectedReel] = useState(null);
  const [role, setRole]                 = useState(() => defaultRoleKey(me));
  const [roleMenu, setRoleMenu]         = useState(false);

  // Re-sync the perspective default if `me` arrives after first render
  useEffect(() => { if (me) setRole(defaultRoleKey(me)); }, [me?.id]);

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

  const person = PEOPLE[ROLES[role]?.person];

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

        {/* Role perspective switcher */}
        <div className="role-switch" onClick={() => setRoleMenu(o => !o)}>
          <span className={"avatar-chip " + (person?.role || "")}>{person?.avatar}</span>
          <div className="rs-body">
            <div className="rs-label">{person?.short}</div>
            <div className="rs-role">{ROLES[role]?.label}</div>
          </div>
          <span className="rs-caret">▾</span>
          {roleMenu && (
            <div className="role-menu" onClick={e => e.stopPropagation()}>
              <div className="rm-h">Switch perspective</div>
              {Object.entries(ROLES).map(([k, v]) => {
                const p = PEOPLE[v.person];
                return (
                  <div key={k}
                       className={"rm-opt " + (k === role ? "active" : "")}
                       onClick={() => { setRole(k); setRoleMenu(false); }}>
                    <span className={"avatar-chip " + p.role}>{p.avatar}</span>
                    <div>
                      <div className="rm-name">{p.name}</div>
                      <div className="rm-role">{v.label}</div>
                    </div>
                    {k === role && <span className="mono cyan">●</span>}
                  </div>
                );
              })}
              {me && (
                <div className="rm-footer" style={{
                  borderTop: "1px dashed var(--line-hard)",
                  marginTop: 6, paddingTop: 8,
                  fontFamily: "var(--f-mono)", fontSize: 10.5,
                  color: "var(--fg-mute)", display: "flex",
                  justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px",
                }}>
                  <span>signed in · <b style={{ color: "var(--fg)" }}>{me.short || me.name}</b></span>
                  <a href="#" style={{ color: "var(--c-cyan)" }}
                     onClick={e => { e.preventDefault(); signOut(); }}>sign out</a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="topbar-actions">
          <DPill>Search reels / blockers</DPill>
          <DPill tone="amber" active>Triage queue 4</DPill>
        </div>
      </div>

      {/* Tab strip */}
      <div className="tabstrip">
        <button className={"tab " + (view === "mywork" ? "is-active" : "")} onClick={() => setView("mywork")}>
          <span className="n">1 ·</span> My work
        </button>
        <button className={"tab " + (view === "pipeline" ? "is-active" : "")} onClick={() => setView("pipeline")}>
          <span className="n">2 ·</span> Pipeline
        </button>
        <button className={"tab " + (view === "detail" ? "is-active" : "")} onClick={() => setView("detail")}>
          <span className="n">3 ·</span> Reel detail
        </button>
        <button className={"tab " + (view === "export" ? "is-active" : "")} onClick={() => setView("export")}>
          <span className="n">4 ·</span> Export
        </button>
        <button className={"tab " + (view === "analytics" ? "is-active" : "")} onClick={() => setView("analytics")}>
          <span className="n">5 ·</span> Analytics
        </button>

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
      {view === "mywork"    && <MyWork    role={role} onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "board"    && <Pipeline    onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "list"     && <ListView    role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "calendar" && <CalendarView role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "archived" && <ArchivedView onOpen={openReel} />}
      {view === "detail"    && <ReelDetail reel={selectedReel} onBack={() => setView("pipeline")} />}
      {view === "export"    && <ExportView onOpen={openReel} />}
      {view === "analytics" && <Analytics />}

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
            <WorkflowProvider>
              <AppShell />
            </WorkflowProvider>
          </IdentityGate>
        </AuthGate>
      </AuthProvider>
    </TimeProvider>
  );
}

export { App };
