/* =========================================================
   AmbientEvents — L1 "360° fill" set-pieces for the /space scene.

   A scatter of cheap, mostly billboard/sprite-based events placed from
   SCENE config across every octant, so no orbit angle is empty:
     · distant spiral galaxies (slowly rotating sprites)
     · comets (a drifting train of fading halos with a bright head)
     · a periodic supernova (flash + expanding shell)
     · a ringed-planet flyby (slowly drifting across the far field)
     · a field of shooting stars (timed fast streaks)

   Everything is additive + cheap. All motion freezes when `reduced`.
   Shooting-star count comes from the QUALITY tier.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  ADDITIVE,
  makeHaloTexture,
  makeGalaxyTexture,
  makeRingTexture,
} from "./celestial-shared.js";
import { AMBIENT, QUALITY } from "../../lib/space-cube-config.jsx";

const TRAIL = 6; // halos per comet tail

function Galaxy({ ev, reduced, tex }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (reduced || !ref.current) return;
    ref.current.material.rotation += dt * ev.spin;
  });
  return (
    <sprite ref={ref} position={ev.position} scale={[ev.scale, ev.scale, 1]}>
      <spriteMaterial map={tex} color={ev.color} opacity={0.7} {...ADDITIVE} />
    </sprite>
  );
}

function Comet({ ev, reduced, tex }) {
  const groupRef = useRef();
  const dir = useMemo(() => new THREE.Vector3(...ev.dir).normalize(), [ev.dir]);
  const start = useMemo(() => new THREE.Vector3(...ev.position), [ev.position]);
  const dRef = useRef(Math.random() * ev.span);

  useFrame((_, dt) => {
    if (reduced || !groupRef.current) return;
    dRef.current += dt * ev.speed;
    if (dRef.current > ev.span) dRef.current -= ev.span;
    groupRef.current.position.set(
      start.x + dir.x * dRef.current - (dir.x * ev.span) / 2,
      start.y + dir.y * dRef.current - (dir.y * ev.span) / 2,
      start.z + dir.z * dRef.current - (dir.z * ev.span) / 2,
    );
  });

  return (
    <group ref={groupRef}>
      {/* bright head */}
      <sprite scale={[5, 5, 1]}>
        <spriteMaterial map={tex} color={ev.color} opacity={0.95} {...ADDITIVE} />
      </sprite>
      {/* fading tail, trailing opposite to motion */}
      {Array.from({ length: TRAIL }).map((_, i) => {
        const f = (i + 1) / TRAIL;
        return (
          <sprite
            key={i}
            position={[-dir.x * f * 14, -dir.y * f * 14, -dir.z * f * 14]}
            scale={[5 * (1 - f * 0.7), 5 * (1 - f * 0.7), 1]}
          >
            <spriteMaterial map={tex} color={ev.color} opacity={0.6 * (1 - f)} {...ADDITIVE} />
          </sprite>
        );
      })}
    </group>
  );
}

function Supernova({ ev, reduced, halo, ring }) {
  const coreRef = useRef();
  const shellRef = useRef();
  useFrame((state) => {
    if (reduced) {
      if (coreRef.current) coreRef.current.material.opacity = 0.4;
      if (shellRef.current) shellRef.current.visible = false;
      return;
    }
    const tau = state.clock.elapsedTime % ev.period;
    const k = tau / ev.period;
    // sharp flash at the start of each cycle, long decay
    if (coreRef.current) coreRef.current.material.opacity = Math.max(0, 1 - k * 1.6);
    if (shellRef.current) {
      const vis = k < 0.6;
      shellRef.current.visible = vis;
      if (vis) {
        const s = ev.scale * (1 + k * 6);
        shellRef.current.scale.set(s, s, 1);
        shellRef.current.material.opacity = Math.max(0, 0.8 * (1 - k / 0.6));
      }
    }
  });
  return (
    <group position={ev.position}>
      <sprite ref={coreRef} scale={[ev.scale * 2.4, ev.scale * 2.4, 1]}>
        <spriteMaterial map={halo} color={ev.color} opacity={0.6} {...ADDITIVE} />
      </sprite>
      <sprite ref={shellRef} scale={[ev.scale, ev.scale, 1]}>
        <spriteMaterial map={ring} color="#ffd9a0" opacity={0} {...ADDITIVE} />
      </sprite>
    </group>
  );
}

function RingedPlanet({ ev, reduced }) {
  const ref = useRef();
  const drift = useRef(0);
  useFrame((_, dt) => {
    if (reduced || !ref.current) return;
    drift.current += dt * 0.6;
    ref.current.position.x = ev.position[0] + Math.sin(drift.current * 0.06) * 24;
    ref.current.rotation.y += dt * 0.08;
  });
  return (
    <group ref={ref} position={ev.position} rotation={[0.4, 0, 0.3]}>
      <mesh>
        <sphereGeometry args={[ev.scale, 32, 32]} />
        <meshStandardMaterial color={ev.color} roughness={0.85} metalness={0.1}
          emissive={ev.color} emissiveIntensity={0.12} />
      </mesh>
      <mesh rotation={[Math.PI / 2.2, 0, 0]}>
        <ringGeometry args={[ev.scale * 1.5, ev.scale * 2.4, 64]} />
        <meshBasicMaterial color={ev.ringColor} transparent opacity={0.55}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ShootingStars({ count, reduced, tex }) {
  const refs = useRef([]);
  const stars = useMemo(() => Array.from({ length: count }, (_, i) => ({
    t: -i * 2.5,                 // staggered first appearance
    period: 6 + i * 1.7,
    travel: 80 + Math.random() * 60,
    // a random far-field origin + screen-ish direction
    ox: (Math.random() - 0.5) * 240,
    oy: 60 + Math.random() * 60,
    oz: (Math.random() - 0.5) * 240,
    dx: (Math.random() - 0.5),
    dy: -0.6 - Math.random() * 0.5,
    dz: (Math.random() - 0.5),
  })), [count]);

  useFrame((_, dt) => {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const m = refs.current[i];
      if (!m) continue;
      if (reduced) { m.visible = false; continue; }
      s.t += dt;
      const tau = ((s.t % s.period) + s.period) % s.period;
      const active = tau < 1.1;            // brief streak each period
      m.visible = active;
      if (!active) continue;
      const k = tau / 1.1;
      const d = k * s.travel;
      m.position.set(s.ox + s.dx * d, s.oy + s.dy * d, s.oz + s.dz * d);
      m.material.opacity = Math.sin(k * Math.PI) * 0.9; // fade in/out
      const sc = 3 + (1 - k) * 3;
      m.scale.set(sc, sc, 1);
    }
  });

  return (
    <>
      {stars.map((_, i) => (
        <sprite key={i} ref={(el) => (refs.current[i] = el)} visible={false}>
          <spriteMaterial map={tex} color="#eaf2ff" {...ADDITIVE} />
        </sprite>
      ))}
    </>
  );
}

export default function AmbientEvents({ reduced = false, quality = "high" }) {
  const q = QUALITY[quality] || QUALITY.high;
  const halo = useMemo(() => makeHaloTexture(), []);
  const galaxyTex = useMemo(() => makeGalaxyTexture(), []);
  const ringTex = useMemo(() => makeRingTexture(0.42, 0.49), []);
  useEffect(() => () => { halo.dispose(); galaxyTex.dispose(); ringTex.dispose(); }, [halo, galaxyTex, ringTex]);

  return (
    <>
      {AMBIENT.map((ev) => {
        if (ev.kind === "galaxy") return <Galaxy key={ev.key} ev={ev} reduced={reduced} tex={galaxyTex} />;
        if (ev.kind === "comet") return <Comet key={ev.key} ev={ev} reduced={reduced} tex={halo} />;
        if (ev.kind === "supernova") return <Supernova key={ev.key} ev={ev} reduced={reduced} halo={halo} ring={ringTex} />;
        if (ev.kind === "ringedPlanet") return <RingedPlanet key={ev.key} ev={ev} reduced={reduced} />;
        return null;
      })}
      <ShootingStars count={q.shootingStars} reduced={reduced} tex={halo} />
    </>
  );
}
