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
import { EffectComposer, Bloom } from "@react-three/postprocessing";

import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { getConnections } from "../lib/social-client.js";

import { FACES, PAGES, FACE_BY_KEY, PAGE_BY_KEY, openInApp, QUALITY, pickQuality, CAM } from "../lib/space-cube-config.jsx";
import { buildMetrics, pageDetail } from "../components/space/widgets.jsx";
import RubikCube from "../components/space/RubikCube.jsx";
import Galaxy from "../components/space/Galaxy.jsx";
import Skydome from "../components/space/Skydome.jsx";
import StarWeb from "../components/space/StarWeb.jsx";
import SpaceMenu from "../components/space/SpaceMenu.jsx";
import DetailPanel from "../components/space/DetailPanel.jsx";
import SpaceFallback from "../components/space/SpaceFallback.jsx";
import SpaceSettings from "../components/space/SpaceSettings.jsx";
import SpaceControls from "../components/space/SpaceControls.jsx";
import GravLens from "../components/space/GravLens.jsx";
import { SpaceAudio } from "../components/space/space-audio.js";
import { DEFAULT_SCENE, BODIES, hydrateScene, posFromAED } from "../lib/space-scene-params.jsx";
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
function deviceTier() {
  try {
    const mobile = window.matchMedia ? window.matchMedia("(max-width:820px)").matches : false;
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 8;
    return { mobile, lowCore: cores <= 4 };
  } catch {
    return { mobile: false, lowCore: false };
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
function loadScene() {
  try { return hydrateScene(JSON.parse(localStorage.getItem("s3d_scene") || "{}")); }
  catch { return hydrateScene(null); }
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

  const [caps] = useState(() => {
    const tier = deviceTier();
    return { gl: webglAvailable(), reduced: prefersReducedMotion(), ...tier };
  });
  const use3D = caps.gl && !caps.reduced;
  const quality = useMemo(
    () => pickQuality({ mobile: caps.mobile, lowCore: caps.lowCore, reduced: caps.reduced }),
    [caps.mobile, caps.lowCore, caps.reduced]
  );
  const bloomOn = (QUALITY[quality] || QUALITY.high).bloom;

  // Continuous-zoom model: the camera distance drives `zone`
  // (free / assembled / stacked); a picked page drives `selectedKey`.
  const [zone, setZone] = useState("assembled");
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoveredFace, setHoveredFace] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Scene Studio: per-body params + procedural audio ──
  const [scene, setScene] = useState(loadScene);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioSel, setStudioSel] = useState(null);
  const audioRef = useRef(null);

  // ── Gravitational-lens warp: idle → warping → atSun → returning → idle ──
  const [warpPhase, setWarpPhase] = useState("idle");
  const requestWarp = useCallback(() => setWarpPhase((p) => (p === "idle" ? "warping" : p)), []);
  const onWarpArrive = useCallback((ph) => setWarpPhase(ph === "warping" ? "atSun" : "idle"), []);
  const exitWarp = useCallback(() => setWarpPhase((p) => (p === "atSun" ? "returning" : p)), []);
  const sunPos = useMemo(
    () => posFromAED(scene.sun.az, scene.sun.el, scene.sun.dist),
    [scene.sun.az, scene.sun.el, scene.sun.dist]
  );

  // push the whole scene's audio settings to the engine
  const syncAudio = useCallback((sc) => {
    const a = audioRef.current;
    if (!a || !a.started) return;
    a.setMuted(sc.global.muted);
    a.setMaster(sc.global.masterVolume);
    for (const b of BODIES) {
      const bp = sc[b.id];
      if (bp) a.setBody(b.id, { sound: bp.sound, volume: bp.volume });
    }
    a.setPulsarRate(sc.pulsar.spin);
  }, []);

  const onSceneChange = useCallback((bodyId, key, value) => {
    setScene((prev) => {
      const next = { ...prev, [bodyId]: { ...prev[bodyId], [key]: value } };
      try { localStorage.setItem("s3d_scene", JSON.stringify(next)); } catch (_) {}
      syncAudio(next);
      return next;
    });
  }, [syncAudio]);

  // first time the studio opens is a user gesture → safe to start audio
  const toggleStudio = useCallback(() => {
    setStudioOpen((o) => {
      const open = !o;
      if (open && !audioRef.current) {
        audioRef.current = new SpaceAudio();
        audioRef.current.init();
      }
      if (open && audioRef.current) { audioRef.current.resume(); syncAudio(scene); }
      return open;
    });
  }, [scene, syncAudio]);

  // open the studio focused on a body picked in the 3D scene
  const openStudioAt = useCallback((id) => {
    setStudioSel(id);
    setStudioOpen(true);
    if (!audioRef.current) { audioRef.current = new SpaceAudio(); audioRef.current.init(); }
    if (audioRef.current) { audioRef.current.resume(); syncAudio(scene); }
  }, [scene, syncAudio]);

  useEffect(() => () => { if (audioRef.current) audioRef.current.dispose(); }, []);

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
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        if (warpPhase === "atSun") setWarpPhase("returning");
        else setSelectedKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [warpPhase]);

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

      {state === "assembled" && warpPhase === "idle" && (
        <div className="s3d-hero-hint">
          <div className="s3d-hero-title">FootageBrain · Space</div>
          <div className="s3d-hero-sub">drag to rotate · scroll or click a box to explore</div>
        </div>
      )}

      {warpPhase === "atSun" && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 30, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 30, pointerEvents: "none" }}>
          <button type="button" className="s3d-exit" style={{ position: "static", pointerEvents: "auto" }} onClick={exitWarp}>← Back to the cube</button>
          <span style={{ color: "#cdd9ee", fontSize: 12, letterSpacing: ".04em", textShadow: "0 1px 6px #000" }}>
            Above the Sun · look to the centre for your spinning cube
          </span>
        </div>
      )}

      <div className="s3d-canvas-wrap">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 12], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          style={{ background: "transparent" }}
        >
          <Skydome bg={prefs.bg} />
          <Galaxy reduced={caps.reduced} bg={prefs.bg} quality={quality} scene={scene} onPick={openStudioAt} />
          <RubikCube
            mode={state}
            selectedKey={selectedKey}
            hoveredFace={hoveredFace}
            metrics={metrics}
            prefs={prefs}
            autoRotateSpeed={scene.global.autoRotate}
            maxDistance={warpPhase === "idle" ? CAM.MAX : 140}
            onSelectPage={openPage}
            onHoverFace={setHoveredFace}
            onZone={setZone}
          />
          <GravLens
            sunPos={sunPos}
            phase={warpPhase}
            params={scene.lens}
            onRequestWarp={requestWarp}
            onArrive={onWarpArrive}
          />
          {bloomOn && scene.global.bloom > 0.02 && (
            <EffectComposer disableNormalPass>
              <Bloom
                intensity={scene.global.bloom}
                luminanceThreshold={0.22}
                luminanceSmoothing={0.32}
                mipmapBlur
                radius={0.7}
              />
            </EffectComposer>
          )}
        </Canvas>
      </div>

      <SpaceControls open={studioOpen} onToggle={toggleStudio} scene={scene} onChange={onSceneChange} sel={studioSel} onSel={setStudioSel} />

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
