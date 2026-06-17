/* =========================================================
   Space3D — L2 COMPOSITION + scene state machine for the owner-only
   3D "Space" alternate homepage (/space).

   Responsibilities (and ONLY these):
     · Owner gate (non-owners are bounced to /app).
     · Read the live store ONCE, read-only, and shape tile metrics.
     · Own the 3-state machine (assembled → exploded → detail) driven
       by scroll, click, hover and keyboard.
     · Wire StarWeb + R3F <Canvas><RubikCube/> + SpaceMenu + DetailPanel,
       or the flat SpaceFallback when WebGL/motion is unavailable.

   It imports the cube pieces (L1) and config (L0). It NEVER dispatches
   to the store and edits no existing app file. Fully isolated; lazy-
   loaded by app.jsx so none of this (incl. three.js) ships in the main
   bundle until /space is opened.
   ========================================================= */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";

import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { getConnections } from "../lib/social-client.js";

import { FACES, PAGES, FACE_BY_KEY, PAGE_BY_KEY, openInApp } from "../lib/space-cube-config.jsx";
import { buildMetrics } from "../components/space/widgets.jsx";
import RubikCube from "../components/space/RubikCube.jsx";
import StarWeb from "../components/space/StarWeb.jsx";
import SpaceMenu from "../components/space/SpaceMenu.jsx";
import DetailPanel from "../components/space/DetailPanel.jsx";
import SpaceFallback from "../components/space/SpaceFallback.jsx";
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

/* index → scene mapping:
   0 = assembled, 1 = exploded, 2.. = detail for PAGES[index-2] */
function deriveScene(index) {
  if (index <= 0) return { state: "assembled", key: null };
  if (index === 1) return { state: "exploded", key: null };
  const p = PAGES[Math.min(index - 2, PAGES.length - 1)];
  return { state: "detail", key: p.key };
}
const MAX_INDEX = PAGES.length + 1; // last detail page

export function Space3D() {
  const { person } = useAuth();

  // ── Owner gate ──────────────────────────────────────────
  // Inside the authed provider tree person is resolved; only the owner
  // may see this view. Anyone else is sent to the classic app.
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

  const [index, setIndex] = useState(0);
  const [hoveredFace, setHoveredFace] = useState(null);
  const wheelLock = useRef(0);

  const { state, key: selectedKey } = deriveScene(index);

  // ── single read-only store snapshot → tile metrics ──────
  const metrics = useMemo(() => {
    const snapshot = {
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
    };
    return buildMetrics(PAGES.map(p => p.key), snapshot);
  }, [wf.reels, wf.reviewLaneCards, wf.tasks, wf.dailyTasks, wf.reelDna, wf.attachedFootage, wf.moduleContent, wf.gamifyProgress, loc.locations]);

  // ── transitions ─────────────────────────────────────────
  const step = useCallback((dir) => {
    setIndex((i) => Math.max(0, Math.min(MAX_INDEX, i + dir)));
  }, []);

  const openPage = useCallback((pageKey) => {
    const idx = PAGES.findIndex(p => p.key === pageKey);
    if (idx >= 0) setIndex(idx + 2);
  }, []);

  const pickFace = useCallback((faceKey) => {
    setHoveredFace(faceKey);
    setIndex(1); // explode to the grid; spotlight handled by hoveredFace
  }, []);

  const backToGrid = useCallback(() => setIndex(1), []);

  // wheel → step through scenes (throttled)
  useEffect(() => {
    const onWheel = (e) => {
      const now = Date.now();
      if (now < wheelLock.current) return;
      if (Math.abs(e.deltaY) < 18) return;
      wheelLock.current = now + 480;
      step(e.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [step]);

  // keyboard: arrows / escape / backspace
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      else if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        setIndex((i) => (i >= 2 ? 1 : 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const exitToClassic = () => window.location.assign("/app");
  const onOpen = (link) => (link ? openInApp(link) : null);

  const selectedPage = selectedKey ? PAGE_BY_KEY[selectedKey] : null;
  const selectedFace = selectedPage ? FACE_BY_KEY[selectedPage.face] : null;

  // ── reduced-motion / no-WebGL: flat functional fallback ──
  if (!use3D) {
    return (
      <div className="s3d-root s3d-root--flat">
        <StarWeb reduced />
        <button type="button" className="s3d-exit" onClick={exitToClassic}>Classic home →</button>
        <SpaceFallback faces={FACES} pages={PAGES} metrics={metrics} onOpen={onOpen} />
      </div>
    );
  }

  return (
    <div className="s3d-root">
      <StarWeb reduced={caps.reduced} />

      <button type="button" className="s3d-exit" onClick={exitToClassic}>Classic home →</button>

      <SpaceMenu
        faces={FACES}
        hoveredFace={hoveredFace}
        onHoverFace={setHoveredFace}
        onPickFace={pickFace}
        visible={state !== "assembled"}
      />

      {/* hero hint / recombine affordance */}
      {state === "assembled" && (
        <div className="s3d-hero-hint" onClick={() => setIndex(1)}>
          <div className="s3d-hero-title">FootageBrain · Space</div>
          <div className="s3d-hero-sub">scroll, hover, or click to explore your workspace</div>
        </div>
      )}

      <div
        className="s3d-canvas-wrap"
        onPointerDown={() => { if (state === "assembled") setIndex(1); }}
      >
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 9], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          style={{ background: "transparent" }}
        >
          <RubikCube
            mode={state}
            selectedKey={selectedKey}
            hoveredFace={hoveredFace}
            metrics={metrics}
            onSelectPage={openPage}
            onHoverFace={setHoveredFace}
          />
        </Canvas>
      </div>

      {state === "detail" && (
        <DetailPanel
          page={selectedPage}
          face={selectedFace}
          metric={selectedKey ? metrics[selectedKey] : ""}
          onOpen={onOpen}
          onBack={backToGrid}
        />
      )}

      {/* progress dots */}
      <div className="s3d-progress" aria-hidden="true">
        <span className={"s3d-dot" + (state === "assembled" ? " s3d-dot--on" : "")} />
        <span className={"s3d-dot" + (state === "exploded" ? " s3d-dot--on" : "")} />
        <span className={"s3d-dot" + (state === "detail" ? " s3d-dot--on" : "")} />
      </div>
    </div>
  );
}

export default Space3D;
