/* =========================================================
   Galaxy — L1 PRESENTATION (prop-driven, no data imports)

   A realistic Milky-Way backdrop for the /space scene, rendered
   as a child INSIDE the transparent Canvas (behind the cube).

   @react-three/fiber v8 + three 0.166. Pure presentation.

   Tree:
     DistantStars   — static spherical shell of GPU-twinkling points
     group @ GALAXY_Z (Sgr A*):
       BlackHole    — black event-horizon sphere
       CoreGlow     — additive bulge halos (canvas radial-gradient)
       group (DISK_TILT, static):
         PhotonRing — warm-white additive ring
         spinRef group (slow Y spin, frozen when reduced):
           AccretionDisk — flattened particle torus, hot->cool
           NearStars     — sparse bulge points (co-rotate, parallax)
     Asteroids      — near-camera low-poly meshes, straight-line drift+loop

   Props:
     reduced (bool)  — freeze spin/asteroids/twinkle when true
     bg (string)     — accepted, unused in v1
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { makeHaloTexture, makePointMaterial } from "./celestial-shared.js";
import { QUALITY } from "../../lib/space-cube-config.jsx";
import { DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";
import Nebula from "./Nebula.jsx";
import Sun from "./Sun.jsx";
import NeutronStar from "./NeutronStar.jsx";
import SpaceBattle from "./SpaceBattle.jsx";
import BinaryBlackHole from "./BinaryBlackHole.jsx";
import AmbientEvents from "./AmbientEvents.jsx";

const GALAXY_Z = -140;
const DISK_TILT = [THREE.MathUtils.degToRad(62), 0, THREE.MathUtils.degToRad(8)];
const SPIN_SPEED = 0.045; // calm, slow galactic rotation

const RIN = 4.5;
const ROUT = 16;

/* ============================= sub-components ============================= */

function DistantStars({ count, reduced }) {
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 140 + Math.random() * 200;            // 140..340 shell
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      const sp = Math.sin(phi);
      pos[i * 3] = r * sp * Math.cos(theta);
      pos[i * 3 + 1] = r * sp * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.12, 0.5, 0.6 + Math.random() * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 0.6 + Math.random() * 1.2;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = makePointMaterial(1);
    return { geo, mat };
  }, [count]);

  useFrame((state) => {
    if (reduced) return;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function CoreGlow({ intensity = 1 }) {
  const tex = useMemo(() => makeHaloTexture(), []);
  useEffect(() => () => { tex.dispose(); }, [tex]);
  return (
    <>
      <sprite scale={[26, 26, 26]}>
        <spriteMaterial map={tex} color="#ffd2a0" transparent opacity={0.5 * intensity}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={[60, 60, 60]}>
        <spriteMaterial map={tex} color="#9fb8e0" transparent opacity={0.18 * intensity}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </>
  );
}

function PhotonRing() {
  return (
    <mesh>
      <ringGeometry args={[3.3, 3.9, 64]} />
      <meshBasicMaterial color="#ffe9c2" transparent opacity={0.9}
        side={THREE.DoubleSide} depthWrite={false}
        blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function ParticlePoints({ build, reduced }) {
  const { geo, mat } = useMemo(build, [build]);
  useFrame((state) => {
    if (reduced) return;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function makeDiskBuilder(count) {
  return () => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const inner = new THREE.Color("#cfe6ff");
    const outer = new THREE.Color("#ff6a1a");
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const radius = RIN + (ROUT - RIN) * Math.sqrt(Math.random());
      const ang = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(ang) * radius;
      pos[i * 3 + 1] = (Math.random() - 0.5) * (0.6 + radius * 0.04);
      pos[i * 3 + 2] = Math.sin(ang) * radius;
      const tNorm = (radius - RIN) / (ROUT - RIN);
      c.copy(inner).lerp(outer, tNorm).multiplyScalar(1.4 - tNorm * 0.6);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 0.7 + Math.random() * 0.9;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = makePointMaterial(0); // no twinkle for the disk
    return { geo, mat };
  };
}

function makeNearStarsBuilder(count) {
  return () => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 10 + Math.random() * 35;          // 10..45
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      const sp = Math.sin(phi);
      pos[i * 3] = r * sp * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.5;    // flattened bulge
      pos[i * 3 + 2] = r * sp * Math.sin(theta);
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.14, 0.45, 0.62 + Math.random() * 0.3);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 0.6 + Math.random() * 1.0;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = makePointMaterial(1);
    return { geo, mat };
  };
}

const ASTEROID_SPAN = 60;
function Asteroids({ reduced }) {
  const refs = useRef([]);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(0.5, 0), []);
  useEffect(() => () => { geo.dispose(); }, [geo]);

  const rocks = useMemo(() => {
    const N = 4;
    const out = [];
    for (let i = 0; i < N; i++) {
      const startX = -ASTEROID_SPAN / 2 - Math.random() * 4;
      const start = [startX, (Math.random() - 0.5) * 8, -6 - Math.random() * 24];
      out.push({
        start,
        dir: [1, 0, 0],
        speed: 0.3 + Math.random() * 0.4,
        d: Math.random() * ASTEROID_SPAN,
        scale: 0.7 + Math.random() * 0.8,
      });
    }
    return out;
  }, []);

  useFrame((_, dt) => {
    if (reduced) return;
    for (let i = 0; i < rocks.length; i++) {
      const a = rocks[i];
      const ref = refs.current[i];
      if (!ref) continue;
      a.d += a.speed * dt;
      if (a.d > ASTEROID_SPAN) a.d -= ASTEROID_SPAN;
      ref.position.set(
        a.start[0] + a.dir[0] * a.d,
        a.start[1] + a.dir[1] * a.d,
        a.start[2] + a.dir[2] * a.d,
      );
      ref.rotation.x += dt * 0.2;
      ref.rotation.y += dt * 0.15;
    }
  });

  return (
    <>
      {rocks.map((a, i) => (
        <mesh
          key={i}
          ref={(el) => (refs.current[i] = el)}
          geometry={geo}
          position={a.start}
          scale={a.scale}
        >
          <meshStandardMaterial color="#5a5048" roughness={1} metalness={0} flatShading />
        </mesh>
      ))}
    </>
  );
}

/* ================================ Galaxy ================================= */
export function Galaxy({ reduced = false, bg, quality = "high", scene }) {
  const sc = scene || DEFAULT_SCENE;
  const gc = sc.galaxyCore || DEFAULT_SCENE.galaxyCore;
  const q = QUALITY[quality] || QUALITY.high;
  const distantCount = q.distantStars;
  const diskCount = q.diskParticles;
  const nearCount = q.nearStars;

  const diskBuild = useMemo(() => makeDiskBuilder(diskCount), [diskCount]);
  const nearBuild = useMemo(() => makeNearStarsBuilder(nearCount), [nearCount]);

  const spinRef = useRef();
  useFrame((_, dt) => {
    if (reduced) return;
    if (spinRef.current) spinRef.current.rotation.y += dt * SPIN_SPEED * gc.spin;
  });

  return (
    <>
      <DistantStars count={distantCount} reduced={reduced} />

      <group position={[0, 0, GALAXY_Z]} visible={gc.visible !== false}>
        <mesh>
          <sphereGeometry args={[3.2, 32, 32]} />
          <meshBasicMaterial color="#000000" toneMapped={false} />
        </mesh>

        <CoreGlow intensity={gc.intensity} />

        <group rotation={DISK_TILT}>
          <PhotonRing />
          <group ref={spinRef}>
            <ParticlePoints build={diskBuild} reduced={reduced} />
            <ParticlePoints build={nearBuild} reduced={reduced} />
          </group>
        </group>
      </group>

      <Asteroids reduced={reduced} />

      <Nebula reduced={reduced} params={sc.nebula} />
      <Sun reduced={reduced} params={sc.sun} />
      <NeutronStar reduced={reduced} quality={quality} params={sc.pulsar} />
      <SpaceBattle reduced={reduced} params={sc.fleet} />
      <BinaryBlackHole reduced={reduced} params={sc.binaryBH} />
      <AmbientEvents reduced={reduced} quality={quality} />
    </>
  );
}

export default Galaxy;
