/* =========================================================
   DnaHelix — L1 PRESENTATION (prop-driven, no data imports)

   A premium, neon-glow double-helix built with @react-three/fiber (v8)
   + drei (v9), set inside a warm "mitochondria cell" environment. It is
   purely presentation: ALL data arrives via props. It must NOT import
   reel-dna-demo.jsx.

   Structure:
     - two continuous glowing STRANDS (tube geometry, not dots)
     - faint decorative ladder rungs for density
     - each GENE is one CROSSBAR (base-pair rung): two nucleotide
       molecules labelled with ACTG bases, tinted by the gene's identity
       colour, interactive (hover/click drives the timeline highlight)
     - the whole helix is tilted and pushed back; warm floating "motes"
       add cellular depth

   Props:
     genes        — [{ key, label, color (hex), helixT (0..1), ... }]
     hoveredGene  — string|null  (active gene key, parent-controlled)
     onHoverGene  — (key|null) => void
     onSelectGene — (key) => void
     slowOnHover  — bool: ease the spin to ~20% while the pointer is over
                    the helix so a crossbar is easy to catch

   Notes:
     - @react-three/postprocessing is NOT installed, so the "bloom" is
       faked with emissive materials + additive-blended sprite halos.
     - WebGL-unavailable is handled gracefully via a feature check +
       internal error boundary so it never throws on mount.
   ========================================================= */
import React, { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/* ---- helix geometry constants ---- */
const HELIX_HEIGHT = 9;        // total vertical extent (Y)
const HELIX_RADIUS = 1.7;      // strand radius
const TURNS = 3.2;             // number of full twists top→bottom
const STRAND_SAMPLES = 200;    // curve resolution for the tube strands
const RUNG_EVERY = 0.055;      // decorative ladder spacing (in t units)

/* ACTG base palette (the "molecular" colours) + complementary pairs. Each
   gene is assigned a pair, cycling, so the ladder reads as real DNA. */
const BASE_COLOR = { A: "#5dff8f", T: "#ff6b8a", C: "#5db4ff", G: "#ffcf5d" };
const PAIRS = [["A", "T"], ["C", "G"], ["T", "A"], ["G", "C"]];

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

/* ---------- One continuous glowing strand (tube, not dots) ---------- */
function StrandTube({ phase, color }) {
  const geometry = useMemo(() => {
    const pts = [];
    for (let i = 0; i < STRAND_SAMPLES; i++) {
      pts.push(strandPoint(i / (STRAND_SAMPLES - 1), phase));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(curve, 280, 0.06, 10, false);
  }, [phase]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.3}
        roughness={0.35}
        metalness={0.2}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ---------- Faint decorative ladder rungs (density between genes) ------ */
function LadderRungs({ color }) {
  const geometry = useMemo(() => {
    const positions = [];
    for (let t = 0; t <= 1.0001; t += RUNG_EVERY) {
      const a = strandPoint(t, 0);
      const b = strandPoint(t, Math.PI);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.12} toneMapped={false} />
    </lineSegments>
  );
}

/* ---------- Soft radial sprite texture (fake bloom / motes) ---------- */
function makeHaloTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* ---------- Billboarded ACTG letter texture ---------- */
function makeLetterTexture(letter, color) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // coloured glow
  ctx.font = "bold 92px ui-sans-serif, 'Segoe UI', system-ui, sans-serif";
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.fillText(letter, size / 2, size / 2 + 6);
  // crisp white core
  ctx.shadowBlur = 0;
  ctx.font = "bold 84px ui-sans-serif, 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(letter, size / 2, size / 2 + 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* ---------- A gene = one interactive base-pair CROSSBAR ---------- */
function GeneCrossbar({ gene, bases, isActive, anyHovered, onHover, onSelect, haloTex, letterTex }) {
  const group = useRef();
  const t = typeof gene.helixT === "number" ? gene.helixT : 0.5;

  // Place + orient the crossbar so its local +Y runs strandA→strandB.
  const { mid, rotation, len } = useMemo(() => {
    const a = strandPoint(t, 0);
    const b = strandPoint(t, Math.PI);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const L = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    const e = new THREE.Euler().setFromQuaternion(q);
    return { mid: [m.x, m.y, m.z], rotation: [e.x, e.y, e.z], len: L };
  }, [t]);

  const targetScale = isActive ? 1.35 : anyHovered ? 0.82 : 1;
  useFrame(() => {
    if (!group.current) return;
    const s = THREE.MathUtils.lerp(group.current.scale.x, targetScale, 0.18);
    group.current.scale.setScalar(s);
  });

  const [b1, b2] = bases;
  const c1 = BASE_COLOR[b1];
  const c2 = BASE_COLOR[b2];
  const off = len * 0.28;
  const letterOpacity = anyHovered && !isActive ? 0.45 : 1;

  return (
    <group
      ref={group}
      position={mid}
      rotation={rotation}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; onHover(gene.key); }}
      onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = "auto"; onHover(null); }}
      onClick={(e) => { e.stopPropagation(); onSelect(gene.key); }}
    >
      {/* bond — tinted by the gene's identity colour */}
      <mesh>
        <cylinderGeometry args={[0.045, 0.045, len * 0.84, 10]} />
        <meshStandardMaterial
          color={gene.color}
          emissive={gene.color}
          emissiveIntensity={isActive ? 2.6 : 1.3}
          roughness={0.4}
          toneMapped={false}
        />
      </mesh>

      {/* two nucleotide molecules (ACTG), one near each strand */}
      <mesh position={[0, -off, 0]}>
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshStandardMaterial color={c1} emissive={c1} emissiveIntensity={isActive ? 2.8 : 1.7} toneMapped={false} />
      </mesh>
      <mesh position={[0, off, 0]}>
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshStandardMaterial color={c2} emissive={c2} emissiveIntensity={isActive ? 2.8 : 1.7} toneMapped={false} />
      </mesh>

      {/* base letters — billboarded so they stay readable as it spins */}
      <sprite position={[0, -off, 0]} scale={[0.52, 0.52, 0.52]}>
        <spriteMaterial map={letterTex[b1]} transparent depthWrite={false} depthTest={false} opacity={letterOpacity} toneMapped={false} />
      </sprite>
      <sprite position={[0, off, 0]} scale={[0.52, 0.52, 0.52]}>
        <spriteMaterial map={letterTex[b2]} transparent depthWrite={false} depthTest={false} opacity={letterOpacity} toneMapped={false} />
      </sprite>

      {/* centre glow halo */}
      <sprite scale={[1.9, 1.9, 1.9]}>
        <spriteMaterial
          map={haloTex}
          color={gene.color}
          transparent
          opacity={isActive ? 0.9 : 0.38}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

/* ---------- Warm floating motes (in-cell depth) ---------- */
function Motes({ tex }) {
  const ref = useRef();
  const geometry = useMemo(() => {
    const N = 60;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 13;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 9 - 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    const tt = state.clock.elapsedTime;
    ref.current.rotation.y = tt * 0.02;
    ref.current.position.y = Math.sin(tt * 0.15) * 0.25;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={0.5}
        map={tex}
        color="#ff9a6b"
        transparent
        opacity={0.5}
        depthWrite={false}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/* ---------- The rotating helix scene ---------- */
function HelixScene({ genes, hoveredGene, onHoverGene, onSelectGene, spinFactor = 1 }) {
  const spinner = useRef();
  const haloTex = useMemo(() => makeHaloTexture(), []);
  const letterTex = useMemo(() => {
    const m = {};
    Object.keys(BASE_COLOR).forEach((L) => { m[L] = makeLetterTexture(L, BASE_COLOR[L]); });
    return m;
  }, []);
  const strandColorA = "#56e6ff";
  const strandColorB = "#9b8cff";

  // Auto-spin. `spinFactor` lets the parent ease the rotation off on hover
  // (slow-on-hover) so a moving crossbar is easier to catch.
  useFrame((_, delta) => {
    if (spinner.current) spinner.current.rotation.y += delta * 0.22 * spinFactor;
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 6, 6]} intensity={45} color="#9fefff" />
      <pointLight position={[-6, -4, -4]} intensity={28} color="#b59bff" />
      {/* warm cell backlight */}
      <pointLight position={[0, -2, -6]} intensity={24} color="#ff7a4d" />

      {/* static tilt: lean + recede so the helix reads at a 3/4 angle */}
      <group rotation={[0.18, 0, 0.2]}>
        <group ref={spinner}>
          <StrandTube phase={0} color={strandColorA} />
          <StrandTube phase={Math.PI} color={strandColorB} />
          <LadderRungs color="#7fd9ff" />

          {(genes || []).map((g, i) => (
            <GeneCrossbar
              key={g.key}
              gene={g}
              bases={PAIRS[i % PAIRS.length]}
              isActive={hoveredGene === g.key}
              anyHovered={hoveredGene != null}
              onHover={onHoverGene}
              onSelect={onSelectGene}
              haloTex={haloTex}
              letterTex={letterTex}
            />
          ))}
        </group>
      </group>

      <Motes tex={haloTex} />

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
export function DnaHelix({
  genes = [],
  hoveredGene = null,
  onHoverGene = () => {},
  onSelectGene = () => {},
  slowOnHover = false,
}) {
  const [glOk] = useState(() => webglAvailable());
  const [hovering, setHovering] = useState(false);

  if (!glOk) {
    return (
      <div className="dna-helix dna-helix--fallback">
        <Fallback />
      </div>
    );
  }

  // Ease the spin down to ~20% while the pointer is over the helix so the
  // crossbar you're reaching for slows to a catchable pace, then resume.
  const spinFactor = slowOnHover && hovering ? 0.2 : 1;

  return (
    <div
      className="dna-helix"
      style={{ width: "100%", height: "100%" }}
      onMouseEnter={slowOnHover ? () => setHovering(true) : undefined}
      onMouseLeave={slowOnHover ? () => setHovering(false) : undefined}
    >
      <GLBoundary fallback={<Fallback />}>
        <Suspense fallback={null}>
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 0, 10.5], fov: 50 }}
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
              spinFactor={spinFactor}
            />
          </Canvas>
        </Suspense>
      </GLBoundary>
    </div>
  );
}

export default DnaHelix;
