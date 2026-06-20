/* =========================================================
   Nebula — L1 volumetric fbm cloud (two parallax layers). Param-driven
   (position via az/el/dist, drift speed, density, size, 3 colours) from
   the Scene Studio sidebar. Frozen when reduced.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { makeNebulaMaterial } from "./celestial-shared.js";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

export function Nebula({ reduced, params }) {
  const p = { ...DEFAULT_SCENE.nebula, ...params };
  const ref = useRef();
  const matFar = useMemo(() => makeNebulaMaterial({ c1: p.c1, c2: p.c2, c3: p.c3 }), []);
  const matNear = useMemo(() => makeNebulaMaterial({ c1: p.c1, c2: p.c2, c3: p.c3 }), []);
  useEffect(() => () => { matFar.dispose(); matNear.dispose(); }, [matFar, matNear]);

  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime * p.drift;
    for (const m of [matFar, matNear]) {
      m.uniforms.uDensity.value = p.density;
      m.uniforms.uC1.value.set(p.c1);
      m.uniforms.uC2.value.set(p.c2);
      m.uniforms.uC3.value.set(p.c3);
    }
    matFar.uniforms.uTime.value = t;
    matNear.uniforms.uTime.value = t * 1.3;
    if (reduced) return;
    if (ref.current) ref.current.rotation.z += dt * 0.004 * p.drift;
  });

  if (p.visible === false) return null;

  return (
    <group ref={ref} position={pos} scale={p.scale} rotation={[0, 0.4, 0.2]}>
      <mesh material={matFar}>
        <planeGeometry args={[170, 120]} />
      </mesh>
      <mesh position={[10, -6, 14]} material={matNear}>
        <planeGeometry args={[120, 90]} />
      </mesh>
    </group>
  );
}

export default Nebula;
