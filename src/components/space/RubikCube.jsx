/* =========================================================
   RubikCube — L1 PRESENTATION (prop-driven, no data imports)

   A bluish-grey, alien-tech cube whose intersections glow gold.
   @react-three/fiber v8 + drei v9. Pure presentation.

   Three scene modes, interpolated per-frame with THREE.MathUtils.damp:
     · assembled — 6 category FACES; each face shows its boxes (with
                   topic labels) laid on that side; a gold wireframe
                   frame + corner glows. Drag to orbit (OrbitControls);
                   gentle auto-rotate.
     · exploded  — one column per category, boxes stacked, screen-facing
                   labels, a category header above each column.
     · detail    — the picked box flies to the top-right corner.

   Props:
     mode, selectedKey, hoveredFace, metrics, prefs, onSelectPage, onHoverFace
   ========================================================= */
import React, { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, RoundedBox, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { PAGES, FACES, GOLD, GOLD_BRIGHT, CUBE_BODY, METAL, metalForKey, CAM } from "../../lib/space-cube-config.jsx";
import { SUN_POS } from "./celestial-shared.js";

const TILE = 1.06;
const FACE_DIST = 1.72;     // how far each category face sits from centre
const CELL = 1.2;           // spacing between boxes on a face
const FRAME = FACE_DIST * 2 + 0.7;
const EXPLODE_XCOL = 2.15;  // column spacing in the grid
const EXPLODE_YROW = 1.55;  // row spacing in the grid
const EXPLODE_SCALE = 0.82;
const DETAIL_POS = [4.8, 2.9, 0.6];
const DETAIL_SCALE = 0.62;

/* category → cube side: normal + the two in-plane axes + label rotation */
const FACE_DIRS = {
  dashboard: { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0],  rot: [0, 0, 0] },
  social:    { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0],  rot: [0, Math.PI / 2, 0] },
  content:   { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0],  rot: [0, Math.PI, 0] },
  footage:   { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0],  rot: [0, -Math.PI / 2, 0] },
  locations: { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1], rot: [-Math.PI / 2, 0, 0] },
  intel:     { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1],  rot: [Math.PI / 2, 0, 0] },
};

const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function buildScene() {
  const tiles = [];
  const columns = [];
  const faceTopics = [];

  FACES.forEach((face, fi) => {
    const dir = FACE_DIRS[face.key];
    const pages = PAGES.filter(p => p.face === face.key);
    const k = pages.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(k)));
    const rows = Math.ceil(k / cols);
    const xCol = (fi - (FACES.length - 1) / 2) * EXPLODE_XCOL;

    pages.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ou = (col - (cols - 1) / 2) * CELL;
      const ov = ((rows - 1) / 2 - row) * CELL;
      const assembledPos = add3(mul(dir.n, FACE_DIST), add3(mul(dir.u, ou), mul(dir.v, ov)));
      const yRow = ((k - 1) / 2 - i) * EXPLODE_YROW;

      tiles.push({
        key: p.key, label: p.label, link: p.link, blurb: p.blurb,
        face: face.key, faceColor: face.color, faceNormal: dir.n, labelRot: dir.rot,
        assembledPos, explodedPos: [xCol, yRow, 0],
      });
    });

    // Empty slots: fill the gaps in this face's dynamic grid so the full
    // structure is visible. No label, non-interactive; assembled-only.
    const total = cols * rows;
    for (let i = k; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ou = (col - (cols - 1) / 2) * CELL;
      const ov = ((rows - 1) / 2 - row) * CELL;
      const assembledPos = add3(mul(dir.n, FACE_DIST), add3(mul(dir.u, ou), mul(dir.v, ov)));
      tiles.push({
        key: `empty-${face.key}-${i}`, empty: true,
        face: face.key, faceColor: face.color, faceNormal: dir.n, labelRot: dir.rot,
        assembledPos, explodedPos: [0, 0, 0],
      });
    }

    // Topic name centered above this face's grid (assembled view).
    const headerOffset = ((rows - 1) / 2) * CELL + CELL * 0.95;
    const topicPos = add3(mul(dir.n, FACE_DIST + TILE * 0.52), mul(dir.v, headerOffset));
    faceTopics.push({ key: face.key, label: face.label, color: face.color, pos: topicPos, rot: dir.rot });

    columns.push({
      key: face.key, label: face.label, color: face.color,
      pos: [xCol, ((k - 1) / 2) * EXPLODE_YROW + 1.25, 0],
    });
  });

  return { tiles, columns, faceTopics };
}

function tileTarget(tile, mode, selectedKey) {
  if (tile.empty) return { pos: tile.assembledPos, scale: mode === "assembled" ? 1 : 0.0001 };
  if (mode === "assembled") return { pos: tile.assembledPos, scale: 1 };
  if (mode === "stacked") return { pos: tile.explodedPos, scale: EXPLODE_SCALE };
  if (tile.key === selectedKey) return { pos: DETAIL_POS, scale: DETAIL_SCALE };
  return { pos: tile.explodedPos, scale: 0.0001 };
}

function makeHaloTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* Metallic gold/silver/bronze body, keyed by face so each side reads as
   a coordinated metal. style: metallic (default) | solid (matte) | wire. */
function tileMaterial(tile, style) {
  const m = METAL[metalForKey(tile.face)];
  if (style === "wire") return { color: m.color, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.16 };
  if (style === "solid") return { color: m.color, metalness: 0.45, roughness: 0.6 };
  return { color: m.color, metalness: m.metalness, roughness: m.roughness };
}

/* Watch the camera distance and report the current zone to L2 (with a
   hysteresis deadband so it never flickers at a boundary):
     stacked  (d < D_NEAR)  — zoomed into the cube → stacked columns
     assembled(D_NEAR..D_FAR) — cube centered, drag to rotate
     free     (d > D_FAR)   — pulled back to roam the celestial objects */
function ZoneWatcher({ onZone }) {
  const { camera, controls } = useThree();
  const zoneRef = useRef("assembled");
  useFrame(() => {
    const d = controls && controls.getDistance ? controls.getDistance() : camera.position.length();
    let z = zoneRef.current;
    const h = CAM.HYST;
    if (z !== "stacked" && d < CAM.D_NEAR - h) z = "stacked";
    else if (z === "stacked" && d > CAM.D_NEAR + h) z = "assembled";
    if (z !== "free" && d > CAM.D_FAR + h) z = "free";
    else if (z === "free" && d < CAM.D_FAR - h) z = "assembled";
    if (z !== zoneRef.current) { zoneRef.current = z; onZone(z); }
  });
  return null;
}

function Tile({ tile, mode, selectedKey, hoveredFace, metric, boxGeo, prefs, onSelectPage, onHoverFace }) {
  const ref = useRef();
  const t = tileTarget(tile, mode, selectedKey);
  const dim = hoveredFace && tile.face !== hoveredFace;
  const isSel = tile.key === selectedKey;

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const L = 5;
    g.position.x = THREE.MathUtils.damp(g.position.x, t.pos[0], L, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, t.pos[1], L, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, t.pos[2], L, dt);
    const s = THREE.MathUtils.damp(g.scale.x, t.scale, L, dt);
    g.scale.setScalar(Math.max(s, 0.0001));
  });

  const edge = isSel ? GOLD_BRIGHT : (prefs.edgeColor || GOLD);
  const visible = t.scale > 0.05;
  const flat = mode === "assembled";
  const showLabel = !tile.empty && visible && (mode !== "detail" || isSel);
  const matProps = tileMaterial(tile, prefs.style);
  const emissiveIntensity = tile.empty ? 0.05 : (isSel ? 1.0 : dim ? 0.06 : 0.18);

  const handlers = tile.empty ? {} : {
    onClick: (e) => { e.stopPropagation(); if (tile.key) onSelectPage(tile.key); },
    onPointerOver: (e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; onHoverFace(tile.face); },
    onPointerOut: (e) => { e.stopPropagation(); document.body.style.cursor = "auto"; onHoverFace(null); },
  };

  return (
    <group ref={ref} position={tile.assembledPos}>
      <RoundedBox
        args={[TILE, TILE, TILE]}
        radius={0.12}
        smoothness={4}
        raycast={tile.empty ? () => null : undefined}
        {...handlers}
      >
        <meshStandardMaterial
          color={matProps.color}
          metalness={matProps.metalness}
          roughness={tile.empty ? 0.75 : matProps.roughness}
          transparent={tile.empty ? true : !!matProps.transparent}
          opacity={tile.empty ? 0.3 : (matProps.opacity ?? 1)}
          emissive={tile.faceColor}
          emissiveIntensity={emissiveIntensity}
          toneMapped={false}
        />
      </RoundedBox>
      {prefs.style === "wire" && !tile.empty && (
        <lineSegments>
          <edgesGeometry args={[boxGeo]} />
          <lineBasicMaterial color={edge} transparent opacity={dim ? 0.2 : 0.92} toneMapped={false} />
        </lineSegments>
      )}

      {/* topic label lying on the face (assembled) */}
      {showLabel && flat && (
        <Html
          transform
          occlude
          center
          scale={0.34}
          position={mul(tile.faceNormal, TILE * 0.54)}
          rotation={tile.labelRot}
          pointerEvents="none"
          zIndexRange={[16, 0]}
        >
          <div className={"s3d-face-label" + (dim ? " s3d-face-label--dim" : "")}>
            <span className="s3d-fl-name">{tile.label}</span>
            {metric ? <span className="s3d-fl-metric">{metric}</span> : null}
          </div>
        </Html>
      )}

      {/* screen-facing label (exploded / detail) */}
      {showLabel && !flat && (
        <Html center position={[0, 0, TILE * 0.56]} pointerEvents="none" zIndexRange={[16, 0]}>
          <div className={"s3d-tile-label" + (dim ? " s3d-tile-label--dim" : "")}>
            <span className="s3d-tile-name">{tile.label}</span>
            {metric ? <span className="s3d-tile-metric">{metric}</span> : null}
          </div>
        </Html>
      )}
    </group>
  );
}

export function RubikCube({ mode = "assembled", selectedKey = null, hoveredFace = null, metrics = {}, prefs = {}, autoRotateSpeed = 0.5, maxDistance = CAM.MAX, onSelectPage = () => {}, onHoverFace = () => {}, onZone = () => {} }) {
  const { tiles, columns, faceTopics } = useMemo(() => buildScene(), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(TILE, TILE, TILE), []);
  const frameGeo = useMemo(() => new THREE.BoxGeometry(FRAME, FRAME, FRAME), []);
  const haloTex = useMemo(() => makeHaloTexture(), []);
  const edge = prefs.edgeColor || GOLD;

  const corners = useMemo(() => {
    const h = FRAME / 2;
    const out = [];
    [-h, h].forEach(x => [-h, h].forEach(y => [-h, h].forEach(z => out.push([x, y, z]))));
    return out;
  }, [frameGeo]);

  return (
    <>
      <ambientLight intensity={0.25} />
      <pointLight position={[6, 7, 8]} intensity={42} color="#bfe6ff" />

      {/* Baked cube-map for metallic reflections (rendered once; the cube
          rotates against it so highlights sweep). The warm key sits at the
          real sun's position so reflections match the sun light. The <color>
          here tints the env scene only — the canvas stays transparent. */}
      <Environment resolution={64} frames={1}>
        <color attach="background" args={["#05070d"]} />
        <Lightformer intensity={2.2} color="#fff2d6" position={SUN_POS} scale={[20, 20, 1]} />
        <Lightformer intensity={0.8} color="#9fb8e0" position={[-40, -10, -60]} scale={[30, 30, 1]} />
        <Lightformer intensity={0.5} color="#7aa6ff" position={[0, -30, 20]} scale={[15, 15, 1]} />
      </Environment>

      <OrbitControls
        makeDefault
        enableZoom
        zoomSpeed={0.8}
        enablePan={mode !== "detail"}
        enableRotate
        autoRotate={mode === "assembled" && autoRotateSpeed > 0.01}
        autoRotateSpeed={autoRotateSpeed}
        rotateSpeed={0.6}
        minDistance={CAM.MIN}
        maxDistance={maxDistance}
        target={[0, 0, 0]}
      />
      <ZoneWatcher onZone={onZone} />

      {tiles.map((t) => (
        <Tile
          key={t.key}
          tile={t}
          mode={mode}
          selectedKey={selectedKey}
          hoveredFace={hoveredFace}
          metric={metrics[t.key]}
          boxGeo={boxGeo}
          prefs={prefs}
          onSelectPage={onSelectPage}
          onHoverFace={onHoverFace}
        />
      ))}

      {/* gold wireframe frame + corner glows (assembled only) */}
      {mode === "assembled" && (
        <>
          <lineSegments>
            <edgesGeometry args={[frameGeo]} />
            <lineBasicMaterial color={edge} transparent opacity={0.38} toneMapped={false} />
          </lineSegments>
          {corners.map((c, i) => (
            <sprite key={i} position={c} scale={[0.7, 0.7, 0.7]}>
              <spriteMaterial map={haloTex} color={GOLD} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </sprite>
          ))}
          <sprite scale={[5.6, 5.6, 5.6]}>
            <spriteMaterial map={haloTex} color={GOLD} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </>
      )}

      {/* topic name centered on each face (assembled only) */}
      {mode === "assembled" && faceTopics.map((f) => (
        <Html
          key={f.key}
          transform
          occlude
          center
          scale={0.4}
          position={f.pos}
          rotation={f.rot}
          pointerEvents="none"
          zIndexRange={[15, 0]}
        >
          <div
            className={"s3d-face-topic" + (hoveredFace && f.key !== hoveredFace ? " s3d-face-topic--dim" : "")}
            style={{ "--s3d-face": f.color }}
          >
            {f.label}
          </div>
        </Html>
      ))}

      {/* category column headers (stacked only) */}
      {mode === "stacked" && columns.map((c) => (
        <Html key={c.key} center position={c.pos} pointerEvents="none" zIndexRange={[18, 0]}>
          <div className="s3d-col-head" style={{ "--s3d-face": c.color }}>{c.label}</div>
        </Html>
      ))}
    </>
  );
}

export default RubikCube;
