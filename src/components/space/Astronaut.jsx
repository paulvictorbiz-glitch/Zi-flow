/* =========================================================
   Astronaut — L1 stylized floating astronaut set-piece.

   A low-poly suited figure that slowly bobs + turns. The helmet visor
   shows a portrait texture from /astronaut-face.jpg if that file exists
   (drop your photo in public/), otherwise a tinted-glass fallback. All
   tunables (size, spin, bob, suit/visor colour, az/el/dist position)
   come from the Scene-Studio `astronaut` params. Frozen when reduced.
   ========================================================= */
import React, { useMemo, useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

export default function Astronaut({ reduced, params }) {
  const p = { ...DEFAULT_SCENE.astronaut, ...params };
  const grp = useRef();
  const inner = useRef();
  const [faceTex, setFaceTex] = useState(null);

  // try to load the visor portrait; silently keep the fallback if missing
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      "/astronaut-face.jpg",
      (t) => { if (alive) { t.colorSpace = THREE.SRGBColorSpace; setFaceTex(t); } },
      undefined,
      () => {}
    );
    return () => { alive = false; };
  }, []);
  useEffect(() => () => { if (faceTex) faceTex.dispose(); }, [faceTex]);

  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  useFrame((state, dt) => {
    if (reduced || !grp.current) return;
    if (inner.current) inner.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.25 * p.bob;
    grp.current.rotation.y += dt * 0.3 * p.spin;
  });

  if (p.visible === false) return null;
  const suit = p.suit;

  return (
    <group ref={grp} position={pos} scale={p.scale}>
      <group ref={inner} rotation={[0.1, 0.4, 0.05]}>
        {/* helmet */}
        <mesh position={[0, 0.95, 0]}>
          <sphereGeometry args={[0.52, 32, 32]} />
          <meshStandardMaterial color={suit} roughness={0.45} metalness={0.1} />
        </mesh>
        {/* visor portrait (your photo) or tinted glass */}
        <mesh position={[0, 0.95, 0.43]}>
          <circleGeometry args={[0.34, 32]} />
          {faceTex
            ? <meshBasicMaterial map={faceTex} toneMapped={false} />
            : <meshStandardMaterial color={p.visor} roughness={0.15} metalness={0.7} />}
        </mesh>
        {/* glass dome sheen over the visor */}
        <mesh position={[0, 0.95, 0.12]}>
          <sphereGeometry args={[0.46, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#bcd6ff" transparent opacity={0.14} roughness={0.1} metalness={0.9} />
        </mesh>
        {/* torso */}
        <mesh position={[0, 0.18, 0]}>
          <capsuleGeometry args={[0.34, 0.5, 6, 16]} />
          <meshStandardMaterial color={suit} roughness={0.55} metalness={0.05} />
        </mesh>
        {/* chest panel */}
        <mesh position={[0, 0.3, 0.31]}>
          <boxGeometry args={[0.3, 0.22, 0.08]} />
          <meshStandardMaterial color="#2a3344" roughness={0.5} emissive="#1b6fff" emissiveIntensity={0.3} />
        </mesh>
        {/* backpack */}
        <mesh position={[0, 0.22, -0.34]}>
          <boxGeometry args={[0.5, 0.6, 0.28]} />
          <meshStandardMaterial color="#c4ccd8" roughness={0.6} metalness={0.1} />
        </mesh>
        {/* arms */}
        <mesh position={[-0.5, 0.2, 0]} rotation={[0, 0, 0.5]}>
          <capsuleGeometry args={[0.13, 0.5, 5, 12]} />
          <meshStandardMaterial color={suit} roughness={0.55} />
        </mesh>
        <mesh position={[0.5, 0.2, 0]} rotation={[0, 0, -0.5]}>
          <capsuleGeometry args={[0.13, 0.5, 5, 12]} />
          <meshStandardMaterial color={suit} roughness={0.55} />
        </mesh>
        {/* legs */}
        <mesh position={[-0.2, -0.55, 0]} rotation={[0.2, 0, 0.08]}>
          <capsuleGeometry args={[0.15, 0.55, 5, 12]} />
          <meshStandardMaterial color={suit} roughness={0.55} />
        </mesh>
        <mesh position={[0.2, -0.55, 0]} rotation={[-0.15, 0, -0.08]}>
          <capsuleGeometry args={[0.15, 0.55, 5, 12]} />
          <meshStandardMaterial color={suit} roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
}
