/* =========================================================
   GravLens — L1 SUBTLE 2D Einstein-ring + camera warp (param-driven).

   A faint warm ring on the line between the cube and the Sun. It forms
   only when the lens lines up IN FRONT of the Sun as seen from the
   camera (lens silhouetted on the Sun) — i.e. looking at the cube with
   the Sun beyond it, the angle reachable while orbiting the cube. When
   it is formed, click it (or scroll into it) to warp up over the Sun and
   look back at a small spinning cube. All of opacity / size / warp speed
   / appearance angle / position come from the Scene-Studio `lens` params.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { makeRingTexture } from "./celestial-shared.js";
import { posFromAED } from "../../lib/space-scene-params.jsx";

const DUR = 1.8; // base warp seconds (divided by warpSpeed)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const LENS_DEFAULTS = { visible: true, opacity: 0.78, size: 1, warpSpeed: 1, angle: 1, az: 35, el: 22, dist: 22 };

export default function GravLens({
  sunPos = [47, 33, 67],
  phase = "idle",
  params,
  onRequestWarp = () => {},
  onArrive = () => {},
}) {
  const p = { ...LENS_DEFAULTS, ...params };
  const { camera, controls, gl } = useThree();
  const grp = useRef();
  const ringRef = useRef();
  const ringTex = useMemo(() => makeRingTexture(0.40, 0.47), []);
  useEffect(() => () => ringTex.dispose(), [ringTex]);

  const sun = useMemo(() => new THREE.Vector3(...sunPos), [sunPos]);
  const lensPos = useMemo(() => new THREE.Vector3(...posFromAED(p.az, p.el, p.dist)), [p.az, p.el, p.dist]);
  const goalCam = useMemo(
    () => sun.clone().add(new THREE.Vector3(0, 24, 0)).addScaledVector(sun.clone().normalize(), -7),
    [sun]
  );

  const tw = useRef({
    t: 0, running: false,
    from: new THREE.Vector3(), fromT: new THREE.Vector3(),
    toC: new THREE.Vector3(), toT: new THREE.Vector3(),
  });
  const prev = useRef(phase);
  const gateRef = useRef(0);

  // wheel-INTO the formed ring → warp
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e) => { if (phase === "idle" && p.visible && e.deltaY < 0 && gateRef.current > 0.5) onRequestWarp(); };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, phase, p.visible, onRequestWarp]);

  const _cd = useMemo(() => new THREE.Vector3(), []);
  const _toSun = useMemo(() => new THREE.Vector3(), []);
  const _toLens = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    // Ring forms when the lens is silhouetted on the Sun from the camera
    // and the Sun is ahead of the view. `angle` widens/narrows that window.
    camera.getWorldDirection(_cd);
    _toSun.copy(sun).sub(camera.position).normalize();
    _toLens.copy(lensPos).sub(camera.position).normalize();
    const sunInView = _cd.dot(_toSun);
    const colinear = _toLens.dot(_toSun);
    const inFront = _toLens.dot(_cd);
    const cLo = THREE.MathUtils.clamp(1.0 - 0.06 * p.angle, 0.80, 0.992);
    let g = smooth(cLo, 0.995, colinear) * smooth(0.30, 0.75, sunInView);
    if (inFront < 0.2 || !p.visible) g = 0;
    gateRef.current = g;
    if (ringRef.current) {
      ringRef.current.material.opacity = g * p.opacity;
      const s = (4.6 + g * 2.4) * p.size;
      ringRef.current.scale.set(s, s, s);
    }

    // warp tween
    const tween = phase === "warping" || phase === "returning";
    const wasTween = prev.current === "warping" || prev.current === "returning";
    if (tween && !wasTween) {
      const T = tw.current;
      T.from.copy(camera.position);
      T.fromT.copy(controls ? controls.target : new THREE.Vector3());
      T.toC.copy(phase === "returning" ? new THREE.Vector3(0, 0, 12) : goalCam);
      T.toT.set(0, 0, 0); T.t = 0; T.running = true;
      if (controls) controls.enabled = false;
    }
    prev.current = phase;

    const T = tw.current;
    if (T.running) {
      T.t = Math.min(1, T.t + (dt * p.warpSpeed) / DUR);
      const e = ease(T.t);
      camera.position.lerpVectors(T.from, T.toC, e);
      const tgt = new THREE.Vector3().lerpVectors(T.fromT, T.toT, e);
      camera.lookAt(tgt);
      if (T.t >= 1) {
        T.running = false;
        if (controls) { controls.target.copy(T.toT); controls.enabled = true; controls.update(); }
        onArrive(phase);
      }
    }
  });

  const hitR = 4 * p.size;
  return (
    <group ref={grp} position={lensPos.toArray()}>
      {/* the only visible thing: a thin warm 2D Einstein ring */}
      <sprite ref={ringRef} scale={[4.6, 4.6, 4.6]}>
        <spriteMaterial map={ringTex} color="#ffe9c2" transparent opacity={0}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      {/* click the FORMED ring (gate active) to warp */}
      <mesh
        onClick={(e) => { e.stopPropagation(); if (phase === "idle" && p.visible && gateRef.current > 0.2) onRequestWarp(); }}
        onPointerOver={() => { if (gateRef.current > 0.2) document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[hitR, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
