/* Main shell with tabs, role-aware perspective, and global Create FAB. */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { DPill } from "./components/components.jsx";
import { ROLES } from "./lib/shared-data.jsx";
import { WorkflowProvider, useWorkflow } from "./store/store.jsx";

/* ── OpenCut-AI embedded editor (Phase 1) ────────────────────────────
   Additive feature flag for the iframe-backed editor mode. DEFAULT OFF →
   the native in-app multi-track editor renders exactly as today. When ON,
   the editor area embeds the self-hosted OpenCut editor at EDITOR_ORIGIN
   and authenticates it via postMessage SSO (no JWT in the URL). Flip to
   true only after editor.footagebrain.com is stood up and framed-allowed. */
/* LOCALHOST DEMO (Phase 2 collab): on localhost ONLY, auto-embed the locally-running
   OpenCut fork dev server (:3000). Production hostnames stay OFF and point at the real
   editor origin — so this is SAFE to leave in / commit (prod is inert until the real
   Phase-1 cutover). For the prod cutover, set EDITOR_EMBED_ENABLED = true unconditionally
   per docs/opencut-phase1-deploy.md step 7 once editor.footagebrain.com is live. */
const __isLocalhost =
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
/* PROD CUTOVER (2026-06-24): editor.footagebrain.com is stood up on Hetzner
   (SSO config baked into the bundle, LE cert live, frame-ancestors allows the
   dashboard), so the embed is now ON everywhere. Localhost still points at the
   local fork dev server (:3000); prod points at the live editor origin. Roll
   back by setting this back to `__isLocalhost` and redeploying. */
const EDITOR_EMBED_ENABLED = true;
const EDITOR_ORIGIN = __isLocalhost ? "http://localhost:3000" : "https://editor.footagebrain.com";
/* ---- EAGER core pages (primary flow — never code-split so it never
   flashes a Suspense fallback). ---- */
import { MyWork } from "./pages/my-work.jsx";
import { Pipeline } from "./pages/pipeline.jsx";
import { ReelDetail } from "./pages/detail.jsx";
import { FootageLibrary } from "./pages/footage-library.jsx";
import { ReelDna } from "./pages/reel-dna.jsx";
/* ---- LAZY peripheral pages (code-split — each loads on first open, or is
   warmed on idle when the owner enables the "Prefetch heavy tabs" pref).
   These pages all use NAMED exports, so we map the named export to `default`
   (React.lazy requires a module with a default export). The import() factories
   are hoisted to module scope (LAZY_IMPORTERS) so B3 prefetch reuses the exact
   same chunk factories — no duplicate chunks. ---- */
const importMonitorHub   = () => import("./pages/monitor-hub.jsx");
const importMusicLibrary = () => import("./pages/music-library.jsx");
const importAnalytics    = () => import("./pages/analytics.jsx");
const importInbox        = () => import("./pages/inbox.jsx");
const importTraining     = () => import("./pages/training.jsx");
const importVideoEditor  = () => import("./pages/editor.jsx");
const importEditorProjects = () => import("./pages/editor-projects.jsx");
const importLosslessCut  = () => import("./pages/lossless.jsx");
const importIdeaGenerator= () => import("./pages/idea-generator.jsx");
const importLocations    = () => import("./pages/locations.jsx");
const importCoverage     = () => import("./pages/coverage.jsx");
const importResources    = () => import("./pages/resources.jsx");
const importActivity     = () => import("./pages/activity.jsx");
const importRolesAdmin   = () => import("./pages/roles-admin.jsx");
const importExportView   = () => import("./pages/export-view.jsx");
const importArchivedView = () => import("./pages/archived-view.jsx");
const importCalendarView = () => import("./pages/calendar-view.jsx");
const importListView     = () => import("./pages/list-view.jsx");
const importTeamChat     = () => import("./pages/team-chat.jsx");
// Used by B3 prefetch: warm every heavy chunk on idle. Same factories as below.
const LAZY_IMPORTERS = [
  importMonitorHub, importMusicLibrary, importAnalytics, importInbox, importTraining,
  importVideoEditor, importEditorProjects, importLosslessCut, importIdeaGenerator, importLocations,
  importCoverage, importResources, importActivity, importRolesAdmin,
  importExportView, importArchivedView, importCalendarView, importListView,
  importTeamChat,
];
const MonitorHub   = React.lazy(() => importMonitorHub().then((m)   => ({ default: m.MonitorHub })));
const MusicLibrary = React.lazy(() => importMusicLibrary().then((m) => ({ default: m.MusicLibrary })));
const Analytics    = React.lazy(() => importAnalytics().then((m)    => ({ default: m.Analytics })));
const Inbox        = React.lazy(() => importInbox().then((m)        => ({ default: m.Inbox })));
const Training     = React.lazy(() => importTraining().then((m)     => ({ default: m.Training })));
const VideoEditor  = React.lazy(() => importVideoEditor().then((m)  => ({ default: m.VideoEditor })));
const EditorProjects = React.lazy(() => importEditorProjects().then((m) => ({ default: m.EditorProjects })));
const LosslessCut  = React.lazy(() => importLosslessCut().then((m)  => ({ default: m.LosslessCut })));
const IdeaGenerator= React.lazy(() => importIdeaGenerator().then((m)=> ({ default: m.IdeaGenerator })));
const Locations    = React.lazy(() => importLocations().then((m)    => ({ default: m.Locations })));
const Coverage     = React.lazy(() => importCoverage().then((m)     => ({ default: m.Coverage })));
const Resources    = React.lazy(() => importResources().then((m)    => ({ default: m.Resources })));
const Activity     = React.lazy(() => importActivity().then((m)     => ({ default: m.Activity })));
const RolesAdmin   = React.lazy(() => importRolesAdmin().then((m)   => ({ default: m.RolesAdmin })));
const ExportView   = React.lazy(() => importExportView().then((m)   => ({ default: m.ExportView })));
const ArchivedView = React.lazy(() => importArchivedView().then((m) => ({ default: m.ArchivedView })));
const CalendarView = React.lazy(() => importCalendarView().then((m) => ({ default: m.CalendarView })));
const ListView     = React.lazy(() => importListView().then((m)     => ({ default: m.ListView })));
const TeamChat     = React.lazy(() => importTeamChat().then((m)     => ({ default: m.TeamChat })));
import { CreateFab } from "./components/fab.jsx";
import { AuthProvider, AuthGate, IdentityGate, useAuth } from "./auth.jsx";
import { TimeProvider } from "./lib/time.jsx";
import { MODULE_BY_SKILL } from "./lib/training-curriculum.jsx";
import { LocationsProvider } from "./lib/locations-data.jsx";
import { NotificationsProvider } from "./components/notifications.jsx";
import { TeamChatAlertsProvider, useTeamChatAlerts } from "./lib/team-chat-alerts.jsx";
import { TeamChatToast } from "./components/team-chat-toast.jsx";
import { PermissionsProvider, usePermissions, useIsOwner, ownsReviewQueue } from "./lib/permissions.jsx";
import { RosterProvider, useRoster } from "./lib/roster.jsx";
import GamifyWelcomePopup from "./components/GamifyWelcomePopup.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { PreferencesModal } from "./components/PreferencesModal.jsx";
import { extractUrl } from "./lib/reel-dna.jsx";
import { getInboxSummary } from "./lib/social-client.js";

/* Lightweight fallback shown while a code-split (lazy) page chunk loads. Mirrors
   the app's existing "loading…" idiom (mono dim text) — intentionally minimal so
   it never blocks paint and matches the store's "loading workflow…" treatment. */
function ViewFallback() {
  /* A clearly-visible centered loader (NAV-003). The old faint "loading…" text
     read as a blank flash during chunk loads; a centered spinner makes the
     lazy-load state obvious. Keyframe is inlined so it doesn't touch styles.css. */
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14, padding: "72px 24px", minHeight: 240,
    }}>
      <style>{"@keyframes vf-spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        border: "3px solid var(--line-hard, #333)",
        borderTopColor: "var(--c-cyan, #6bd6e0)",
        animation: "vf-spin 0.8s linear infinite",
      }} />
      <div className="mono dim" style={{ fontSize: 12, letterSpacing: "0.08em" }}>Loading…</div>
    </div>
  );
}

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
const VIEW_ORDER = ["pipeline", "mywork", "footage", "editor", "projects", "lossless", "coverage", "locations", "analytics", "inbox", "team", "export", "generate", "reeldna", "training", "monitor"];

/* Tab strip definition (order shown). `key` matches the `view` string and
   the permission catalog's view keys, so canView() gates each tab. Numbers
   are assigned dynamically over the *visible* set so they stay contiguous
   when a role has tabs removed. */
// Tab order follows the group order below so the drawer's dynamic numbering
// stays contiguous. Tab keys/labels are unchanged — only their grouping moved.
const TABS = [
  { key: "mywork",    label: "My work" },
  { key: "pipeline",  label: "Pipeline" },
  { key: "generate",  label: "Generate" },
  { key: "reeldna",   label: "Reel DNA" },
  { key: "music",     label: "Music Library" },
  { key: "footage",   label: "Footage" },
  { key: "coverage",  label: "Coverage" },
  { key: "locations", label: "Locations" },
  { key: "editor",    label: "Editor" },
  { key: "projects",  label: "Projects" },
  { key: "lossless",  label: "Lossless" },
  { key: "export",    label: "Export" },
  { key: "training",  label: "Training" },
  { key: "resources", label: "Resources" },
  { key: "inbox",     label: "Inbox" },
  { key: "team",      label: "Team" },
  { key: "analytics", label: "Analytics" },
  { key: "monitor",   label: "Monitor" },   // consolidated hub: Infra / Pulse / AI Brain sub-tabs
  { key: "activity",  label: "Activity" },
];

// 7 workflow-domain groups (was 11; killed 5 singletons). Existing users'
// saved nav_group_order references the old keys — the merge logic below
// (filter(Boolean) on stale keys + append-missing) resolves them to this
// order without wiping prefs. Tones reuse the existing palette.
const DEFAULT_TAB_GROUPS = [
  { key: "mywork_group",  label: "My Work",     tone: "cyan",   tabs: ["mywork"] },
  { key: "produce_group", label: "Produce",     tone: "amber",  tabs: ["pipeline", "generate"] },
  { key: "library_group", label: "Library",     tone: "violet", tabs: ["reeldna", "music", "footage", "coverage", "locations"] },
  { key: "edit_group",    label: "Edit & Ship", tone: "green",  tabs: ["editor", "lossless", "export"] },
  { key: "learn_group",   label: "Learn",       tone: "pink",   tabs: ["training", "resources"] },
  { key: "engage_group",  label: "Engage",      tone: "orange", tabs: ["inbox", "team", "analytics"] },
  { key: "monitor_group", label: "Monitor",     tone: "blue",   tabs: ["monitor", "activity"] },
];

function AppShell() {
  const { person: me, signOut } = useAuth();
  const { reels, prefetchHeavyTabs } = useWorkflow();
  const { peopleById, peopleList } = useRoster();
  const { canView, setEffectiveRole, setEffectivePersonId } = usePermissions();
  // Real-role owner flag (NOT the previewed perspective) — drives owner-only
  // affordances: the perspective switcher, settings, and the Monitor hub.
  const isOwner = useIsOwner();
  // Unread Teams-chat messages → Team-tab badge (new-message notifier).
  const { unseenCount: teamUnseen } = useTeamChatAlerts();
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
  const [editingProjectId, setEditingProjectId] = useState(null);   // which Editor project the OpenCut editor opened from the Projects browser
  const [focusModule, setFocusModule]   = useState(null);   // training skillKey to auto-expand/scroll
  const [role, setRole]                 = useState(() => me?.id ?? "paul");
  const [roleMenu, setRoleMenu]         = useState(false);
  const [prefsOpen, setPrefsOpen]       = useState(false);   // Display & accessibility modal
  const [solarinMode, setSolarinMode] = useState(
    () => localStorage.getItem('fb_solarin_mode') === 'true'
  );
  const [openCat, setOpenCat] = useState(null);
  const roleSwitchRef                   = useRef(null);
  const solRoleRef                      = useRef(null);   // Solarin-nav avatar (mirrors role menu)
  const [navOpen, setNavOpen]           = useState(false);   // left slide-in drawer
  const [globalSearch, setGlobalSearch] = useState("");
  const [capturePrefill, setCapturePrefill] = useState(null);   // Reel DNA share-target/bookmarklet
  const [autoCompare, setAutoCompare]     = useState(false);   // ?compare=1 deep-link
  const searchRef                       = useRef(null);

  /* B3 PREFETCH — owner-only warming of the code-split heavy tabs. When the
     owner enables the "Prefetch heavy tabs" pref, warm every lazy chunk on idle
     so the first click on a peripheral tab is instant (no fallback flash). Uses
     the SAME import() factories as the React.lazy wrappers above (LAZY_IMPORTERS),
     so no extra/duplicate chunks are produced. Editors (non-owners) never enter
     this branch — they get pure on-demand loading, totally unaffected. When the
     flag is false, chunks load lazily on first click as normal. */
  useEffect(() => {
    if (!isOwner || !prefetchHeavyTabs) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // Fire-and-forget; failures are harmless (the real lazy load retries).
      LAZY_IMPORTERS.forEach((load) => { try { load(); } catch (_) {} });
    };
    const ric = typeof window !== "undefined" && window.requestIdleCallback;
    let handle;
    if (ric) {
      handle = window.requestIdleCallback(warm, { timeout: 4000 });
    } else {
      // Fallback for browsers without requestIdleCallback (e.g. Safari).
      handle = setTimeout(warm, 1200);
    }
    return () => {
      cancelled = true;
      if (ric && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle);
      } else {
        clearTimeout(handle);
      }
    };
  }, [isOwner, prefetchHeavyTabs]);

  /* Close perspective dropdown on outside click */
  useEffect(() => {
    if (!roleMenu) return;
    const handler = (e) => {
      const inClassic = roleSwitchRef.current && roleSwitchRef.current.contains(e.target);
      const inSolarin = solRoleRef.current && solRoleRef.current.contains(e.target);
      if (!inClassic && !inSolarin) setRoleMenu(false);
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
    const reviewsAreMine = ownsReviewQueue(me);
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
    const personId = isOwner
      ? (peopleById[role]?.id || me?.id || null)
      : (me?.id || null);
    setEffectivePersonId(personId);
  }, [role, me?.id, isOwner, peopleById, setEffectivePersonId]);

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
    // Landing on the Editor tab from the nav always shows the Projects picker
    // (clear any project carried over from a previous open) — the embedded
    // CapCut editor is only entered by PICKING a project. openEditorProject()
    // sets editingProjectId itself (it deliberately bypasses goView).
    if (key === "editor") setEditingProjectId(null);
    setViewStack(prev => [...prev.slice(-19), view]);
    setView(key);
    setNavOpen(false);
  };

  /* Open a saved Editor project from the Projects browser: stash its id so the
     OpenCut <VideoEditor> mount can load it, then navigate to the editor view.
     Bypasses goView so the editingProjectId we just set isn't cleared by the
     "editor"-tab reset above. onBackToProjects returns to the picker. */
  const openEditorProject = (id) => {
    setViewStack(prev => [...prev.slice(-19), view]);
    setEditingProjectId(id);
    setView("editor");
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
    const wantCompare = new URLSearchParams(window.location.search).get("compare") === "1";
    if (match) { openReel(match); if (wantCompare) setAutoCompare(true); }
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

  /* Solarin redesign theme toggle — mirror solarinMode onto #root's data-theme
     so styles-solarin.css (gated on [data-theme="solarin"]) activates/reverts. */
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (solarinMode) root.setAttribute('data-theme', 'solarin');
    else root.removeAttribute('data-theme');
  }, [solarinMode]);

  /* Default the Solarin theme ON for the owner. Only fires when the owner has
     never made an explicit choice (localStorage unset) — once they toggle it
     off, 'false' is persisted and respected. Non-owners are untouched (they
     stay classic until/unless an owner ships it as the default for everyone). */
  useEffect(() => {
    if (isOwner && localStorage.getItem('fb_solarin_mode') === null) {
      setSolarinMode(true);
    }
  }, [isOwner]);

  /* Only the owner may switch perspectives. The avatar in the topbar shows
     the perspective the owner is currently viewing; everyone else sees just
     their own icon. */
  const shownPerson = isOwner ? (peopleById[role] || me) : me;
  // Role key the rest of the app (MyWork, permissions) needs.
  const viewingRoleKey = shownPerson?.role || "skilled";

  /* The avatar dropdown (perspective switch · Roles & permissions · Pimped-Out
     toggle · accessibility · sign out). Extracted so it renders in BOTH the
     classic topbar AND the Solarin top nav — otherwise, with the topbar hidden
     in Solarin mode, the toggle to revert would be unreachable. */
  const roleMenuPanel = () => (
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
        <div
          className="rm-opt"
          style={{ borderTop: "1px dashed var(--line-hard)", marginTop: 6, paddingTop: 10 }}
          onClick={() => {
            const next = !solarinMode;
            setSolarinMode(next);
            localStorage.setItem('fb_solarin_mode', String(next));
            setRoleMenu(false);
          }}
        >
          <span className="avatar-chip" style={{ fontSize: 13 }}>
            {solarinMode ? '✦' : '◇'}
          </span>
          <div>
            <div className="rm-name">{solarinMode ? 'Exit Pimped Out' : 'Pimped Out Mode'}</div>
            <div className="rm-role">Toggle Solarin redesign</div>
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
        <span>signed in · <b style={{ color: "var(--fg)" }}>{me?.short || me?.name}</b></span>
        <a href="#" style={{ color: "var(--c-cyan)" }}
           onClick={e => { e.preventDefault(); signOut(); }}>sign out</a>
      </div>
    </div>
  );

  return (
    <div className="app">
      {/* Solarin redesign shell — fixed per-tab background + centered category nav.
          Renders ONLY when solarinMode is on (owner toggle). The classic .topbar /
          .nav-drawer below are PRESERVED in the JSX; styles-solarin.css hides them
          via display:none when [data-theme="solarin"] is active. */}
      {solarinMode && (() => {
        /* Fixed per-tab background. Files live in public/assets/bg/ (served at
           /assets/bg/...). Every view gets an image (reused where it fits the
           theme); DIM = [top,bottom] overlay opacity so headings stay legible. */
        const BG = {
          mywork:    '/assets/bg/bg-mywork-globe.png',
          pipeline:  '/assets/bg/bg-pipeline-city.jpeg',
          generate:  '/assets/bg/dna-cyber-blue.jpeg',
          reeldna:   '/assets/bg/bg-reeldna-virus.jpeg',
          music:     '/assets/bg/dark-luxury-hud.jpeg',
          footage:   '/assets/bg/destroyed-city.jpeg',
          coverage:  '/assets/bg/world-monitor.jpeg',
          locations: '/assets/bg/world-monitor-2.jpeg',
          editor:    '/assets/bg/dark-luxury-hud.jpeg',
          projects:  '/assets/bg/dna-3.jpeg',
          lossless:  '/assets/bg/bg-dna-blue.jpeg',
          export:    '/assets/bg/aethelian-spine.jpeg',
          training:  '/assets/bg/bg-training-samurai.jpeg',
          resources: '/assets/bg/dna-2.jpeg',
          inbox:     '/assets/bg/world-monitor.jpeg',
          team:      '/assets/bg/aethelian-spine.jpeg',
          analytics: '/assets/bg/bg-monitor-hud.jpg',
          monitor:   '/assets/bg/dark-luxury-hud.jpeg',
          activity:  '/assets/bg/destroyed-city.jpeg',
          settings:  '/assets/bg/dark-luxury-hud.jpeg',
          detail:    '/assets/bg/bg-detail-dna.jpeg',
        };
        const DIM = {
          mywork:[.44,.62], pipeline:[.68,.86], generate:[.66,.84], reeldna:[.60,.78],
          music:[.74,.92], footage:[.70,.88], coverage:[.72,.90], locations:[.72,.90],
          editor:[.78,.94], projects:[.66,.84], lossless:[.66,.84], export:[.70,.88],
          training:[.72,.90], resources:[.66,.84], inbox:[.74,.92], team:[.70,.88],
          analytics:[.74,.92], monitor:[.80,.96], activity:[.72,.90], settings:[.78,.94],
          detail:[.64,.82],
        };
        const bg = BG[view];
        const [d1, d2] = DIM[view] || [.72, .90];
        const isHud = view === 'analytics' || view === 'monitor';
        const CATS = [
          { key:'produce_group',  label:'Produce',    tone:'#F5A623', tabs:['pipeline','generate'] },
          { key:'library_group',  label:'Library',    tone:'#B58BE0', tabs:['reeldna','music','footage','coverage','locations'] },
          { key:'edit_group',     label:'Edit & Ship',tone:'#5FB89A', tabs:['editor','lossless','export'] },
          { key:'learn_group',    label:'Learn',      tone:'#E58BA0', tabs:['training','resources'] },
          { key:'engage_group',   label:'Engage',     tone:'#E8884A', tabs:['inbox','team','analytics'] },
          { key:'monitor_group',  label:'Monitor',    tone:'#5FA8D6', tabs:['monitor','activity'] },
        ];
        const LEFT_CATS  = CATS.slice(0, 3);
        const RIGHT_CATS = CATS.slice(3);
        return (
          <React.Fragment>
            {bg && (
              <div className="sol-bg" style={{ backgroundImage: 'url("' + bg + '")' }}>
                <div className="sol-bg-overlay"
                  style={{ background: 'linear-gradient(rgba(12,15,14,' + d1 + '),rgba(12,15,14,' + d2 + '))' }} />
              </div>
            )}
            <nav className={"sol-nav" + (isHud ? ' hud' : '')}>
              <div className="sol-logo">
                <div className="sol-logo-w">W</div>
                WORKFLOW
              </div>
              <div className="sol-center">
                {LEFT_CATS.map(cat => {
                  const active = cat.tabs.includes(view);
                  return (
                    <div key={cat.key} className="sol-dropdown-wrap">
                      <button
                        className={"sol-cat" + (active ? ' active' : '')}
                        onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
                      >{cat.label} ▾</button>
                      {openCat === cat.key && (
                        <div className="sol-dropdown" style={{ borderTop: '2px solid ' + cat.tone }}>
                          {cat.tabs.filter(t => canViewView(t)).map(k => {
                            const t = TABS.find(x => x.key === k);
                            return (
                              <div key={k} className="sol-dropdown-item"
                                onClick={() => { goView(k); setOpenCat(null); }}>
                                <span className="sol-dot" style={{ background: cat.tone }} />
                                {t ? t.label : k}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  className={"sol-mywork" + (view === 'mywork' ? ' active' : '')}
                  onClick={() => goView('mywork')}
                >My Work</button>
                {RIGHT_CATS.map(cat => {
                  const active = cat.tabs.includes(view);
                  return (
                    <div key={cat.key} className="sol-dropdown-wrap">
                      <button
                        className={"sol-cat" + (active ? ' active' : '')}
                        onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
                      >{cat.label} ▾</button>
                      {openCat === cat.key && (
                        <div className="sol-dropdown" style={{ borderTop: '2px solid ' + cat.tone }}>
                          {cat.tabs.filter(t => canViewView(t)).map(k => {
                            const t = TABS.find(x => x.key === k);
                            return (
                              <div key={k} className="sol-dropdown-item"
                                onClick={() => { goView(k); setOpenCat(null); }}>
                                <span className="sol-dot" style={{ background: cat.tone }} />
                                {t ? t.label : k}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="sol-nav-right">
                <input className="sol-search" placeholder="Search reels…"
                  value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} />
                <div ref={solRoleRef} className="role-switch sol-role-switch"
                  style={{ position: 'relative' }}
                  onClick={e => { e.stopPropagation(); setRoleMenu(o => !o); }}
                  title={shownPerson?.name || ''}>
                  <span className={"avatar-chip " + (shownPerson?.role || '')}
                    style={{ cursor: 'pointer' }}>{shownPerson?.avatar}</span>
                  {isOwner && <span className="rs-caret">▾</span>}
                  {roleMenu && me && roleMenuPanel()}
                </div>
              </div>
              {openCat && <div className="sol-bd" onClick={() => setOpenCat(null)} />}
            </nav>
          </React.Fragment>
        );
      })()}
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
          {roleMenu && me && roleMenuPanel()}
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
                background: "var(--bg-elev)",
                border: "1px solid var(--line-hard)",
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
                        color: "var(--fg)",
                        borderBottom: "1px solid var(--line)",
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-3)"}
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
                    {t.key === "team" && teamUnseen > 0 && (
                      <span className="needs-badge">{teamUnseen}</span>
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

      {/* Body — ONE Suspense boundary wraps the whole view-switch cascade so any
          code-split (lazy) peripheral page shows the lightweight ViewFallback
          while its chunk loads. The eager core pages (MyWork/Pipeline/ReelDetail/
          FootageLibrary/ReelDna) resolve synchronously and never trip it. The
          always-mounted TeamChat is lazy too, so it lives inside the boundary. */}
      <React.Suspense fallback={<ViewFallback />}>
        {view === "mywork"    && <MyWork    role={viewingRoleKey} personId={shownPerson?.id} onOpen={openReel} onNavigate={goView} onSetPerson={setRole} />}
        {view === "pipeline"  && pipelineMode === "board"    && <Pipeline    onOpen={openReel} />}
        {view === "pipeline"  && pipelineMode === "list"     && <ListView    role="all" onOpen={openReel} />}
        {view === "pipeline"  && pipelineMode === "calendar" && <CalendarView role="all" onOpen={openReel} />}
        {view === "pipeline"  && pipelineMode === "archived" && <ArchivedView onOpen={openReel} />}
        {view === "detail"    && <ReelDetail reel={selectedReel} onBack={goBack} onLearnSkill={openTrainingModule} openCompare={autoCompare} onCompareMounted={() => setAutoCompare(false)} />}
        {view === "footage"   && <FootageLibrary onOpen={openReel} />}
        {view === "editor"    && (editingProjectId
          ? <VideoEditor reel={selectedReel} onOpen={openReel} reelDnaId={selectedReel?.reelDnaId} editingProjectId={editingProjectId} onBackToProjects={() => setEditingProjectId(null)} embedEnabled={EDITOR_EMBED_ENABLED} editorOrigin={EDITOR_ORIGIN} />
          : <EditorProjects openEditorProject={openEditorProject} />)}
        {view === "projects"  && <EditorProjects openEditorProject={openEditorProject} />}
        {view === "lossless"  && <LosslessCut reel={selectedReel} onOpen={openReel} />}
        {view === "export"    && <ExportView onOpen={openReel} />}
        {view === "analytics" && <Analytics />}
        {view === "inbox"     && <Inbox />}

        {view === "locations" && <Locations />}
        {view === "coverage"  && <Coverage />}
        {view === "generate"  && <IdeaGenerator />}
        {view === "reeldna"   && <ReelDna prefill={capturePrefill} />}
        {view === "music"     && <MusicLibrary />}
        {view === "training"  && <Training onOpen={openReel} personId={shownPerson?.id} focusModule={focusModule} onFocusConsumed={() => setFocusModule(null)} />}
        {view === "activity"  && <Activity />}
        {view === "resources" && <Resources />}
        {view === "monitor"   && canViewView("monitor") && <MonitorHub canView={canView} />}
        {view === "settings"  && isOwner && <RolesAdmin onBack={goBack} />}

        {/* Always-mounted — CSS-hidden when inactive so iframe keeps its WS connection */}
        <TeamChat active={view === "team"} />
      </React.Suspense>

      {/* Global create FAB */}
      <CreateFab />

      {/* Global new-Teams-message toast (bottom-left). */}
      <TeamChatToast onOpenTeam={() => goView("team")} />

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
                      <TeamChatAlertsProvider>
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
                      </TeamChatAlertsProvider>
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
