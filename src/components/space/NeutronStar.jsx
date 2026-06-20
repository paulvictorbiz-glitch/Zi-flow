/* =========================================================
   NeutronStar — L1 PULSAR set-piece. Param-driven (position via
   az/el/dist, spin, beam length/colour, jet intensity, core glow, size)
   from the Scene Studio sidebar.

   SPIN axis (±Y): relativistic plasma jets + particle spray.
   MAGNETIC axis (tilted): sweeping lighthouse beams + caps + field lines.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ADDITIVE, makeHaloTexture, makePointMaterial, makePlasmaMaterial } from "./celestial-shared.js";
import { QUALITY } from "../../lib/space-cube-config.jsx";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

const MAG_TILT = THREE.MathUtils.degToRad(28);

function makeJetSpray(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const up = i % 2 === 0 ? 1 : -1;
    const h = Math.pow(Math.random(), 0.7) * 15;
    const spread = 0.3 + h * 0.12;
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = up * (1 + h);
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
    c.setHSL(0.62, 0.7, 0.7 - (h / 16) * 0.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = 0.5 + Math.random() * 0.8; phase[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  return { geo, mat: makePointMaterial(1) };
}

export default function NeutronStar({ reduced = false, quality = "high", params }) {
  const p = { ...DEFAULT_SCENE.pulsar, ...params };
  const q = QUALITY[quality] || QUALITY.high;

  const spinRef = useRef();
  const sprayMat = useRef();
  const halo = useMemo(() => makeHaloTexture(), []);
  const jetMats = useMemo(() => [makePlasmaMaterial("#bcd9ff", "#3a5cff", 0.04), makePlasmaMaterial("#bcd9ff", "#3a5cff", 0.04)], []);
  const beamMats = useMemo(() => [makePlasmaMaterial("#eaf2ff", "#6f8fff", 0.02), makePlasmaMaterial("#eaf2ff", "#6f8fff", 0.02)], []);
  const jet = useMemo(() => (q.jetParticles > 0 ? makeJetSpray(q.jetParticles) : null), [q.jetParticles]);

  useEffect(() => () => {
    halo.dispose();
    jetMats.forEach((m) => m.dispose());
    beamMats.forEach((m) => m.dispose());
    if (jet) { jet.geo.dispose(); jet.mat.dispose(); }
  }, [halo, jet, jetMats, beamMats]);

  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    jetMats.forEach((m) => { m.uniforms.uTime.value = t; m.uniforms.uColA.value.set(p.coreColor); });
    beamMats.forEach((m) => { m.uniforms.uTime.value = t; m.uniforms.uColA.value.set(p.beamColor); });
    if (sprayMat.current) sprayMat.current.uniforms.uTime.value = t;
    if (reduced) return;
    if (spinRef.current) spinRef.current.rotation.y += dt * p.spin;
  });

  if (p.visible === false) return null;

  return (
    <group position={pos} scale={p.scale} rotation={[0.25, 0, 0.12]}>
      <sprite scale={[9, 9, 1]}>
        <spriteMaterial map={halo} color={p.coreColor} opacity={0.55} {...ADDITIVE} />
      </sprite>
      <sprite scale={[18, 18, 1]}>
        <spriteMaterial map={halo} color="#9a6bff" opacity={0.22} {...ADDITIVE} />
      </sprite>

      {/* relativistic jets along the SPIN axis (±Y) — gaseous plasma */}
      {p.jet > 0.02 && [1, -1].map((s, idx) => (
        <mesh key={s} position={[0, s * 9 * p.jet, 0]} rotation={[0, 0, s > 0 ? 0 : Math.PI]} scale={[1, p.jet, 1]} material={jetMats[idx]}>
          <coneGeometry args={[1.1, 16, 24, 1, true]} />
        </mesh>
      ))}
      {jet && <points geometry={jet.geo} material={jet.mat} frustumCulled={false}
        ref={(el) => { if (el) sprayMat.current = el.material; }} />}

      <group ref={spinRef}>
        <mesh>
          <sphereGeometry args={[1.1, 32, 32]} />
          <meshStandardMaterial color="#9fd0ff" emissive={p.coreColor} emissiveIntensity={3} toneMapped={false} />
        </mesh>

        <group rotation={[0, 0, MAG_TILT]}>
          {[1, -1].map((s) => (
            <mesh key={s} position={[0, s * 1.05, 0]}>
              <sphereGeometry args={[0.42, 16, 16]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          ))}

          {/* lighthouse beams (gaseous plasma, length-adjustable, sweep with spin) */}
          {[1, -1].map((s, idx) => (
            <mesh key={s} position={[0, s * 13 * p.beamLength, 0]} rotation={[0, 0, s > 0 ? 0 : Math.PI]} scale={[1, p.beamLength, 1]} material={beamMats[idx]}>
              <coneGeometry args={[2.4, 24, 28, 1, true]} />
            </mesh>
          ))}

          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, (i * Math.PI) / 3, 0]}>
              <torusGeometry args={[2.4, 0.05, 6, 48]} />
              <meshBasicMaterial color="#6f8fff" transparent opacity={0.22} {...ADDITIVE} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
