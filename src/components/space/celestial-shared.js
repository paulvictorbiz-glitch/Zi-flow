/* =========================================================
   celestial-shared — L1 shared helpers for the /space scene.

   Plain JS (no JSX/React). Centralises the bits that the galaxy
   backdrop and its set-pieces (Nebula, Sun, NeutronStar,
   SpaceBattle) all reuse, so they aren't copy-pasted per file:
     · makeHaloTexture()           — soft radial-gradient sprite map
     · makeRadialGradientTexture() — multi-blob additive cloud map
     · makePointMaterial()         — the additive twinkling-point shader
     · ADDITIVE                     — the additive-blend material bag
     · SUN_POS                      — sun position, shared so the cube's
                                      reflection key-light matches the
                                      real sun light direction
   ========================================================= */
import * as THREE from "three";

/* Sun lives opposite the black hole (which sits at z = -140). Shared
   so Sun.jsx's light and the cube's Environment key-light agree. */
export const SUN_POS = [60, 24, 70];

/* Standard additive-glow material props: never z-fights, never
   occludes the cube, never tone-mapped to grey. */
export const ADDITIVE = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
};

/* Soft white radial-gradient halo (for additive glow sprites). */
export function makeHaloTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* Multi-blob additive cloud texture (for the nebula). `blobs` is an
   array of { x, y, r, c } in 0..1 fractions of the canvas; colors are
   composited with "lighter" so they bloom where they overlap. */
export function makeRadialGradientTexture(blobs, size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  blobs.forEach((b) => {
    const g = ctx.createRadialGradient(b.x * size, b.y * size, 0, b.x * size, b.y * size, b.r * size);
    g.addColorStop(0, b.c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* ---- shared additive point shader (custom aColor; twinkle gated by uTwinkle) ---- */
export const POINT_VERT = `
uniform float uTime; uniform float uDpr; uniform float uTwinkle;
attribute float aSize; attribute float aPhase; attribute vec3 aColor;
varying vec3 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float tw = mix(1.0, 0.65 + 0.35*sin(uTime*2.0 + aPhase), uTwinkle);
  gl_PointSize = aSize * uDpr * tw * (160.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

export const POINT_FRAG = `
varying vec3 vColor;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export function makePointMaterial(twinkle) {
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: dpr },
      uTwinkle: { value: twinkle },
    },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}
