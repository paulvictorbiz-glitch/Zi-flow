/* =========================================================
   Sun — L1 hyper-real star + textured solar system. Fully param-driven
   (position via az/el/dist, surface speed/detail/brightness/colour,
   flare intensity, orbit speed, size) from the Scene Studio sidebar.
   ========================================================= */
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  ADDITIVE, GLSL_NOISE,
  makeHaloTexture, makeFresnelMaterial, makeBandedTexture, makeRockyTexture, makePlasmaMaterial,
} from "./celestial-shared.js";
import { posFromAED, DEFAULT_SCENE } from "../../lib/space-scene-params.jsx";

const SUN_R = 4;

const PLANETS = [
  { r: 6,  speed: 0.25, size: 0.5,  tilt: 0.1,  kind: "rocky", tex: { base: "#9c7b5a", dark: "#5a4634", light: "#c4a784" }, atmo: null },
  { r: 9,  speed: 0.17, size: 0.95, tilt: -0.2, kind: "gas",   tex: { a: "#8fbfe0", b: "#3f6f99", bands: 8,  storm: "#cfe6ff" }, atmo: "#6fa8c8", ring: true },
  { r: 13, speed: 0.11, size: 0.7,  tilt: 0.05, kind: "rocky", tex: { base: "#b5633a", dark: "#6e2f17", light: "#e0986a" }, atmo: "#e0865a" },
  { r: 17, speed: 0.07, size: 1.2,  tilt: 0.3,  kind: "gas",   tex: { a: "#d8c39a", b: "#9c6f3e", bands: 11, storm: "#f0e0b8" }, atmo: "#caa46a" },
];

const SUN_VERT = `
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
void main(){
  vPos = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SUN_FRAG = `
uniform float uTime; uniform float uTurb; uniform float uIntensity;
uniform vec3 uHot; uniform vec3 uMid;
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
${GLSL_NOISE}
void main(){
  vec3 p = normalize(vPos);
  float gran  = fbm(p*7.0*uTurb + vec3(0.0, uTime*0.06, 0.0));
  float cells = fbm(p*3.0*uTurb - vec3(uTime*0.035));
  float surf  = gran*0.55 + cells*0.45;
  float spotN = fbm(p*1.7*uTurb + 11.0);
  float spot  = smoothstep(0.40, 0.60, spotN);
  vec3 cool = uMid*0.4;
  vec3 col = mix(cool, uMid, smoothstep(-0.5,0.35,surf));
  col = mix(col, uHot, smoothstep(0.25,0.85,surf));
  col = mix(col, vec3(0.22,0.07,0.02), spot*0.88);
  float limb = pow(1.0 - max(dot(normalize(vN),normalize(vV)),0.0), 2.2);
  col += uHot * limb * 0.6;
  gl_FragColor = vec4(col*1.35*uIntensity, 1.0);
}`;

function Planet({ p, phase, oref }) {
  const tex = useMemo(() => (p.kind === "gas" ? makeBandedTexture(p.tex) : makeRockyTexture(p.tex)), [p]);
  const atmoMat = useMemo(() => (p.atmo ? makeFresnelMaterial({ color: p.atmo, power: 3.2, intensity: 0.9 }) : null), [p.atmo]);
  useEffect(() => () => { tex.dispose(); if (atmoMat) atmoMat.dispose(); }, [tex, atmoMat]);
  return (
    <group ref={oref} rotation={[p.tilt, phase, 0]}>
      <group position={[p.r, 0, 0]}>
        <mesh rotation={[0, 0, 0.2]}>
          <sphereGeometry args={[p.size, 32, 32]} />
          <meshStandardMaterial map={tex} roughness={0.85} metalness={0.05} />
        </mesh>
        {atmoMat && (
          <mesh scale={1.18}>
            <sphereGeometry args={[p.size, 24, 24]} />
            <primitive object={atmoMat} attach="material" />
          </mesh>
        )}
        {p.ring && (
          <mesh rotation={[Math.PI / 2.2, 0, 0]}>
            <ringGeometry args={[p.size * 1.5, p.size * 2.3, 64]} />
            <meshBasicMaterial color="#d8c8a4" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

export function Sun({ reduced, params }) {
  const p = { ...DEFAULT_SCENE.sun, ...params };
  const halo = useMemo(() => makeHaloTexture(), []);
  const target = useMemo(() => new THREE.Object3D(), []);
  const phases = useMemo(() => PLANETS.map(() => Math.random() * Math.PI * 2), []);
  const orbits = useRef([]);
  const promRefs = useRef([]);

  const sunMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uTurb: { value: 1 }, uIntensity: { value: 1 },
      uHot: { value: new THREE.Color("#fff0c2") }, uMid: { value: new THREE.Color("#ff8c26") },
    },
    vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, toneMapped: false,
  }), []);
  const coronaMat = useMemo(() => makeFresnelMaterial({ color: "#ff8a3a", power: 2.4, intensity: 1.1, side: THREE.BackSide }), []);

  const proms = useMemo(() => {
    const out = []; const N = 6;
    for (let i = 0; i < N; i++) {
      const phi = Math.acos(2 * ((i + 0.5) / N) - 1);
      const theta = i * 2.399;
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      out.push({ pos: dir.clone().multiplyScalar(SUN_R * 0.96).toArray(), quat: [q.x, q.y, q.z, q.w], base: 0.8 + (i % 3) * 0.25, mat: makePlasmaMaterial(i % 2 ? "#ffd27a" : "#ff7a30", "#ff3a0c") });
    }
    return out;
  }, []);
  useEffect(() => () => { halo.dispose(); sunMat.dispose(); coronaMat.dispose(); proms.forEach((x) => x.mat.dispose()); }, [halo, sunMat, coronaMat, proms]);

  const pos = useMemo(() => posFromAED(p.az, p.el, p.dist), [p.az, p.el, p.dist]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    sunMat.uniforms.uTime.value = t * p.speed;
    sunMat.uniforms.uTurb.value = p.turbulence;
    sunMat.uniforms.uIntensity.value = p.intensity;
    sunMat.uniforms.uHot.value.set(p.hot);
    sunMat.uniforms.uMid.value.set(p.mid);
    for (let i = 0; i < proms.length; i++) {
      proms[i].mat.uniforms.uTime.value = t * p.speed;
      const m = promRefs.current[i];
      if (m) { m.visible = p.prominence > 0.02; const s = proms[i].base * p.prominence; m.scale.set(s, s * 1.6, s); }
    }
    if (reduced) return;
    for (let i = 0; i < PLANETS.length; i++) {
      const g = orbits.current[i];
      if (g) g.rotation.y += dt * PLANETS[i].speed * p.planetSpeed;
    }
  });

  if (p.visible === false) return null;

  return (
    <group position={pos} scale={p.scale}>
      <primitive object={target} position={[-pos[0], -pos[1], -pos[2]]} />
      <directionalLight intensity={2.4} color="#fff2d6" target={target} />

      <mesh>
        <sphereGeometry args={[SUN_R, 96, 96]} />
        <primitive object={sunMat} attach="material" />
      </mesh>

      <mesh scale={1.18}>
        <sphereGeometry args={[SUN_R, 48, 48]} />
        <primitive object={coronaMat} attach="material" />
      </mesh>

      {proms.map((pr, i) => (
        <mesh key={i} ref={(el) => (promRefs.current[i] = el)} position={pr.pos} quaternion={pr.quat} material={pr.mat}>
          <coneGeometry args={[0.7, 3.2, 20, 1, true]} />
        </mesh>
      ))}

      <sprite scale={[34, 34, 34]}>
        <spriteMaterial map={halo} color="#ffd27a" opacity={0.7} {...ADDITIVE} />
      </sprite>
      <sprite scale={[64, 64, 64]}>
        <spriteMaterial map={halo} color="#ff9a3c" opacity={0.28} {...ADDITIVE} />
      </sprite>

      {PLANETS.map((pl, i) => (
        <Planet key={i} p={pl} phase={phases[i]} oref={(el) => (orbits.current[i] = el)} />
      ))}
    </group>
  );
}

export default Sun;
