/* =========================================================
   SpaceBattle — L2 decorative set-piece for the /space scene.

   A small, stylized space-battle vignette floating ABOVE the cube,
   built ONLY from three.js primitives (no model assets, no deps):
     · a dark Death-Star-like station (background)
     · 4 alien ships that warp in from hyperspace, then drift + bob
     · 3 additive energy beams that strobe between ship pairs

   Budget: a few hundred tris, ~10 draw calls, no textures. All
   per-frame math reuses scratch vectors/quaternions from useMemo to
   avoid GC churn. Respects `reduced` (parks ships, kills motion/beams).
   ========================================================= */
import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ADDITIVE } from "./celestial-shared.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export default function SpaceBattle({ reduced }) {
  const shipRefs = useRef([]);
  const beamRefs = useRef([]);
  const tRef = useRef(0);

  /* Each ship warps in from `from`, easing out to `to`, then bobs. */
  const ships = useMemo(
    () => [
      { from: [-14, -2, -6], to: [-4, 1, 0], scale: 0.7, delay: 0, emissive: "#56ff7a" },
      { from: [13, 3, -4], to: [5, -1, 2], scale: 0.6, delay: 1.4, emissive: "#ff4d4d" },
      { from: [-8, 5, -10], to: [-1, 3, -2], scale: 0.5, delay: 2.7, emissive: "#56ff7a" },
      { from: [10, -4, -8], to: [3, -3, -1], scale: 0.55, delay: 0.7, emissive: "#ff4d4d" },
    ],
    []
  );

  /* Energy beams between ship pairs; strobe on a per-beam duty cycle. */
  const beams = useMemo(
    () => [
      { a: 0, b: 1, color: "#ff4d4d", period: 1.8, on: 0.18 },
      { a: 2, b: 3, color: "#56ff7a", period: 2.3, on: 0.14 },
      { a: 1, b: 2, color: "#ff4d4d", period: 1.5, on: 0.12 },
    ],
    []
  );

  /* Reusable scratch — created once, reused every frame (no per-frame
     allocation in useFrame). */
  const scratch = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      q: new THREE.Quaternion(),
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
    }),
    []
  );

  useFrame((state, dt) => {
    const ss = scratch;

    /* Reduced-motion: park every ship at its destination, no beams. */
    if (reduced) {
      for (let i = 0; i < ships.length; i++) {
        const g = shipRefs.current[i];
        if (!g) continue;
        const s = ships[i];
        g.position.set(s.to[0], s.to[1], s.to[2]);
        g.scale.setScalar(s.scale);
        g.lookAt(0, 0, 0);
      }
      for (let i = 0; i < beams.length; i++) {
        const m = beamRefs.current[i];
        if (m) m.visible = false;
      }
      return;
    }

    tRef.current += dt;
    const t = tRef.current;

    /* Ships: warp-in ease-out + gentle bob, always facing the origin. */
    for (let i = 0; i < ships.length; i++) {
      const g = shipRefs.current[i];
      if (!g) continue;
      const s = ships[i];
      const k = clamp((t - s.delay) / 1.2, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      ss.from.set(s.from[0], s.from[1], s.from[2]);
      ss.to.set(s.to[0], s.to[1], s.to[2]);
      g.position.lerpVectors(ss.from, ss.to, e);
      g.position.y += Math.sin(t * 1.3 + i) * 0.3;
      g.scale.setScalar(s.scale * (0.2 + 0.8 * k));
      g.lookAt(0, 0, 0);
    }

    /* Beams: strobe between two ships' current positions. */
    for (let i = 0; i < beams.length; i++) {
      const m = beamRefs.current[i];
      if (!m) continue;
      const bm = beams[i];
      const visible = (t % bm.period) / bm.period < bm.on;
      m.visible = visible;
      if (!visible) continue;

      const ga = shipRefs.current[bm.a];
      const gb = shipRefs.current[bm.b];
      if (!ga || !gb) {
        m.visible = false;
        continue;
      }
      ss.a.copy(ga.position);
      ss.b.copy(gb.position);
      ss.mid.addVectors(ss.a, ss.b).multiplyScalar(0.5);
      m.position.copy(ss.mid);
      ss.dir.subVectors(ss.b, ss.a);
      const len = ss.dir.length();
      ss.dir.normalize();
      ss.q.setFromUnitVectors(ss.up, ss.dir);
      m.quaternion.copy(ss.q);
      m.scale.y = len;
    }
  });

  return (
    <group position={[0, 30, -20]} scale={0.8}>
      {/* Death-Star-like station (background) */}
      <group position={[6, 2, -6]}>
        <mesh>
          <sphereGeometry args={[5, 32, 24]} />
          <meshStandardMaterial color="#3a3f47" roughness={0.9} metalness={0.3} />
        </mesh>
        {/* Equatorial trench */}
        <mesh>
          <torusGeometry args={[5.02, 0.18, 8, 64]} />
          <meshStandardMaterial color="#23262b" roughness={0.95} metalness={0.2} />
        </mesh>
        {/* Superlaser dish crater on the upper surface */}
        <mesh position={[-1.8, 3.6, 1.8]} rotation={[-Math.PI / 4, 0, Math.PI / 4]}>
          <sphereGeometry args={[1.3, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#23262b" roughness={0.9} metalness={0.25} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* 4 alien ships */}
      {ships.map((s, i) => (
        <group key={i} ref={(el) => (shipRefs.current[i] = el)}>
          <mesh>
            <coneGeometry args={[0.5, 1.6, 6]} />
            <meshStandardMaterial
              color="#2a2d33"
              metalness={0.6}
              roughness={0.4}
              emissive={s.emissive}
              emissiveIntensity={0.4}
            />
          </mesh>
        </group>
      ))}

      {/* 3 energy beams (default-hidden; toggled in the frame loop) */}
      {beams.map((bm, i) => (
        <mesh key={i} ref={(el) => (beamRefs.current[i] = el)} visible={false}>
          <cylinderGeometry args={[0.04, 0.04, 1, 6]} />
          <meshBasicMaterial color={bm.color} {...ADDITIVE} />
        </mesh>
      ))}
    </group>
  );
}
