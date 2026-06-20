/* =========================================================
   SpaceBattle — L1 FLEET set-piece for the /space scene.

   A stylized fleet engagement, built ONLY from three.js primitives
   (no model assets):
     · 1 capital ship (hull + bridge + twin engine nacelles, glowing).
     · 5 fighters in loose formation that weave + bob, each with an
       additive engine trail.
     · A dark enemy station they fire on.
     · Pooled weapon projectiles streaking from fighters → station,
       each ending in a shield-impact flash and an occasional explosion
       burst.

   Performance: fixed object pools (no per-frame allocation), scratch
   vectors reused every frame, a few hundred tris + ~25 draw calls.
   Respects `reduced` (parks ships, kills fire/trails/motion).
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ADDITIVE, makeHaloTexture, makeStreakTexture, makeHullTexture } from "./celestial-shared.js";
import { SCENE } from "../../lib/space-cube-config.jsx";
import { DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const STATION = new THREE.Vector3(11, -1, -6);
const N_PROJ = 14;
const N_IMPACT = 10;
const N_BOOM = 6;

const FIGHTERS = [
  { base: [-6, 1, 2], color: "#7fe0ff", phase: 0.0 },
  { base: [-4, 3, -1], color: "#7fe0ff", phase: 1.1 },
  { base: [-7, -2, 0], color: "#5effa0", phase: 2.0 },
  { base: [-3, -1, 3], color: "#5effa0", phase: 3.2 },
  { base: [-8, 2, -3], color: "#7fe0ff", phase: 4.1 },
];

/* One reusable fighter built from primitives. */
function Fighter({ color, trailTex, fref, trailRef }) {
  return (
    <group ref={fref}>
      {/* fuselage (points +x toward the enemy) */}
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.28, 1.3, 8]} />
        <meshStandardMaterial color="#2b3038" metalness={0.6} roughness={0.4}
          emissive={color} emissiveIntensity={0.35} />
      </mesh>
      {/* swept wings */}
      <mesh position={[-0.2, 0, 0]}>
        <boxGeometry args={[0.5, 0.06, 1.4]} />
        <meshStandardMaterial color="#3a4049" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* engine glow */}
      <mesh position={[-0.75, 0, 0]}>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* additive engine trail (behind, along -x) */}
      <sprite ref={trailRef} position={[-1.9, 0, 0]} scale={[2.6, 0.5, 1]}>
        <spriteMaterial map={trailTex} color={color} opacity={0.6} {...ADDITIVE} />
      </sprite>
    </group>
  );
}

export default function SpaceBattle({ reduced = false, params }) {
  const cfg = SCENE.fleet;
  const p = { ...DEFAULT_SCENE.fleet, ...params };

  const capRef = useRef();
  const fighterRefs = useRef([]);
  const trailRefs = useRef([]);
  const projRefs = useRef([]);
  const impactRefs = useRef([]);
  const boomRefs = useRef([]);

  const haloTex = useMemo(() => makeHaloTexture(), []);
  const trailTex = useMemo(() => makeStreakTexture(), []);
  const hull = useMemo(() => makeHullTexture({ base: "#434b58", line: "#252a32", win: "#9fe6ff" }), []);
  useEffect(() => () => { haloTex.dispose(); trailTex.dispose(); hull.map.dispose(); hull.emissive.dispose(); }, [haloTex, trailTex, hull]);

  // pool state (plain arrays of mutable records — no per-frame allocation)
  const proj = useMemo(() => Array.from({ length: N_PROJ }, () => ({ active: false, t: 0, life: 1, color: "#7fe0ff" })), []);
  const impacts = useMemo(() => Array.from({ length: N_IMPACT }, () => ({ active: false, t: 0, life: 0.5, color: "#bfe6ff" })), []);
  const booms = useMemo(() => Array.from({ length: N_BOOM }, () => ({ active: false, t: 0, life: 0.9 })), []);
  const spawnTimer = useRef(0);

  const scratch = useMemo(() => ({
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    q: new THREE.Quaternion(),
    pos: new THREE.Vector3(),
  }), []);

  const fighterPos = (i, t) => {
    const f = FIGHTERS[i];
    return [
      f.base[0] + Math.sin(t * 0.6 + f.phase) * 0.6,
      f.base[1] + Math.sin(t * 1.1 + f.phase) * 0.5,
      f.base[2] + Math.cos(t * 0.5 + f.phase) * 0.6,
    ];
  };

  const fire = (t) => {
    const slot = proj.find((p) => !p.active);
    if (!slot) return;
    const fi = (Math.random() * FIGHTERS.length) | 0;
    const fp = fighterPos(fi, t);
    slot.active = true;
    slot.t = 0;
    slot.fx = fp[0]; slot.fy = fp[1]; slot.fz = fp[2];
    slot.tx = STATION.x + (Math.random() - 0.5) * 2.4;
    slot.ty = STATION.y + (Math.random() - 0.5) * 2.4;
    slot.tz = STATION.z + (Math.random() - 0.5) * 2.4;
    const dist = Math.hypot(slot.tx - slot.fx, slot.ty - slot.fy, slot.tz - slot.fz);
    slot.life = dist / 26; // speed
    slot.color = FIGHTERS[fi].color;
  };

  const trigger = (pool, x, y, z, extra) => {
    const s = pool.find((p) => !p.active);
    if (!s) return;
    s.active = true; s.t = 0; s.x = x; s.y = y; s.z = z;
    if (extra) Object.assign(s, extra);
  };

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;

    // ── capital ship: slow bob + yaw ──
    if (capRef.current) {
      capRef.current.position.y = reduced ? 0 : Math.sin(t * 0.4) * 0.4;
      if (!reduced) capRef.current.rotation.y = Math.sin(t * 0.15) * 0.12;
    }

    // ── fighters: weave/bob, trails ──
    for (let i = 0; i < FIGHTERS.length; i++) {
      const g = fighterRefs.current[i];
      const tr = trailRefs.current[i];
      if (!g) continue;
      if (reduced) {
        g.position.set(FIGHTERS[i].base[0], FIGHTERS[i].base[1], FIGHTERS[i].base[2]);
        if (tr) tr.material.opacity = 0;
        continue;
      }
      const p = fighterPos(i, t);
      g.position.set(p[0], p[1], p[2]);
      g.rotation.z = Math.sin(t * 0.9 + i) * 0.2;
      if (tr) tr.material.opacity = 0.45 + 0.2 * Math.sin(t * 8 + i);
    }

    if (reduced) {
      // hide all transient pool meshes
      for (let i = 0; i < N_PROJ; i++) { proj[i].active = false; const m = projRefs.current[i]; if (m) m.visible = false; }
      for (let i = 0; i < N_IMPACT; i++) { impacts[i].active = false; const m = impactRefs.current[i]; if (m) m.visible = false; }
      for (let i = 0; i < N_BOOM; i++) { booms[i].active = false; const m = boomRefs.current[i]; if (m) m.visible = false; }
      return;
    }

    // ── spawn projectiles on a cadence (scaled by fireRate) ──
    if (p.fireRate > 0.02) {
      spawnTimer.current -= dt;
      if (spawnTimer.current <= 0) {
        fire(t);
        spawnTimer.current = (0.18 + Math.random() * 0.22) / p.fireRate;
      }
    }

    // ── advance projectiles ──
    for (let i = 0; i < N_PROJ; i++) {
      const p = proj[i];
      const m = projRefs.current[i];
      if (!m) continue;
      if (!p.active) { m.visible = false; continue; }
      p.t += dt;
      const k = clamp(p.t / p.life, 0, 1);
      scratch.from.set(p.fx, p.fy, p.fz);
      scratch.to.set(p.tx, p.ty, p.tz);
      scratch.pos.lerpVectors(scratch.from, scratch.to, k);
      m.visible = true;
      m.position.copy(scratch.pos);
      scratch.dir.subVectors(scratch.to, scratch.from).normalize();
      scratch.q.setFromUnitVectors(scratch.up, scratch.dir);
      m.quaternion.copy(scratch.q);
      m.material.color.set(p.color);
      if (k >= 1) {
        p.active = false;
        m.visible = false;
        trigger(impacts, p.tx, p.ty, p.tz, { color: p.color, life: 0.45 });
        if (Math.random() < 0.34) trigger(booms, p.tx, p.ty, p.tz, { life: 0.9 });
      }
    }

    // ── shield-impact flashes ──
    for (let i = 0; i < N_IMPACT; i++) {
      const s = impacts[i];
      const m = impactRefs.current[i];
      if (!m) continue;
      if (!s.active) { m.visible = false; continue; }
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) { s.active = false; m.visible = false; continue; }
      m.visible = true;
      m.position.set(s.x, s.y, s.z);
      const sc = 0.8 + k * 2.2;
      m.scale.set(sc, sc, 1);
      m.material.opacity = (1 - k) * 0.9;
      m.material.color.set(s.color);
    }

    // ── explosion bursts ──
    for (let i = 0; i < N_BOOM; i++) {
      const s = booms[i];
      const m = boomRefs.current[i];
      if (!m) continue;
      if (!s.active) { m.visible = false; continue; }
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) { s.active = false; m.visible = false; continue; }
      m.visible = true;
      m.position.set(s.x, s.y, s.z);
      const sc = 1 + k * 5;
      m.scale.set(sc, sc, 1);
      // flash white → orange → fade
      m.material.opacity = (1 - k) * 0.95;
      m.material.color.setRGB(1, clamp(0.9 - k * 0.7, 0, 1), clamp(0.5 - k * 0.5, 0, 1));
    }
  });

  if (p.visible === false) return null;

  return (
    <group position={cfg.position} scale={p.scale}>
      {/* enemy station they fire on */}
      <group position={[STATION.x, STATION.y, STATION.z]}>
        <mesh>
          <sphereGeometry args={[3.4, 32, 24]} />
          <meshStandardMaterial color="#34383f" roughness={0.9} metalness={0.35} />
        </mesh>
        <mesh>
          <torusGeometry args={[3.42, 0.14, 8, 64]} />
          <meshStandardMaterial color="#202327" roughness={0.95} metalness={0.2} />
        </mesh>
        {/* faint shield shell */}
        <mesh>
          <sphereGeometry args={[3.9, 24, 18]} />
          <meshBasicMaterial color="#5e7bd0" transparent opacity={0.06} {...ADDITIVE} />
        </mesh>
      </group>

      {/* capital ship (friendly) — panelled hull with glowing windows */}
      <group ref={capRef} position={[-9, 0, 1]}>
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.5, 1.1, 5.5, 16]} />
          <meshStandardMaterial map={hull.map} emissiveMap={hull.emissive}
            emissive="#ffffff" emissiveIntensity={1.7} metalness={0.7} roughness={0.45} />
        </mesh>
        {/* bridge tower */}
        <mesh position={[-1.4, 0.7, 0]}>
          <boxGeometry args={[1, 0.7, 0.7]} />
          <meshStandardMaterial map={hull.map} emissiveMap={hull.emissive}
            emissive="#9fe6ff" emissiveIntensity={1.4} metalness={0.6} roughness={0.45} />
        </mesh>
        {/* twin engine glow */}
        {[0.4, -0.4].map((z) => (
          <mesh key={z} position={[-2.9, 0, z]}>
            <sphereGeometry args={[0.3, 12, 12]} />
            <meshBasicMaterial color="#9fe6ff" toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* fighters */}
      {FIGHTERS.map((f, i) => (
        <Fighter
          key={i}
          color={f.color}
          trailTex={trailTex}
          fref={(el) => (fighterRefs.current[i] = el)}
          trailRef={(el) => (trailRefs.current[i] = el)}
        />
      ))}

      {/* projectile pool (laser bolts) */}
      {proj.map((_, i) => (
        <mesh key={"p" + i} ref={(el) => (projRefs.current[i] = el)} visible={false}>
          <cylinderGeometry args={[0.06, 0.06, 0.9, 6]} />
          <meshBasicMaterial color="#7fe0ff" {...ADDITIVE} />
        </mesh>
      ))}

      {/* shield-impact flashes */}
      {impacts.map((_, i) => (
        <sprite key={"i" + i} ref={(el) => (impactRefs.current[i] = el)} visible={false}>
          <spriteMaterial map={haloTex} color="#bfe6ff" {...ADDITIVE} />
        </sprite>
      ))}

      {/* explosion bursts */}
      {booms.map((_, i) => (
        <sprite key={"b" + i} ref={(el) => (boomRefs.current[i] = el)} visible={false}>
          <spriteMaterial map={haloTex} color="#ffd0a0" {...ADDITIVE} />
        </sprite>
      ))}
    </group>
  );
}
