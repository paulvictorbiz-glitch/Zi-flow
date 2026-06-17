/* =========================================================
   NeutronStar — L2 decorative set-piece for the /space scene.

   A fast-spinning neutron star sitting BELOW the cube: an intense
   blue/purple emissive core wrapped in two additive halo sprites,
   with two open-ended polar jets along ±Y that pulse in opacity.
   Purely decorative — no pointer handlers. Static when `reduced`.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ADDITIVE, makeHaloTexture } from "./celestial-shared.js";

export default function NeutronStar({ reduced }) {
  const coreRef = useRef();
  const jetMatRef = useRef();
  const halo = useMemo(() => makeHaloTexture(), []);

  useEffect(() => () => halo.dispose(), [halo]);

  useFrame((state, dt) => {
    if (reduced) return;
    if (coreRef.current) coreRef.current.rotation.y += dt * 6;
    if (jetMatRef.current)
      jetMatRef.current.opacity = 0.5 + 0.35 * Math.sin(state.clock.elapsedTime * 4);
  });

  return (
    <group position={[0, -34, -10]} rotation={[0.25, 0, 0.12]}>
      {/* spinning emissive core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.1, 24, 24]} />
        <meshStandardMaterial
          color="#9fd0ff"
          emissive="#6a4cff"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>

      {/* additive halo glow */}
      <sprite scale={[10, 10, 10]}>
        <spriteMaterial map={halo} color="#7aa0ff" opacity={0.6} {...ADDITIVE} />
      </sprite>
      <sprite scale={[20, 20, 20]}>
        <spriteMaterial map={halo} color="#9a6bff" opacity={0.25} {...ADDITIVE} />
      </sprite>

      {/* polar jets along ±Y (open-ended cones tapering outward) */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, s * 9, 0]} rotation={[0, 0, s > 0 ? 0 : Math.PI]}>
          <coneGeometry args={[1.4, 16, 24, 1, true]} />
          <meshBasicMaterial
            ref={s > 0 ? jetMatRef : undefined}
            color="#8fb0ff"
            transparent
            opacity={0.5}
            {...ADDITIVE}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
