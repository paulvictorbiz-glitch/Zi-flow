/* =========================================================
   BinaryBlackHole — L1 decorative HEADLINE set-piece for /space.

   Two spinning black holes (unequal mass) that orbit a common centre,
   inspiral as the orbit decays, MERGE in a bright flash, then ring down
   as a single larger black hole while a gravitational-wave ripple
   expands outward — then the whole cycle loops.

   Faked gravitational lensing (no screen-space shader): each hole gets a
   black event-horizon sphere + a tilted additive accretion-disk point
   cloud + a bright photon ring + a pulsing Einstein-ring sprite + a soft
   halo. Built only from primitives + the shared celestial helpers.

   Purely decorative — no pointer handlers. Freezes at a stable wide-orbit
   pose when `reduced` (prefers-reduced-motion). Disk particle counts come
   from the QUALITY tier.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  ADDITIVE,
  makeHaloTexture,
  makeRingTexture,
  makeAccretionDiskMaterial,
} from "./celestial-shared.js";
import { SCENE } from "../../lib/space-cube-config.jsx";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

const LOOP = 22;          // full cinematic period (s)
const T_INSPIRAL = 14;    // orbit decays over this window, then merge
const R0 = 9;             // starting orbital separation (half-extent)
const RMIN = 1.5;         // separation at the moment of merge
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* One black hole: black horizon + turbulent SHADER accretion disk (doppler-
   beamed) + photon ring + pulsing Einstein ring + halo. The PARENT
   positions/scales it. */
function BlackHoleVisual({ horizon, rIn, rOut, inner, outer, spin = 1.0, reduced }) {
  const einsteinRef = useRef();
  const halo = useMemo(() => makeHaloTexture(), []);
  const ring = useMemo(() => makeRingTexture(0.36, 0.46), []);
  // material created once; colours/spin are driven live from props each frame
  const diskMat = useMemo(() => makeAccretionDiskMaterial({ rIn, rOut, inner, outer, spin }), [rIn, rOut]);

  useEffect(() => () => { halo.dispose(); ring.dispose(); diskMat.dispose(); }, [halo, ring, diskMat]);

  useFrame((state) => {
    diskMat.uniforms.uTime.value = state.clock.elapsedTime;
    diskMat.uniforms.uInner.value.set(inner);
    diskMat.uniforms.uOuter.value.set(outer);
    diskMat.uniforms.uSpin.value = spin;
    if (reduced) return;
    if (einsteinRef.current)
      einsteinRef.current.material.opacity = 0.55 + 0.3 * Math.sin(state.clock.elapsedTime * 2.5);
  });

  return (
    <group>
      {/* event horizon — pure black, occludes the disk behind it */}
      <mesh>
        <sphereGeometry args={[horizon, 32, 32]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>

      {/* photon ring — a bright thin band hugging the horizon */}
      <mesh rotation={[Math.PI / 2.1, 0, 0]}>
        <ringGeometry args={[horizon * 1.15, horizon * 1.4, 64]} />
        <meshBasicMaterial color="#ffe9c2" {...ADDITIVE} side={THREE.DoubleSide} opacity={0.9} />
      </mesh>

      {/* Einstein ring — faked lensing halo (pulses) */}
      <sprite ref={einsteinRef} scale={[horizon * 6, horizon * 6, 1]}>
        <spriteMaterial map={ring} color="#bcd2ff" opacity={0.6} {...ADDITIVE} />
      </sprite>

      {/* soft glow */}
      <sprite scale={[horizon * 9, horizon * 9, 1]}>
        <spriteMaterial map={halo} color="#5b7bd0" opacity={0.25} {...ADDITIVE} />
      </sprite>

      {/* tilted turbulent accretion disk (shader) */}
      <mesh rotation={[THREE.MathUtils.degToRad(64), 0, THREE.MathUtils.degToRad(6)]}>
        <ringGeometry args={[rIn, rOut, 128, 8]} />
        <primitive object={diskMat} attach="material" />
      </mesh>
    </group>
  );
}

export default function BinaryBlackHole({ reduced = false, params }) {
  const cfg = SCENE.binaryBlackHole;
  const p = { ...DEFAULT_SCENE.binaryBH, ...params };
  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  const groupA = useRef();
  const groupB = useRef();
  const mergedRef = useRef();
  const flashRef = useRef();
  const ripple1 = useRef();
  const ripple2 = useRef();

  const phaseRef = useRef(0);
  const lastTau = useRef(0);
  const clockRef = useRef(0);

  const flashTex = useMemo(() => makeHaloTexture(), []);
  const rippleTex = useMemo(() => makeRingTexture(0.42, 0.49), []);
  useEffect(() => () => { flashTex.dispose(); rippleTex.dispose(); }, [flashTex, rippleTex]);

  // unequal masses → bhB orbits on a wider arc than the heavier bhA
  const mA = 1, mB = 0.62;
  const fA = mB / (mA + mB);   // bhA's orbit radius fraction
  const fB = mA / (mA + mB);

  function orbitRadius(t) {
    const k = clamp(t / T_INSPIRAL, 0, 1);
    return RMIN + (R0 - RMIN) * Math.pow(1 - k, 2.4); // lingers wide, then plunges
  }

  useFrame((state, dt) => {
    const A = groupA.current, B = groupB.current, M = mergedRef.current;

    if (reduced) {
      // Park at a calm wide-orbit pose: both holes visible, no motion.
      if (A) { A.visible = true; A.position.set(R0 * fA, 0, 0); }
      if (B) { B.visible = true; B.position.set(-R0 * fB, 0, 0); }
      if (M) M.visible = false;
      if (flashRef.current) flashRef.current.material.opacity = 0;
      if (ripple1.current) ripple1.current.visible = false;
      if (ripple2.current) ripple2.current.visible = false;
      return;
    }

    clockRef.current += dt * p.loopSpeed;
    const tau = clockRef.current % LOOP;
    if (tau < lastTau.current) phaseRef.current = 0; // loop wrapped → reset
    lastTau.current = tau;

    const inspiraling = tau < T_INSPIRAL;

    if (inspiraling) {
      const R = orbitRadius(tau);
      // angular speed rises as R shrinks (Keplerian-ish), integrated into phase
      phaseRef.current += dt * (0.6 + 7 / Math.pow(R, 1.5));
      const ph = phaseRef.current;

      if (A) {
        A.visible = true;
        A.position.set(Math.cos(ph) * R * fA, 0, Math.sin(ph) * R * fA);
      }
      if (B) {
        B.visible = true;
        B.position.set(Math.cos(ph + Math.PI) * R * fB, 0, Math.sin(ph + Math.PI) * R * fB);
      }
      if (M) M.visible = false;
    } else {
      // merged: single hole settles with a damped ring-down wobble
      if (A) A.visible = false;
      if (B) B.visible = false;
      if (M) {
        M.visible = true;
        const e = tau - T_INSPIRAL;
        const wobble = 1 + 0.22 * Math.exp(-e * 1.4) * Math.sin(e * 9);
        M.scale.setScalar(wobble);
      }
    }

    // merge flash — sharp spike centred on the merge instant
    if (flashRef.current) {
      const d = Math.abs(tau - T_INSPIRAL);
      flashRef.current.material.opacity = clamp(1 - d / 0.9, 0, 1);
    }

    // gravitational-wave ripples — expand outward after merge, then fade
    const e = tau - T_INSPIRAL;
    const setRipple = (ref, delay, hue) => {
      if (!ref.current) return;
      const ee = e - delay;
      if (ee < 0 || inspiraling) { ref.current.visible = false; return; }
      ref.current.visible = true;
      const s = 3 + ee * 6;
      ref.current.scale.set(s, s, 1);
      ref.current.material.opacity = clamp(0.7 * (1 - ee / (LOOP - T_INSPIRAL)), 0, 0.7);
      ref.current.material.color.set(hue);
    };
    setRipple(ripple1, 0, "#9fc0ff");
    setRipple(ripple2, 1.2, "#c9b6ff");
  });

  if (p.visible === false) return null;

  return (
    <group position={pos} scale={p.scale} rotation={cfg.tilt}>
      {/* two inspiraling holes (unequal mass) */}
      <group ref={groupA}>
        <BlackHoleVisual horizon={1.0} rIn={1.3} rOut={4.6} spin={1.0 * p.diskSpin}
          inner={p.diskInner} outer={p.diskOuter} reduced={reduced} />
      </group>
      <group ref={groupB}>
        <BlackHoleVisual horizon={0.72} rIn={0.95} rOut={3.4} spin={1.35 * p.diskSpin}
          inner={p.diskInner} outer={p.diskOuter} reduced={reduced} />
      </group>

      {/* the merged remnant (hidden until merge) */}
      <group ref={mergedRef} visible={false}>
        <BlackHoleVisual horizon={1.5} rIn={1.9} rOut={6.2} spin={0.7 * p.diskSpin}
          inner={p.diskInner} outer={p.diskOuter} reduced={reduced} />
      </group>

      {/* merge flash */}
      <sprite ref={flashRef} scale={[22, 22, 1]}>
        <spriteMaterial map={flashTex} color="#fff2d2" opacity={0} {...ADDITIVE} />
      </sprite>

      {/* gravitational-wave ripples (in the orbital plane) */}
      <sprite ref={ripple1} scale={[3, 3, 1]}>
        <spriteMaterial map={rippleTex} color="#9fc0ff" opacity={0} {...ADDITIVE} />
      </sprite>
      <sprite ref={ripple2} scale={[3, 3, 1]}>
        <spriteMaterial map={rippleTex} color="#c9b6ff" opacity={0} {...ADDITIVE} />
      </sprite>
    </group>
  );
}
