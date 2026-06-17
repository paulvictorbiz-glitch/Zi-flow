/* =========================================================
   RubikCube — L1 PRESENTATION (prop-driven, no data imports)

   A bluish-grey, alien-tech Rubik's cube whose intersections glow
   gold. Built with @react-three/fiber v8 + drei v9 (same stack and
   glow technique as dna-helix.jsx). It is PURE presentation:

   Props:
     mode        — "assembled" | "exploded" | "detail"
     selectedKey — string|null  (page tile currently opened)
     hoveredFace — string|null  (category face to spotlight)
     metrics     — { [pageKey]: string }  live mini-stat per tile
     onSelectPage(key)
     onHoverFace(faceKey|null)

   Three layout targets per tile (assembled cluster / exploded grid /
   detail corner) are interpolated every frame with THREE.MathUtils.damp
   — no animation library required.
   ========================================================= */
import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { PAGES, FACES, FACE_BY_KEY, GOLD, GOLD_BRIGHT, CUBE_BODY } from "../../lib/space-cube-config.jsx";

const SLOT_SPACING = 0.98;   // tight → solid cube look when assembled
const TILE_SIZE = 0.9;

/* 27 lattice slots (x,y,z ∈ {-1,0,1}), ordered OUTER-shell first so
   the page tiles occupy the visible slots and filler cubes hide
   inside. */
const LATTICE = (() => {
  const slots = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        slots.push([x, y, z]);
  // sort by distance from centre, descending (corners/edges first)
  slots.sort((a, b) => (b[0] ** 2 + b[1] ** 2 + b[2] ** 2) - (a[0] ** 2 + a[1] ** 2 + a[2] ** 2));
  return slots;
})();

/* Build the full tile set once: real page tiles + filler cubes that
   only exist to complete the cube in the assembled state. */
function buildTiles() {
  const tiles = [];

  // exploded-grid coordinates: one column per face, pages stacked
  const byFace = FACES.map(f => PAGES.filter(p => p.face === f.key));

  byFace.forEach((pages, fi) => {
    pages.forEach((p, r) => {
      const n = pages.length;
      tiles.push({
        key: p.key,
        isPage: true,
        label: p.label,
        face: p.face,
        link: p.link,
        faceColor: FACE_BY_KEY[p.face].color,
        explodedPos: [(fi - 2.5) * 1.55, ((n - 1) / 2 - r) * 1.25, 0],
        // assembledPos filled below from lattice
        assembledPos: [0, 0, 0],
      });
    });
  });

  // assign lattice slots: pages first (outer), then fillers
  tiles.forEach((t, i) => {
    const [x, y, z] = LATTICE[i] || [0, 0, 0];
    t.assembledPos = [x * SLOT_SPACING, y * SLOT_SPACING, z * SLOT_SPACING];
  });

  // filler cubes for the remaining inner slots
  for (let i = tiles.length; i < LATTICE.length; i++) {
    const [x, y, z] = LATTICE[i];
    tiles.push({
      key: "filler-" + i,
      isPage: false,
      label: "",
      face: null,
      link: null,
      faceColor: CUBE_BODY,
      explodedPos: [x * 2.4, y * 2.4, z * 2.4],
      assembledPos: [x * SLOT_SPACING, y * SLOT_SPACING, z * SLOT_SPACING],
    });
  }

  return tiles;
}

function tileTarget(tile, mode, selectedKey) {
  if (mode === "assembled") return { pos: tile.assembledPos, scale: 1 };
  if (mode === "exploded") return { pos: tile.explodedPos, scale: tile.isPage ? 0.62 : 0.0001 };
  // detail
  if (tile.key === selectedKey) return { pos: [4.2, 2.55, 0.4], scale: 0.6 };
  return { pos: tile.explodedPos, scale: 0.0001 };
}

/* Reusable additive halo sprite texture (fake bloom), same recipe as
   dna-helix.jsx. */
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

function Tile({ tile, mode, selectedKey, hoveredFace, metric, boxGeo, onSelectPage, onHoverFace }) {
  const ref = useRef();
  const target = tileTarget(tile, mode, selectedKey);
  const dim = hoveredFace && tile.face !== hoveredFace;
  const isSelected = tile.key === selectedKey;

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const lambda = 5;
    g.position.x = THREE.MathUtils.damp(g.position.x, target.pos[0], lambda, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, target.pos[1], lambda, delta);
    g.position.z = THREE.MathUtils.damp(g.position.z, target.pos[2], lambda, delta);
    const s = THREE.MathUtils.damp(g.scale.x, target.scale, lambda, delta);
    g.scale.setScalar(Math.max(s, 0.0001));
    // face the camera once spread out
    const ry = mode === "assembled" ? 0 : THREE.MathUtils.damp(g.rotation.y, 0, lambda, delta);
    g.rotation.y = ry;
  });

  const showLabel = mode !== "assembled" && tile.isPage && target.scale > 0.05;
  const emissiveI = isSelected ? 1.4 : dim ? 0.25 : tile.isPage ? 0.7 : 0.2;

  return (
    <group ref={ref} position={tile.assembledPos}>
      <mesh
        onClick={tile.isPage ? (e) => { e.stopPropagation(); onSelectPage(tile.key); } : undefined}
        onPointerOver={tile.isPage ? (e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; onHoverFace(tile.face); } : undefined}
        onPointerOut={tile.isPage ? (e) => { e.stopPropagation(); document.body.style.cursor = "auto"; onHoverFace(null); } : undefined}
      >
        <boxGeometry args={[TILE_SIZE, TILE_SIZE, TILE_SIZE]} />
        <meshStandardMaterial
          color={CUBE_BODY}
          emissive={tile.faceColor}
          emissiveIntensity={emissiveI}
          roughness={0.45}
          metalness={0.35}
          toneMapped={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[boxGeo]} />
        <lineBasicMaterial color={isSelected ? GOLD_BRIGHT : GOLD} transparent opacity={dim ? 0.2 : 0.9} toneMapped={false} />
      </lineSegments>
      {showLabel && (
        <Html center distanceFactor={6} zIndexRange={[20, 0]} pointerEvents="none">
          <div className={"s3d-tile-label" + (dim ? " s3d-tile-label--dim" : "")}>
            <span className="s3d-tile-name">{tile.label}</span>
            {metric ? <span className="s3d-tile-metric">{metric}</span> : null}
          </div>
        </Html>
      )}
    </group>
  );
}

export function RubikCube({ mode = "assembled", selectedKey = null, hoveredFace = null, metrics = {}, onSelectPage = () => {}, onHoverFace = () => {} }) {
  const tiles = useMemo(() => buildTiles(), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE), []);
  const haloTex = useMemo(() => makeHaloTexture(), []);
  const spinner = useRef();

  useFrame((_, delta) => {
    if (!spinner.current) return;
    // gentle auto-rotate only while assembled; ease to rest otherwise
    if (mode === "assembled") {
      spinner.current.rotation.y += delta * 0.18;
      spinner.current.rotation.x = THREE.MathUtils.damp(spinner.current.rotation.x, -0.18, 4, delta);
    } else {
      spinner.current.rotation.y = THREE.MathUtils.damp(spinner.current.rotation.y, 0, 4, delta);
      spinner.current.rotation.x = THREE.MathUtils.damp(spinner.current.rotation.x, 0, 4, delta);
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[6, 7, 8]} intensity={55} color="#bfe6ff" />
      <pointLight position={[-7, -5, -4]} intensity={30} color="#ffd27a" />

      <group ref={spinner}>
        {tiles.map((t) => (
          <Tile
            key={t.key}
            tile={t}
            mode={mode}
            selectedKey={selectedKey}
            hoveredFace={hoveredFace}
            metric={metrics[t.key]}
            boxGeo={boxGeo}
            onSelectPage={onSelectPage}
            onHoverFace={onHoverFace}
          />
        ))}

        {/* gold core glow — vibrant but subtle, only while assembled */}
        {mode === "assembled" && (
          <sprite scale={[5.2, 5.2, 5.2]}>
            <spriteMaterial map={haloTex} color={GOLD} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        )}
      </group>
    </>
  );
}

export default RubikCube;
