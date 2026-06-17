/* =========================================================
   Sun — L1 set-piece. A distant warm star sitting opposite the
   black hole (at SUN_POS), with a small family of tilted orbiting
   planets. Unlike the purely additive glows elsewhere, this is the
   scene's REAL key light: a directionalLight aimed at the origin
   that physically illuminates the metallic cube and the planets'
   meshStandardMaterial surfaces.

   No ambient added here (so the directional stays directional), no
   pointer handlers, no new deps.

   Props:
     reduced — boolean, freeze planet orbits when true
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SUN_POS, ADDITIVE, makeHaloTexture } from "./celestial-shared.js";

/* Tilted orbits around the sun. r = orbit radius, speed = rad/s of
   the orbit group's spin, size/color = the planet body, tilt = orbit
   plane lean, ring = Saturn-style annulus. */
const PLANETS = [
  { r: 6, speed: 0.25, size: 0.5, color: "#9c7b5a", tilt: 0.1 },
  { r: 9, speed: 0.17, size: 0.8, color: "#6fa8c8", tilt: -0.2, ring: true },
  { r: 13, speed: 0.11, size: 0.65, color: "#c2734f", tilt: 0.05 },
  { r: 17, speed: 0.07, size: 1, color: "#d8c9a0", tilt: 0.3 },
];

export function Sun({ reduced }) {
  const halo = useMemo(() => makeHaloTexture(), []);

  /* directionalLight points position -> target; the target must be in
     the scene graph for three to use it. We add an Object3D at the
     group-local offset that cancels SUN_POS, so its WORLD position is
     ~the origin — i.e. the sun shines straight at the cube. */
  const target = useMemo(() => new THREE.Object3D(), []);

  /* One fixed random starting phase per planet, computed once so the
     orbits don't snap on re-render. */
  const phases = useMemo(() => PLANETS.map(() => Math.random() * Math.PI * 2), []);

  /* Refs to each planet's orbit group, spun in the single useFrame. */
  const orbits = useRef([]);

  useFrame((_, dt) => {
    if (reduced) return;
    for (let i = 0; i < PLANETS.length; i++) {
      const g = orbits.current[i];
      if (g) g.rotation.y += dt * PLANETS[i].speed;
    }
  });

  useEffect(() => () => halo.dispose(), [halo]);

  return (
    <group position={SUN_POS}>
      {/* real key light: position defaults to group origin (= SUN_POS),
          aimed at the in-graph target whose world pos ≈ origin */}
      <primitive object={target} position={[-60, -24, -70]} />
      <directionalLight intensity={2.4} color="#fff2d6" target={target} />

      {/* emissive sun body */}
      <mesh>
        <sphereGeometry args={[4, 32, 32]} />
        <meshBasicMaterial color="#fff0c2" toneMapped={false} />
      </mesh>

      {/* layered additive glow */}
      <sprite scale={[34, 34, 34]}>
        <spriteMaterial map={halo} color="#ffd27a" opacity={0.7} {...ADDITIVE} />
      </sprite>
      <sprite scale={[64, 64, 64]}>
        <spriteMaterial map={halo} color="#ff9a3c" opacity={0.28} {...ADDITIVE} />
      </sprite>

      {/* orbiting planets */}
      {PLANETS.map((p, i) => (
        <group
          key={i}
          ref={(el) => (orbits.current[i] = el)}
          rotation={[p.tilt, phases[i], 0]}
        >
          <mesh position={[p.r, 0, 0]}>
            <sphereGeometry args={[p.size, 24, 24]} />
            <meshStandardMaterial color={p.color} roughness={0.8} metalness={0.1} />
            {p.ring && (
              <mesh rotation={[Math.PI / 2.2, 0, 0]}>
                <ringGeometry args={[p.size * 1.4, p.size * 2.1, 48]} />
                <meshBasicMaterial
                  color="#cbb892"
                  transparent
                  opacity={0.5}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            )}
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default Sun;
