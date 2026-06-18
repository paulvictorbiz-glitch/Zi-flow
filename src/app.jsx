/* Main shell with tabs, role-aware perspective, and global Create FAB. */

import React, { useState, useEffect, useMemo, useRef } from "react";
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
import { Resources } from "./pages/resources.jsx";
import { Training } from "./pages/training.jsx";
import { MODULE_BY_SKILL } from "./lib/training-curriculum.jsx";
import { VideoEditor } from "./pages/editor.jsx";
import { LocationsProvider } from "./lib/locations-data.jsx";
import { NotificationsProvider } from "./components/notifications.jsx";
import { PermissionsProvider, usePermissions } from "./lib/permissions.jsx";
import { RosterProvider, useRoster } from "./lib/roster.jsx";
import GamifyWelcomePopup from "./components/GamifyWelcomePopup.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { PreferencesModal } from "./components/PreferencesModal.jsx";
import { RolesAdmin } from "./pages/roles-admin.jsx";
import { Inbox } from "./pages/inbox.jsx";
import { TeamChat } from "./pages/team-chat.jsx";
import { LosslessCut } from "./pages/lossless.jsx";
import { MonitorHub } from "./pages/monitor-hub.jsx";
import { ReelDna } from "./pages/reel-dna.jsx";
import { extractUrl } from "./lib/reel-dna.jsx";
import { getInboxSummary } from "./lib/social-client.js";

/* External feedback form for demo testers. Create a Google Form / Tally form
   and paste its URL here (or set VITE_FEEDBACK_FORM_URL in the env). When empty,
   the demo banner still shows but without the "Leave feedback" link. */
const FEEDBACK_FORM_URL =
  import.meta.env.VITE_FEEDBACK_FORM_URL || "";

/* Priority order for picking a safe landing tab when a role can't see the
   current view. Excludes "detail" (needs a selected reel) and "settings"
   (owner-only gear). Kept in landing-usefulness order, not tab order. */
// "monitor" is the consolidated owner hub (Infra/Pulse/AI Brain sub-tabs); the
// former standalone "pulse"/"ai" views now live inside it (see monitor-hub.jsx).
const VIEW_ORDER = ["pipeline", "mywork", "footage", "editor", "lossless", "coverage", "locations", "analytics", "inbox", "team", "export", "generate", "reeldna", "training", "monitor"];

/* Tab strip definition (order shown). `key` matches the `view` string and
   the permission catalog's view keys, so canView() gates each tab. Numbers
   are assigned dynamically over the *visible* set so they stay contiguous
   when a role has tabs removed. */
const TABS = [
  { key: "mywork",    label: "My work" },
  { key: "pipeline",  label: "Pipeline" },
  { key: "footage",   label: "Footage" },
  { key: "editor",    label: "Editor" },
  { key: "lossless",  label: "Lossless" },
  { key: "export",    label: "Export" },
  { key: "analytics", label: "Analytics" },
  { key: "inbox",     label: "Inbox" },
  { key: "team",      label: "Team" },
  { key: "locations", label: "Locations" },
  { key: "coverage",  label: "Coverage" },
  { key: "generate",  label: "Generate" },
  { key: "reeldna",   label: "Reel DNA" },
  { key: "training",  label: "Training" },
  { key: "activity",  label: "Activity" },
  { key: "resources", label: "Resources" },
  { key: "monitor",   label: "Monitor" },   // consolidated hub: Infra / Pulse / AI Brain sub-tabs
];

const DEFAULT_TAB_GROUPS = [
  { key: "mywork_group",    label: "My Work",                 tone: "cyan",   tabs: ["mywork"] },
  { key: "pipeline_group",  label: "Pipeline",                tone: "amber",  tabs: ["pipeline", "generate"] },
  { key: "reeldna_group",   label: "Reel DNA",                tone: "violet", tabs: ["reeldna"] },
  { key: "training_group",  label: "Training",                tone: "violet", tabs: ["training"] },
  { key: "footage_group",   label: "Footage",                 tone: "green",  tabs: ["footage", "coverage", "editor", "lossless", "export"] },
  { key: "analytics_group", label: "Analytics & Monitoring",  tone: "blue",   tabs: ["analytics", "monitor", "pulse"] },
  { key: "ai_group",        label: "AI Brain",                tone: "pink",   tabs: ["ai"] },
  { key: "comms_group",     label: "Communications",          tone: "orange", tabs: ["inbox", "team"] },
  { key: "activity_group",  label: "Activity",                tone: "red",    tabs: ["activity"] },
  { key: "locations_group", label: "Locations",               tone: "green",  tabs: ["locations"] },
  { key: "resources_group", label: "Resources",               tone: "blue",   tabs: ["resources"] },
];

function AppShell() {
  const { person: me, signOut } = useAuth();
  const { reels } = useWorkflow();
  const { peopleById, peopleList } = useRoster();
  const { canView, setEffectiveRole, setEffectivePersonId } = usePermissions();
  /* The "monitor" view is the consolidated owner hub — it's reachable if ANY of
     its three sub-views (infra/pulse/ai) is granted. Every other view gates on
     its own catalog key. Used by the nav drawer, the bounce safety-net, and
     programmatic navigation so all three agree on hub visibility. */
  const canViewView = (v) =>
    v === "monitor"
      ? (canView("monitor") || canView("pulse") || canView("ai"))
      : canView(v);
  const [view, setView]                 = useState(() => {
    // "pulse"/"ai" are no longer standalone views — they're sub-tabs of the
    // Monitor hub. Alias any persisted value so an old wb_view doesn't dead-end.
    const v = localStorage.getItem("wb_view") || "pipeline";
    return (v === "pulse" || v === "ai") ? "monitor" : v;
  });
  const [viewStack, setViewStack]       = useState([]);
  const [pipelineMode, setPipelineMode] = useState(() => localStorage.getItem("wb_pipeline_mode") || "board");   // board | list | calendar
  const [selectedReel, setSelectedReel] = useState(null);
  const [focusModule, setFocusModule]   = useState(null);   // training skillKey to auto-expand/scroll
  const [role, setRole]                 = useState(() => me?.id ?? "paul");
  const [roleMenu, setRoleMenu]         = useState(false);
  const [prefsOpen, setPrefsOpen]       = useState(false);   // Display & accessibility modal
  const roleSwitchRef                   = useRef(null);
  const [navOpen, setNavOpen]           = useState(false);   // left slide-in drawer
  const [globalSearch, setGlobalSearch] = useState("");
  const [capturePrefill, setCapturePrefill] = useState(null);   // Reel DNA share-target/bookmarklet
  const searchRef                       = useRef(null);

  /* Close perspective dropdown on outside click */
  useEffect(() => {
    if (!roleMenu) return;
    const handler = (e) => {
      if (roleSwitchRef.current && !roleSwitchRef.current.contains(e.target)) setRoleMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [roleMenu]);

  /* Inbox unread badge — count of unreplied comments/DMs across
     connected social platforms. Cheap, synchronous read from the
     local social-client cache; refreshed when the nav opens. */
  const [inboxUnread, setInboxUnread] = useState(0);
  useEffect(() => {
    try { setInboxUnread(getInboxSummary()?.unreplied || 0); } catch { setInboxUnread(0); }
  }, [navOpen, view]);

  const [groupOrder, setGroupOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nav_group_order") || "null");
      if (!saved) return DEFAULT_TAB_GROUPS.map(g => g.key);
      // Merge in any new groups added since the user last saved their order
      const knownKeys = new Set(saved);
      const missing = DEFAULT_TAB_GROUPS.map(g => g.key).filter(k => !knownKeys.has(k));
      return [...saved, ...missing];
    } catch { return DEFAULT_TAB_GROUPS.map(g => g.key); }
  });
  const [groupsOpen, setGroupsOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nav_groups_open") || "{}"); }
    catch { return {}; }
  });
  const [dragGroupKey, setDragGroupKey] = useState(null);

  useEffect(() => { localStorage.setItem("nav_group_order", JSON.stringify(groupOrder)); }, [groupOrder]);
  useEffect(() => { localStorage.setItem("nav_groups_open", JSON.stringify(groupsOpen)); }, [groupsOpen]);

  const sortedGroups = useMemo(() => {
    const map = Object.fromEntries(DEFAULT_TAB_GROUPS.map(g => [g.key, g]));
    return groupOrder.map(k => map[k]).filter(Boolean);
  }, [groupOrder]);

  /* "Needs you" badge — reels actually waiting on the signed-in person:
     · their own pre-posted reels, EXCEPT ones sitting in review (the
       submitter can't act while the reviewer has it), plus
     · for owner/reviewer roles, every reel currently in review — that
       queue is theirs to clear. */
  const needsYouCount = useMemo(() => {
    if (!me) return 0;
    const reviewsAreMine = me.role === "owner" || me.role === "reviewer";
    return reels.filter(r => {
      if (r.archivedAt) return false;
      if (r.stage === "review") return reviewsAreMine;
      return r.owner === me.id && r.stage !== "posted";
    }).length;
  }, [reels, me]);

  /* Global search — filter reels by title, number, logline, or the shot
     plan (so a clip filename in the script finds its reel too). */
  const searchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    return reels
      .filter(r => !r.archivedAt &&
        ((r.title || "").toLowerCase().includes(q) ||
         String(r.display_number || r.id || "").toLowerCase().includes(q) ||
         (r.logline || "").toLowerCase().includes(q) ||
         (r.script || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [globalSearch, reels]);

  // Persist active tab and pipeline sub-mode across reloads
  useEffect(() => { if (view !== "detail") localStorage.setItem("wb_view", view); }, [view]);
  useEffect(() => { localStorage.setItem("wb_pipeline_mode", pipelineMode); }, [pipelineMode]);

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
    if (!canViewView(view)) {
      const firstAllowed = VIEW_ORDER.find(v => canViewView(v));
      if (firstAllowed) setView(firstAllowed);
    }
  }, [view, canView]);

  const openReel = reel => {
    setSelectedReel(reel);
    setView("detail");
  };

  /* Expose openReel so the FAB's create-reel flow can deep-link
     straight into the new reel after dispatch. __navigate lets deep
     links (e.g. a reel card's location coords) switch top-level views. */
  useEffect(() => {
    window.__openReel = openReel;
    window.__navigate = (key) => { if (canViewView(key)) goView(key); };
  });

  /* Close the nav drawer on Escape (only while it's open). */
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  /* Navigate from the drawer: push current view onto stack, switch, close drawer. */
  const goView = (key) => {
    setViewStack(prev => [...prev.slice(-19), view]);
    setView(key);
    setNavOpen(false);
  };

  const goBack = () => {
    if (viewStack.length === 0) return;
    const prev = viewStack[viewStack.length - 1];
    setViewStack(s => s.slice(0, -1));
    setView(prev);
  };

  /* Deep-link from the grading rubric (and anywhere else) into a training
     module. Validates the skillKey against the real curriculum (ignores
     unknown / bonus-pillar keys that have no module), stashes it as the
     focusModule so <Training> auto-expands + scrolls to it, then navigates
     through history. Training calls onFocusConsumed once it has scrolled,
     which clears the state — so re-clicking the SAME pillar later sets it
     again (null → skillKey is a fresh change) and re-triggers the scroll. */
  const openTrainingModule = (skillKey) => {
    if (!skillKey || !MODULE_BY_SKILL[skillKey]) return;
    setFocusModule(skillKey);
    goView("training");
  };

  /* Reel DNA capture deep-link. The PWA share-target (manifest action
     /?capture=1) and the bookmarklet both land here with the reel URL in
     ?url= (or ?text=). Switch to the Reel DNA tab, prefill the form, then
     strip the query so a refresh doesn't re-trigger. Runs once on mount. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Fires for the bookmarklet (?capture=1) AND a native PWA share, which
    // appends ?url=/?text= per the manifest share_target but no `capture` flag.
    const isCapture = params.get("capture") != null;
    const shared = params.get("url") || params.get("text");
    if (!isCapture && !shared) return;
    const url = extractUrl(params.get("url"), params.get("text"), params.get("title"));
    if (!url) return;
    setCapturePrefill({ url, nonce: Date.now() });
    setView("reeldna");
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", clean);
  }, []);

  /* Reel deep-link. A Rocket.Chat "open reel" link (/?reel=REEL-301) lands
     here — open that reel's detail card directly. Reels load async from the
     store, so we wait until they're present, fire once, then strip the query
     so a refresh doesn't re-open it. */
  const reelDeepLinkDone = useRef(false);
  useEffect(() => {
    if (reelDeepLinkDone.current) return;
    const wantId = new URLSearchParams(window.location.search).get("reel");
    if (!wantId) { reelDeepLinkDone.current = true; return; }
    if (!reels || reels.length === 0) return; // wait for the store to hydrate
    const match = reels.find(r => String(r.id).toLowerCase() === wantId.toLowerCase());
    reelDeepLinkDone.current = true;
    if (match) openReel(match);
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", clean);
  }, [reels]);

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

  return (
    <div className="app">
      {/* Top bar */}
      <div className="topbar">
        {/* Menu trigger — opens the left slide-in nav drawer. */}
        <button
          className={"nav-toggle" + (navOpen ? " is-open" : "")}
          aria-label="Open navigation menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(o => !o)}
        >
          <span className="nav-toggle-bars" aria-hidden="true">
            <span /><span /><span />
          </span>
          <span className="nav-toggle-label">Menu</span>
          {(needsYouCount > 0 || inboxUnread > 0) && <span className="nav-toggle-dot" />}
        </button>
        {viewStack.length > 0 && (
          <button
            onClick={goBack}
            aria-label="Go back"
            style={{
              background: "none",
              border: "none",
              color: "var(--fg-dim)",
              cursor: "pointer",
              fontSize: 18,
              padding: "0 8px",
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Back"
          >‹</button>
        )}
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
             view === "export"    ? "Export prep" :
             view === "monitor"   ? "Monitor" : "Analytics"}
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
        <div ref={roleSwitchRef}
             className={"role-switch" + (isOwner ? "" : " icon-only")}
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
              {isOwner && (
                <div className="rm-opt"
                     onClick={() => { setPrefsOpen(true); setRoleMenu(false); }}>
                  <span className="avatar-chip" style={{ fontSize: 13 }}>🅰</span>
                  <div>
                    <div className="rm-name">Display &amp; accessibility</div>
                    <div className="rm-role">Comfortable mode · text size · font (test)</div>
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
          {/* Global reel search */}
          <div style={{ position: "relative" }} ref={searchRef}>
            <input
              type="text"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setGlobalSearch(""); }}
              placeholder="Search reels…"
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--line-hard)",
                borderRadius: 4,
                color: "var(--fg)",
                fontFamily: "var(--f-mono)",
                fontSize: 12,
                padding: "5px 10px",
                width: 180,
                outline: "none",
              }}
            />
            {searchResults.length > 0 && (
              <ul style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                margin: 0,
                padding: "4px 0",
                listStyle: "none",
                background: "#1a2335",
                border: "1px solid #2a3754",
                borderRadius: 4,
                zIndex: 9999,
                boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
              }}>
                {searchResults.map(reel => (
                  <li key={reel.id}
                      onClick={() => { setGlobalSearch(""); openReel(reel); }}
                      style={{
                        padding: "7px 12px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "var(--f-mono)",
                        color: "#d8e2ee",
                        borderBottom: "1px solid #1f2a3d",
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#243048"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <span style={{ color: "var(--fg-dim)", flexShrink: 0 }}>
                      {reel.display_number ? "#" + reel.display_number : reel.id}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {reel.title || "(untitled)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Left slide-in navigation drawer + backdrop */}
      <div
        className={"nav-backdrop" + (navOpen ? " is-open" : "")}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <nav
        className={"nav-drawer" + (navOpen ? " is-open" : "")}
        role="navigation"
        aria-label="Primary"
        aria-hidden={!navOpen}
      >
        <div className="nav-drawer-head">
          <span className="nav-drawer-title">Navigate</span>
          <button className="nav-drawer-close" aria-label="Close navigation menu"
                  onClick={() => setNavOpen(false)}>✕</button>
        </div>
        <div className="nav-drawer-list">
          {sortedGroups.map((group) => {
            const groupTabs = group.tabs
              .map(k => TABS.find(t => t.key === k))
              .filter(t => t && canViewView(t.key));
            if (groupTabs.length === 0) return null;

            const isSingle = groupTabs.length === 1;
            const isOpen = isSingle || groupsOpen[group.key] !== false;
            const isActive = groupTabs.some(t => t.key === view);

            const toggleGroup = () => {
              if (isSingle) return;
              setGroupsOpen(prev => ({ ...prev, [group.key]: !isOpen }));
            };

            return (
              <div
                key={group.key}
                draggable
                onDragStart={() => setDragGroupKey(group.key)}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={() => {
                  if (!dragGroupKey || dragGroupKey === group.key) return;
                  setGroupOrder(prev => {
                    const arr = [...prev];
                    const fromIdx = arr.indexOf(dragGroupKey);
                    const toIdx = arr.indexOf(group.key);
                    if (fromIdx < 0 || toIdx < 0) return prev;
                    arr.splice(fromIdx, 1);
                    arr.splice(toIdx, 0, dragGroupKey);
                    return arr;
                  });
                  setDragGroupKey(null);
                }}
                onDragEnd={() => setDragGroupKey(null)}
                style={{ marginBottom: isSingle ? 0 : 2 }}
              >
                {!isSingle && (
                  <button
                    className={"nav-group-header" + (isActive ? " is-active" : "")}
                    data-tone={group.tone || "cyan"}
                    onClick={toggleGroup}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", background: "none",
                      fontFamily: "var(--f-mono)", fontSize: 10.5,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      padding: "8px 14px 4px",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ opacity: 0.4, fontSize: 11, cursor: "grab" }}>⠿</span>
                    <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                    <span style={{ opacity: 0.5, fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>
                  </button>
                )}
                {(isSingle || isOpen) && groupTabs.map((t) => (
                  <button key={t.key}
                          className={"nav-item " + (view === t.key ? "is-active" : "")}
                          onClick={() => goView(t.key)}
                          style={isSingle ? {} : { paddingLeft: 28 }}
                          aria-current={view === t.key ? "page" : undefined}>
                    <span className="nav-item-label">{t.label}</span>
                    {t.key === "mywork" && needsYouCount > 0 && (
                      <span className="needs-badge">{needsYouCount}</span>
                    )}
                    {t.key === "inbox" && inboxUnread > 0 && (
                      <span className="needs-badge">{inboxUnread}</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="nav-drawer-foot">
          <span className="nav-live"><span className="nav-live-dot" />realtime · live</span>
        </div>
      </nav>

      {/* Demo-account banner — shown only to the shared testuser feedback
          account. Links to the external feedback form. Reassures testers that
          their changes are sandboxed (per-session, never saved). */}
      {me?.role === "demo" && (
        <div className="demo-banner">
          <span className="demo-banner-tag">DEMO</span>
          <span className="demo-banner-text">
            You're in a sandbox — explore freely, nothing you change is saved and
            it resets each visit.
          </span>
          {FEEDBACK_FORM_URL && (
            <a className="demo-banner-cta" href={FEEDBACK_FORM_URL}
               target="_blank" rel="noopener noreferrer">
              Leave feedback →
            </a>
          )}
        </div>
      )}

      {/* Pipeline sub-mode bar — thin row under the topbar, only on Pipeline.
          The main tab nav now lives in the slide-in drawer. */}
      {view === "pipeline" && (
        <div className="submode-bar">
          <span className="mono dim" style={{ alignSelf: "center" }}>view</span>
          <DPill active={pipelineMode === "board"}    onClick={() => setPipelineMode("board")}>Board</DPill>
          <DPill active={pipelineMode === "list"}     onClick={() => setPipelineMode("list")}>List</DPill>
          <DPill active={pipelineMode === "calendar"} onClick={() => setPipelineMode("calendar")}>Calendar</DPill>
          <DPill active={pipelineMode === "archived"} onClick={() => setPipelineMode("archived")}>Archived</DPill>
          <span style={{ flex: 1 }} />
          <span className="mono dim" style={{ alignSelf: "center" }}>realtime · live</span>
        </div>
      )}

      {/* Body */}
      {view === "mywork"    && <MyWork    role={viewingRoleKey} personId={shownPerson?.id} onOpen={openReel} onNavigate={goView} onSetPerson={setRole} />}
      {view === "pipeline"  && pipelineMode === "board"    && <Pipeline    onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "list"     && <ListView    role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "calendar" && <CalendarView role="all" onOpen={openReel} />}
      {view === "pipeline"  && pipelineMode === "archived" && <ArchivedView onOpen={openReel} />}
      {view === "detail"    && <ReelDetail reel={selectedReel} onBack={goBack} onLearnSkill={openTrainingModule} />}
      {view === "footage"   && <FootageLibrary onOpen={openReel} />}
      {view === "editor"    && <VideoEditor reel={selectedReel} onOpen={openReel} />}
      {view === "lossless"  && <LosslessCut reel={selectedReel} onOpen={openReel} />}
      {view === "export"    && <ExportView onOpen={openReel} />}
      {view === "analytics" && <Analytics />}
      {view === "inbox"     && <Inbox />}

      {view === "locations" && <Locations />}
      {view === "coverage"  && <Coverage />}
      {view === "generate"  && <IdeaGenerator />}
      {view === "reeldna"   && <ReelDna prefill={capturePrefill} />}
      {view === "training"  && <Training onOpen={openReel} personId={shownPerson?.id} focusModule={focusModule} onFocusConsumed={() => setFocusModule(null)} />}
      {view === "activity"  && <Activity />}
      {view === "resources" && <Resources />}
      {view === "monitor"   && isOwner && <MonitorHub canView={canView} />}
      {view === "settings"  && isOwner && <RolesAdmin onBack={goBack} />}

      {/* Always-mounted — CSS-hidden when inactive so iframe keeps its WS connection */}
      <TeamChat active={view === "team"} />

      {/* Global create FAB */}
      <CreateFab />

      {/* Display & accessibility preferences (owner-only entry) */}
      {prefsOpen && <PreferencesModal onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: "40px 32px", fontFamily: "var(--f-mono)", color: "var(--fg)" }}>
        <h2 style={{ color: "var(--c-red)", marginBottom: 12 }}>Something went wrong</h2>
        <p style={{ color: "var(--fg-dim)", marginBottom: 20 }}>{this.state.error.message}</p>
        <button
          onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          style={{ padding: "6px 14px", border: "1px solid var(--line-hard)", borderRadius: 4, background: "var(--bg-2)", color: "var(--fg)", cursor: "pointer" }}
        >
          Reload dashboard
        </button>
      </div>
    );
  }
}

/* Public landing page — heavy 3D bundle, so load it lazily and keep it
   entirely outside the AuthGate. */
const Landing = React.lazy(() =>
  import("./pages/landing.jsx").then(m => ({ default: m.Landing }))
);

/* Owner-only 3D "Space" alternate homepage (/space). Lazy-loaded so the
   three.js/cube bundle never ships with the normal app. Rendered INSIDE
   the authed provider tree below so it has live store + locations; its
   own owner gate bounces non-owners to /app. */
const Space3D = React.lazy(() =>
  import("./pages/space3d.jsx").then(m => ({ default: m.Space3D }))
);

function App() {
  // Root path "/" is the fully public landing page (no auth). Anything else
  // (e.g. "/app") renders the existing authed tree exactly as before.
  const isLanding = window.location.pathname === "/";
  // "/space" swaps AppShell for the 3D cube inside the same authed tree.
  const isSpace = window.location.pathname === "/space";

  if (isLanding) {
    const onEnterApp = () => window.location.assign("/app");
    return (
      <AppErrorBoundary>
        <React.Suspense
          fallback={
            <div style={{ minHeight: "100vh", background: "#06070d" }} />
          }
        >
          <Landing onEnterApp={onEnterApp} />
        </React.Suspense>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <TimeProvider>
        <AuthProvider>
          <AuthGate>
            <IdentityGate>
              <RosterProvider>
                <WorkflowProvider>
                  <LocationsProvider>
                    <NotificationsProvider>
                      <PermissionsProvider>
                        {isSpace ? (
                          <React.Suspense
                            fallback={<div style={{ minHeight: "100vh", background: "#05070d" }} />}
                          >
                            <Space3D />
                          </React.Suspense>
                        ) : (
                          <ThemeProvider>
                            <AppShell />
                            <GamifyWelcomePopup />
                          </ThemeProvider>
                        )}
                      </PermissionsProvider>
                    </NotificationsProvider>
                  </LocationsProvider>
                </WorkflowProvider>
              </RosterProvider>
            </IdentityGate>
          </AuthGate>
        </AuthProvider>
      </TimeProvider>
    </AppErrorBoundary>
  );
}

export { App };
