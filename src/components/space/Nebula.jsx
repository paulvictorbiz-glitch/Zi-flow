/* =========================================================
   Nebula — L1 volumetric, multi-hue GAS cloud with real 3D depth.

   Four fbm shader planes crossed at varied depths/orientations so the
   cloud reads as a gaseous volume (parallax from every orbit angle) with
   soft patches of different colour hints — purple base, blue, pink and a
   light-green accent — driven by low-frequency hue fields in the shader
   (no discrete dots). Param-driven (position via az/el/dist, drift,
   density, size, 4 colours) from the Scene Studio. Frozen when reduced.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { makeNebulaMaterial } from "./celestial-shared.js";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

/* Four plane orientations/depths → gaseous volume, no flat billboard. */
const PLANES = [
  { size: [176, 126], rot: [0, 0, 0],                   pos: [0, 0, 0] },
  { size: [150, 112], rot: [Math.PI / 2.2, 0.3, 0.1],   pos: [10, -6, -14] },
  { size: [134, 104], rot: [0.25, Math.PI / 2.3, 0.22], pos: [-10, 7, 14] },
  { size: [120, 96],  rot: [0.5, 0.9, -0.3],            pos: [4, 10, -8] },
];

export function Nebula({ reduced, params }) {
  const p = { ...DEFAULT_SCENE.nebula, ...params };
  const ref = useRef();

  const mats = useMemo(
    () => PLANES.map(() => makeNebulaMaterial({ c1: p.c1, c2: p.c2, c3: p.c3, c4: p.c4 })),
    // built once; colours/density updated through uniforms each frame
    []
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime * p.drift;
    mats.forEach((m, i) => {
      m.uniforms.uDensity.value = p.density;
      m.uniforms.uC1.value.set(p.c1);
      m.uniforms.uC2.value.set(p.c2);
      m.uniforms.uC3.value.set(p.c3);
      m.uniforms.uC4.value.set(p.c4);
      m.uniforms.uTime.value = t * (1 + i * 0.18);
    });
    if (reduced) return;
    if (ref.current) ref.current.rotation.z += dt * 0.004 * p.drift;
  });

  if (p.visible === false) return null;

  return (
    <group ref={ref} position={pos} scale={p.scale} rotation={[0, 0.4, 0.2]}>
      {PLANES.map((pl, i) => (
        <mesh key={i} material={mats[i]} position={pl.pos} rotation={pl.rot}>
          <planeGeometry args={pl.size} />
        </mesh>
      ))}
    </group>
  );
}

export default Nebula;
