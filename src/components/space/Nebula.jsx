/* =========================================================
   Nebula — L1 decorative. A large, colorful additive cloud
   hung far in the "western" (−X) sky, behind the cube. Built
   from a few overlapping radial blobs composited into a single
   billboard plane; drifts ultra-slowly (frozen when reduced).

   Purely decorative — no pointer handlers, no new deps.

   Props:
     reduced — boolean, skip motion when true
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { makeRadialGradientTexture, ADDITIVE } from "./celestial-shared.js";

export function Nebula({ reduced }) {
  const ref = useRef();

  const tex = useMemo(
    () =>
      makeRadialGradientTexture([
        { x: 0.42, y: 0.46, r: 0.45, c: "rgba(150,90,220,.55)" }, // violet core
        { x: 0.58, y: 0.40, r: 0.38, c: "rgba(60,160,210,.40)" }, // blue wash
        { x: 0.50, y: 0.60, r: 0.30, c: "rgba(230,120,200,.45)" }, // magenta glow
      ]),
    []
  );

  useFrame((_, dt) => {
    if (reduced) return;
    if (ref.current) ref.current.rotation.z += dt * 0.005;
  });

  useEffect(() => () => tex.dispose(), [tex]);

  return (
    <mesh ref={ref} position={[-90, 18, -110]} rotation={[0, 0.4, 0.2]}>
      <planeGeometry args={[140, 100]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.5}
        {...ADDITIVE}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export default Nebula;
