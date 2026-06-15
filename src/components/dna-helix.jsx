/* =========================================================
   DnaHelix — L1 PRESENTATION (prop-driven, no data imports)

   A premium-black, neon-glow double-helix particle structure built
   with @react-three/fiber (v8) + drei (v9). It is purely presentation:
   ALL data arrives via props. It must NOT import reel-dna-demo.jsx.

   Props:
     genes        — [{ key, label, color (hex), helixT (0..1), ... }]
     hoveredGene  — string|null  (active gene key, parent-controlled)
     onHoverGene  — (key|null) => void
     onSelectGene — (key) => void

   Notes:
     - @react-three/postprocessing is NOT installed, so the "bloom" is
       faked with emissive materials + additive-blended sprite halos.
     - WebGL-unavailable is handled gracefully via a feature check +
       internal error boundary so it never throws on mount.
   ========================================================= */
import React, { Suspense, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/* ---- helix geometry constants ---- */
const HELIX_HEIGHT = 9;        // total vertical extent (Y)
const HELIX_RADIUS = 1.7;      // strand radius
const TURNS = 3.2;             // number of full twists top→bottom
const PARTICLES_PER_STRAND = 160;
const RUNG_EVERY = 10;         // connector every Nth particle index

/* Map a t in 0..1 to a point on a strand. phase shifts the 2nd strand. */
function strandPoint(t, phase) {
  const angle = t * Math.PI * 2 * TURNS + phase;
  const y = HELIX_HEIGHT * (0.5 - t); // top (+) → bottom (-)
  return new THREE.Vector3(
    Math.cos(angle) * HELIX_RADIUS,
    y,
    Math.sin(angle) * HELIX_RADIUS
  );
}

/* ---------- A single strand of instanced particles ---------- */
function Strand({ phase, color }) {
  const ref = useRef();
  const points = useMemo(() => {
    const arr = [];
    for (let i = 0; i < PARTICLES_PER_STRAND; i++) {
      arr.push(strandPoint(i / (PARTICLES_PER_STRAND - 1), phase));
    }
    return arr;
  }, [phase]);

  useMemo(() => {
    // write instance matrices once
    if (!ref.current) return;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const onRef = useCallback(
    (mesh) => {
      ref.current = mesh;
      if (!mesh) return;
      points.forEach((p, i) => {
        dummy.position.copy(p);
        dummy.scale.setScalar(0.85);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    [points, dummy]
  );

  return (
    <instancedMesh ref={onRef} args={[null, null, PARTICLES_PER_STRAND]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.6}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

/* ---------- Faint rung connectors between the two strands ---------- */
function Rungs({ color }) {
  const geometry = useMemo(() => {
    const positions = [];
    for (let i = 0; i < PARTICLES_PER_STRAND; i += RUNG_EVERY) {
      const t = i / (PARTICLES_PER_STRAND - 1);
      const a = strandPoint(t, 0);
      const b = strandPoint(t, Math.PI);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    return g;
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.18}
        toneMapped={false}
      />
    </lineSegments>
  );
}

/* ---------- Reusable additive halo sprite (fake bloom) ---------- */
function makeHaloTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* ---------- A single interactive gene node ---------- */
function GeneNode({ gene, position, isActive, anyHovered, onHover, onSelect, haloTex }) {
  const group = useRef();
  const haloRef = useRef();
  const targetScale = isActive ? 1.5 : anyHovered ? 0.78 : 1;

  useFrame(() => {
    if (!group.current) return;
    const s = group.current.scale.x;
    const next = THREE.MathUtils.lerp(s, targetScale, 0.18);
    group.current.scale.setScalar(next);
    if (haloRef.current) {
      const ho = THREE.MathUtils.lerp(
        haloRef.current.material.opacity,
        isActive ? 0.95 : anyHovered ? 0.25 : 0.55,
        0.18
      );
      haloRef.current.material.opacity = ho;
    }
  });

  return (
    <group
      ref={group}
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(gene.key);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "auto";
        onHover(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(gene.key);
      }}
    >
      {/* core glowing sphere */}
      <mesh>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshStandardMaterial
          color={gene.color}
          emissive={gene.color}
          emissiveIntensity={isActive ? 3.2 : 1.8}
          toneMapped={false}
        />
      </mesh>
      {/* additive halo sprite = fake bloom */}
      <sprite ref={haloRef} scale={[1.4, 1.4, 1.4]}>
        <spriteMaterial
          map={haloTex}
          color={gene.color}
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

/* ---------- The rotating helix scene ---------- */
function HelixScene({ genes, hoveredGene, onHoverGene, onSelectGene }) {
  const spinner = useRef();
  const haloTex = useMemo(() => makeHaloTexture(), []);
  const strandColorA = "#56e6ff";
  const strandColorB = "#9b8cff";

  useFrame((_, delta) => {
    if (spinner.current) spinner.current.rotation.y += delta * 0.22;
  });

  const nodePositions = useMemo(
    () =>
      (genes || []).map((g, i) => {
        // alternate which strand each node lands on for visual balance
        const phase = i % 2 === 0 ? 0 : Math.PI;
        const t = typeof g.helixT === "number" ? g.helixT : i / Math.max(1, genes.length - 1);
        return strandPoint(t, phase);
      }),
    [genes]
  );

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[5, 6, 6]} intensity={45} color="#9fefff" />
      <pointLight position={[-6, -4, -4]} intensity={28} color="#b59bff" />

      <group ref={spinner}>
        <Strand phase={0} color={strandColorA} />
        <Strand phase={Math.PI} color={strandColorB} />
        <Rungs color="#7fd9ff" />

        {(genes || []).map((g, i) => (
          <GeneNode
            key={g.key}
            gene={g}
            position={nodePositions[i]}
            isActive={hoveredGene === g.key}
            anyHovered={hoveredGene != null}
            onHover={onHoverGene}
            onSelect={onSelectGene}
            haloTex={haloTex}
          />
        ))}
      </group>

      <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
    </>
  );
}

/* ---------- Minimal internal error boundary (WebGL safety) ---------- */
class GLBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* swallow — we render a graceful fallback instead of crashing */
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function Fallback() {
  return (
    <div className="dna-helix__fallback">
      <span>3D helix unavailable</span>
      <small>Your browser/device can't render WebGL right now.</small>
    </div>
  );
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/* ---------- Public component ---------- */
export function DnaHelix({ genes = [], hoveredGene = null, onHoverGene = () => {}, onSelectGene = () => {} }) {
  const [glOk] = useState(() => webglAvailable());

  if (!glOk) {
    return (
      <div className="dna-helix dna-helix--fallback">
        <Fallback />
      </div>
    );
  }

  return (
    <div className="dna-helix" style={{ width: "100%", height: "100%" }}>
      <GLBoundary fallback={<Fallback />}>
        <Suspense fallback={null}>
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 0, 8.5], fov: 50 }}
            gl={{ antialias: true, alpha: true }}
            onCreated={({ gl }) => {
              gl.setClearColor(0x000000, 0);
            }}
            style={{ background: "transparent" }}
          >
            <HelixScene
              genes={genes}
              hoveredGene={hoveredGene}
              onHoverGene={onHoverGene}
              onSelectGene={onSelectGene}
            />
          </Canvas>
        </Suspense>
      </GLBoundary>
    </div>
  );
}

export default DnaHelix;
