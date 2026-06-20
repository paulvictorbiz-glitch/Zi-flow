/* =========================================================
   Skydome — L1 deep-space backdrop for the /space scene.

   A large inward-facing sphere with a vertical gradient. Its real job
   is to give the post-processing bloom pass an OPAQUE backdrop to
   composite over: the Canvas is alpha:true/transparent, and bloom over
   pure transparency leaves black-box artifacts. Filling the view with a
   dark space gradient fixes that while still looking like deep space.

   Tinted by the `bg` pref so the existing s3d background choices keep
   meaning. Cheap: one big sphere, BasicMaterial, no lighting.
   ========================================================= */
import React, { useMemo, useEffect } from "react";
import * as THREE from "three";

/* bg pref → [top, mid, bottom] gradient stops. */
const PALETTES = {
  nebula: ["#0a0618", "#140a2a", "#05030d"],
  deep:   ["#01030a", "#040a1a", "#010206"],
  aurora: ["#02110f", "#06231f", "#020a0c"],
  ember:  ["#120606", "#1f0c0a", "#070303"],
};

function makeGradientTexture(stops) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export default function Skydome({ bg = "nebula" }) {
  const tex = useMemo(() => makeGradientTexture(PALETTES[bg] || PALETTES.nebula), [bg]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh scale={[-1, 1, 1]} frustumCulled={false}>
      {/* inverted scale renders the inside faces toward the camera */}
      <sphereGeometry args={[480, 32, 32]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  );
}
