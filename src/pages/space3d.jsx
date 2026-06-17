/* =========================================================
   Space3D — L2 COMPOSITION + scene state machine for the owner-only
   3D "Space" alternate homepage (/space).

   Responsibilities (and ONLY these):
     · Owner gate (non-owners are bounced to /app).
     · Read the live store ONCE, read-only, and shape tile metrics + detail.
     · Own the 3-state machine (assembled → exploded → detail) driven by
       scroll, click, hover and keyboard.
     · Hold customization prefs (cube color/style + background), persisted.
     · Wire StarWeb + R3F <Canvas><RubikCube/> + SpaceMenu + DetailPanel +
       SpaceSettings, or the flat SpaceFallback when WebGL/motion is out.

   It imports the cube pieces (L1) and config (L0). It NEVER dispatches to
   the store and edits no existing app file. Lazy-loaded by app.jsx so none
   of this (incl. three.js) ships in the main bundle until /space is opened.
   ========================================================= */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";

import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { getConnections } from "../lib/social-client.js";

import { FACES, PAGES, FACE_BY_KEY, PAGE_BY_KEY, openInApp } from "../lib/space-cube-config.jsx";
import { buildMetrics, pageDetail } from "../components/space/widgets.jsx";
import RubikCube from "../components/space/RubikCube.jsx";
import Galaxy from "../components/space/Galaxy.jsx";
import StarWeb from "../components/space/StarWeb.jsx";
import SpaceMenu from "../components/space/SpaceMenu.jsx";
import DetailPanel from "../components/space/DetailPanel.jsx";
import SpaceFallback from "../components/space/SpaceFallback.jsx";
import SpaceSettings from "../components/space/SpaceSettings.jsx";
import "./space3d.css";

/* ---- capability checks (same recipe as dna-helix.jsx) ---- */
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}
function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
function connectionsCount() {
  try {
    const c = getConnections();
    if (!c) return 0;
    if (Array.isArray(c)) return c.filter(x => x && x.connected).length;
    return Object.values(c).filter(x => x && x.connected).length;
  } catch {
    return 0;
  }
}

const DEFAULT_PREFS = { edgeColor: "#f5c266", style: "metallic", bg: "nebula" };
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem("s3d_prefs") || "{}")) }; }
  catch { return { ...DEFAULT_PREFS }; }
}

export function Space3D() {
  const { person } = useAuth();
  // Owner gate — only the owner sees this; anyone else goes to /app.
  if (person && person.role !== "owner") {
    if (typeof window !== "undefined") window.location.replace("/app");
    return null;
  }
  return <Space3DInner />;
}

function Space3DInner() {
  const wf = useWorkflow();
  const loc = useLocations();

  const [caps] = useState(() => ({ gl: webglAvailable(), reduced: prefersReducedMotion() }));
  const use3D = caps.gl && !caps.reduced;

  // Continuous-zoom model: the camera distance drives `zone`
  // (free / assembled / stacked); a picked page drives `selectedKey`.
  const [zone, setZone] = useState("assembled");
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoveredFace, setHoveredFace] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const state = selectedKey ? "detail" : (zone === "stacked" ? "stacked" : "assembled");

  // ── single read-only store snapshot → metrics + detail ──
  const snapshot = useMemo(() => ({
    reels: wf.reels,
    reviewLaneCards: wf.reviewLaneCards,
    tasks: wf.tasks,
    dailyTasks: wf.dailyTasks,
    reelDna: wf.reelDna,
    attachedFootage: wf.attachedFootage,
    moduleContent: wf.moduleContent,
    gamifyProgress: wf.gamifyProgress,
    locations: loc.locations,
    connections: connectionsCount(),
  }), [wf.reels, wf.reviewLaneCards, wf.tasks, wf.dailyTasks, wf.reelDna, wf.attachedFootage, wf.moduleContent, wf.gamifyProgress, loc.locations]);

  const metrics = useMemo(() => buildMetrics(PAGES.map(p => p.key), snapshot), [snapshot]);
  const selectedDetail = useMemo(() => (selectedKey ? pageDetail(selectedKey, snapshot) : null), [selectedKey, snapshot]);

  // ── transitions ─────────────────────────────────────────
  const openPage = useCallback((pageKey) => setSelectedKey(pageKey), []);
  const pickFace = useCallback((faceKey) => { setHoveredFace(faceKey); setSelectedKey(null); }, []);
  const backToGrid = useCallback(() => setSelectedKey(null), []);

  const updatePrefs = useCallback((p) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem("s3d_prefs", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  }, []);

  // keyboard: escape / backspace closes the detail panel.
  // (Scroll is now owned by OrbitControls for continuous zoom.)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); setSelectedKey(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const exitToClassic = () => window.location.assign("/app");
  const onOpen = (link) => (link ? openInApp(link) : null);

  const selectedPage = selectedKey ? PAGE_BY_KEY[selectedKey] : null;
  const selectedFace = selectedPage ? FACE_BY_KEY[selectedPage.face] : null;

  // ── reduced-motion / no-WebGL: flat functional fallback ──
  if (!use3D) {
    return (
      <div className="s3d-root s3d-root--flat s3d-bg-nebula">
        <StarWeb reduced />
        <button type="button" className="s3d-exit" onClick={exitToClassic}>Classic home →</button>
        <SpaceFallback faces={FACES} pages={PAGES} metrics={metrics} onOpen={onOpen} />
      </div>
    );
  }

  return (
    <div className={"s3d-root s3d-bg-" + prefs.bg}>
      <div className="s3d-topbar">
        <button type="button" className="s3d-iconbtn" title="Customize" onClick={() => setSettingsOpen(o => !o)}>⚙</button>
        <button type="button" className="s3d-exit" onClick={exitToClassic}>Classic home →</button>
      </div>

      <SpaceSettings open={settingsOpen} prefs={prefs} onChange={updatePrefs} onClose={() => setSettingsOpen(false)} />

      <SpaceMenu
        faces={FACES}
        hoveredFace={hoveredFace}
        onHoverFace={setHoveredFace}
        onPickFace={pickFace}
        visible={state !== "assembled"}
      />

      {state === "assembled" && (
        <div className="s3d-hero-hint">
          <div className="s3d-hero-title">FootageBrain · Space</div>
          <div className="s3d-hero-sub">drag to rotate · scroll or click a box to explore</div>
        </div>
      )}

      <div className="s3d-canvas-wrap">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 9], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          style={{ background: "transparent" }}
        >
          <Galaxy reduced={caps.reduced} bg={prefs.bg} />
          <RubikCube
            mode={state}
            selectedKey={selectedKey}
            hoveredFace={hoveredFace}
            metrics={metrics}
            prefs={prefs}
            onSelectPage={openPage}
            onHoverFace={setHoveredFace}
            onZone={setZone}
          />
        </Canvas>
      </div>

      {state === "detail" && (
        <DetailPanel
          page={selectedPage}
          face={selectedFace}
          detail={selectedDetail}
          metric={selectedKey ? metrics[selectedKey] : ""}
          onOpen={onOpen}
          onBack={backToGrid}
        />
      )}

      <div className="s3d-progress" aria-hidden="true">
        <span className={"s3d-dot" + (state === "assembled" ? " s3d-dot--on" : "")} />
        <span className={"s3d-dot" + (state === "stacked" ? " s3d-dot--on" : "")} />
        <span className={"s3d-dot" + (state === "detail" ? " s3d-dot--on" : "")} />
      </div>
    </div>
  );
}

export default Space3D;
