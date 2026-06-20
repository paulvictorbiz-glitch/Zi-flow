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

/* Bright thin ring on a transparent field — used for the Einstein /
   photon ring around the black holes and the expanding gravitational-
   wave shockwave. `rInner`/`rOuter` are 0..0.5 fractions of the canvas. */
export function makeRingTexture(rInner = 0.34, rOuter = 0.46, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, rInner * size, cx, cx, rOuter * size);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, (rOuter + 0.02) * size, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* Soft elongated streak (bright head → faded tail), oriented along +x.
   Used for comet/shooting-star tails as an additive billboard. */
export function makeStreakTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 4;
  const ctx = canvas.getContext("2d");
  const h = canvas.height;
  const g = ctx.createLinearGradient(size, 0, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  // taper the tail vertically so it reads as a comet streak
  ctx.beginPath();
  ctx.moveTo(size, h / 2 - h * 0.42);
  ctx.lineTo(size, h / 2 + h * 0.42);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* Faint spiral-galaxy sprite: bright core + two sweeping arms of dots.
   A cheap stand-in for a distant galaxy (one additive billboard). */
export function makeGalaxyTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  ctx.globalCompositeOperation = "lighter";
  // bright bulge
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.16);
  core.addColorStop(0, "rgba(255,250,235,1)");
  core.addColorStop(1, "rgba(255,240,210,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  // two logarithmic spiral arms made of fading dots
  for (let arm = 0; arm < 2; arm++) {
    const base = arm * Math.PI;
    for (let i = 0; i < 140; i++) {
      const t = i / 140;
      const ang = base + t * Math.PI * 2.4;
      const rad = t * size * 0.46;
      const x = cx + Math.cos(ang) * rad;
      const y = cx + Math.sin(ang) * rad * 0.62; // flatten the disk
      const a = (1 - t) * 0.5;
      const dot = ctx.createRadialGradient(x, y, 0, x, y, size * 0.03);
      dot.addColorStop(0, `rgba(180,205,255,${a})`);
      dot.addColorStop(1, "rgba(180,205,255,0)");
      ctx.fillStyle = dot;
      ctx.fillRect(x - 8, y - 8, 16, 16);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* ─────────────────────────────────────────────────────────
   GLSL noise — Ashima 3D simplex noise + a 5-octave fbm. Exported as a
   string so any ShaderMaterial (sun surface, plasma beams, gas-giant
   storms) can prepend it and call snoise()/fbm(). */
export const GLSL_NOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float f=0.0; float a=0.5; for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.02; a*=0.5; } return f; }
`;

/* Additive fresnel-rim material — bright at grazing angles, transparent
   face-on. Used for stellar coronae and planet atmospheres. */
export function makeFresnelMaterial({ color = "#88aaff", power = 3.0, intensity = 1.0, side = THREE.BackSide }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPower; uniform float uIntensity; varying vec3 vN; varying vec3 vV;
      void main(){ float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),uPower); gl_FragColor=vec4(uColor, f*uIntensity); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    toneMapped: false,
  });
}

/* Gaseous plasma material for beams/flares/jets: flowing fbm along a
   cone's UVs, bright base → faint tip, soft tube edges. Additive. Caller
   updates uTime each frame. */
const PLASMA_FRAG = `
uniform float uTime; uniform vec3 uColA; uniform vec3 uColB; uniform float uFade;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float n = fbm(vec3(vUv*vec2(5.0,3.0), uTime*0.7));
  float body = smoothstep(1.0, uFade, vUv.y);          // base→tip falloff
  float edge = smoothstep(0.5, 0.12, abs(vUv.x-0.5));  // fade tube edges
  float a = body * edge * (0.35 + 0.65*max(n,0.0));
  vec3 col = mix(uColB, uColA, clamp(n*0.7+0.4,0.0,1.0));
  gl_FragColor = vec4(col, a);
}`;
export function makePlasmaMaterial(colA, colB, fade = 0.05) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(colA) },
      uColB: { value: new THREE.Color(colB) },
      uFade: { value: fade },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: PLASMA_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

/* Turbulent accretion-disk material (for the black holes): swirling fbm
   bands, hot-inner→cool-outer temperature ramp, relativistic doppler
   beaming (one side brighter), edge fades. Radius/angle derived from the
   ring's LOCAL xy. Caller updates uTime each frame. Additive. */
const ACCRETION_FRAG = `
uniform float uTime; uniform float uRIn; uniform float uROut; uniform float uSpin;
uniform vec3 uInner; uniform vec3 uOuter;
varying vec3 vLocal;
${GLSL_NOISE}
void main(){
  vec2 q = vLocal.xy;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float rn = clamp((r-uRIn)/(uROut-uRIn), 0.0, 1.0);
  float swirl = fbm(vec3(cos(ang)*3.0, sin(ang)*3.0, r*0.5 - uTime*uSpin));
  float bands = 0.5 + 0.5*sin(ang*2.0 + r*1.6 - uTime*uSpin*2.0 + swirl*3.0);
  vec3 col = mix(uInner, uOuter, pow(rn, 0.6));
  col *= (0.55 + 0.85*bands) * (1.45 - rn*0.7);
  float doppler = 0.55 + 0.7*smoothstep(-1.0, 1.0, cos(ang));  // approaching side brighter
  col *= doppler;
  float edge = smoothstep(0.0, 0.07, rn) * smoothstep(1.0, 0.82, rn);
  float a = edge * (0.45 + 0.55*bands);
  gl_FragColor = vec4(col*1.35, a);
}`;
export function makeAccretionDiskMaterial({ rIn, rOut, inner = "#dff0ff", outer = "#ff7a26", spin = 1.0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uRIn: { value: rIn }, uROut: { value: rOut }, uSpin: { value: spin },
      uInner: { value: new THREE.Color(inner) }, uOuter: { value: new THREE.Color(outer) },
    },
    vertexShader: `varying vec3 vLocal; void main(){ vLocal=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: ACCRETION_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

/* Volumetric-looking nebula material (for a billboard plane): domain-
   warped fbm density, 3-colour mix, radial falloff so it stays cloud-
   shaped, slow drift via uTime. Additive. */
const NEBULA_FRAG = `
uniform float uTime; uniform float uDensity; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  vec2 uv = vUv*2.0 - 1.0;
  float L = length(uv);
  vec3 p = vec3(uv*1.7, uTime*0.025);
  float w = fbm(p);
  float d = fbm(p*1.7 + w*1.2);
  float density = fbm(p*2.6 + d*1.5);
  density = smoothstep(0.0, 0.72, density + 0.30);
  // even-perimeter diffusion: spread gas mid→rim instead of spiking at
  // the centre, then a soft outer edge fade so it stays cloud-shaped.
  float perim = 0.45 + 0.55 * smoothstep(0.15, 0.92, L);
  density *= perim;
  density *= smoothstep(1.18, 0.02, L);
  // patchy low-frequency hue fields → soft gaseous regions tinted with
  // different colour hints (no visible dots), all within the same gas.
  float h1 = fbm(p*0.55 + 12.0);
  float h2 = fbm(p*0.85 + 31.0);
  float h3 = fbm(p*1.10 + 47.0);
  vec3 col = uC1;
  col = mix(col, uC2, smoothstep(-0.25, 0.45, h1));
  col = mix(col, uC3, smoothstep(0.05, 0.60, h2) * 0.7);
  col = mix(col, uC4, smoothstep(0.15, 0.65, h3) * 0.6);
  gl_FragColor = vec4(col, density*0.8*uDensity);
}`;
export function makeNebulaMaterial({ c1 = "#9650dc", c2 = "#3ca0d2", c3 = "#e678c8", c4 = "#8ef0b8" }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uDensity: { value: 1 },
      uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uC3: { value: new THREE.Color(c3) }, uC4: { value: new THREE.Color(c4) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: NEBULA_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

/* Spaceship hull maps: a dark panelled albedo + a matching emissive map
   with glowing windows. Returns { map, emissive } CanvasTextures. */
export function makeHullTexture({ base = "#3a414c", line = "#23272e", win = "#9fe6ff", w = 256, h = 128 } = {}) {
  const albedo = document.createElement("canvas"); albedo.width = w; albedo.height = h;
  const em = document.createElement("canvas"); em.width = w; em.height = h;
  const a = albedo.getContext("2d"), e = em.getContext("2d");
  a.fillStyle = base; a.fillRect(0, 0, w, h);
  e.fillStyle = "#000"; e.fillRect(0, 0, w, h);
  // panel grid
  a.strokeStyle = line; a.lineWidth = 1;
  for (let x = 0; x <= w; x += 16) { a.beginPath(); a.moveTo(x, 0); a.lineTo(x, h); a.stroke(); }
  for (let y = 0; y <= h; y += 16) { a.beginPath(); a.moveTo(0, y); a.lineTo(w, y); a.stroke(); }
  // subtle panel shade variation + glowing windows
  for (let i = 0; i < 90; i++) {
    const px = (i * 53) % w, py = (i * 31) % h;
    const s = ((i * 17) % 100) / 100;
    a.globalAlpha = 0.12; a.fillStyle = s > 0.5 ? "#ffffff" : "#000000";
    a.fillRect((px / 16 | 0) * 16, (py / 16 | 0) * 16, 16, 16);
    if (s > 0.72) { e.fillStyle = win; e.fillRect(px % (w - 4), 2 + (py % (h - 6)), 3, 2); }
  }
  a.globalAlpha = 1;
  const map = new THREE.CanvasTexture(albedo);
  const emissive = new THREE.CanvasTexture(em);
  map.needsUpdate = emissive.needsUpdate = true;
  return { map, emissive };
}

/* ── tiny canvas helpers for procedural planet maps ── */
function hexRGB(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const rgbStr = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
// cheap deterministic value-noise in JS (good enough for a one-off texture)
function vnoise(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/* Banded gas-giant albedo map (equirectangular → latitude bands + storms). */
export function makeBandedTexture({ a = "#caa46a", b = "#7c5a34", bands = 9, storm = "#e8d0a0", w = 512, h = 256 }) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const ca = hexRGB(a), cb = hexRGB(b);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let v = Math.sin(t * Math.PI * bands) * 0.5 + 0.5;
    v += 0.22 * Math.sin(t * Math.PI * bands * 3.1 + 1.3);
    v += 0.12 * (vnoise(0, y * 0.3) - 0.5);
    v = Math.max(0, Math.min(1, v));
    ctx.fillStyle = rgbStr(mixRGB(ca, cb, v));
    ctx.fillRect(0, y, w, 1);
  }
  // a few elliptical storms
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 7; i++) {
    const sx = vnoise(i, 1) * w, sy = (0.2 + vnoise(i, 2) * 0.6) * h;
    const rx = 14 + vnoise(i, 3) * 40, ry = 6 + vnoise(i, 4) * 12;
    ctx.fillStyle = i % 2 ? storm : rgbStr(cb);
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* Rocky/cratered albedo map. */
export function makeRockyTexture({ base = "#9c7b5a", dark = "#5a4634", light = "#c4a784", w = 512, h = 256 }) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const cd = dark, cl = light;
  for (let i = 0; i < 320; i++) {
    const x = vnoise(i, 5) * w, y = vnoise(i, 6) * h;
    const r = 2 + vnoise(i, 7) * 16;
    ctx.globalAlpha = 0.12 + vnoise(i, 8) * 0.25;
    ctx.fillStyle = vnoise(i, 9) > 0.5 ? cd : cl;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
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

/* Generic accretion-disk point cloud (hot inner → cool outer), returned
   as a {geo, mat} builder thunk so callers can useMemo it. Shared by the
   galaxy core and the binary-black-hole disks (different palettes/radii). */
export function makeDiskBuilder({ count, rIn, rOut, inner = "#cfe6ff", outer = "#ff6a1a", thickness = 0.04 }) {
  return () => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const ci = new THREE.Color(inner);
    const co = new THREE.Color(outer);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const radius = rIn + (rOut - rIn) * Math.sqrt(Math.random());
      const ang = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(ang) * radius;
      pos[i * 3 + 1] = (Math.random() - 0.5) * (0.4 + radius * thickness);
      pos[i * 3 + 2] = Math.sin(ang) * radius;
      const tNorm = (radius - rIn) / (rOut - rIn);
      c.copy(ci).lerp(co, tNorm).multiplyScalar(1.45 - tNorm * 0.6);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 0.6 + Math.random() * 0.9;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = makePointMaterial(0);
    return { geo, mat };
  };
}

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
