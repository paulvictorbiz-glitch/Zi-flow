/* =========================================================
   space-scene-params — L0 data for the /space customization system.

   Default per-body tunables + the control SCHEMA that the SpaceControls
   sidebar renders into sliders / colour pickers / toggles, plus a tiny
   helper to turn azimuth/elevation/distance into a world position.

   Pure data + one pure function. No React, no three.js.
   ========================================================= */

/* azimuth (deg, around Y) + elevation (deg) + distance → [x,y,z]. */
export function posFromAED(az, el, dist) {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return [dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a)];
}

/* Defaults chosen to match the current hand-placed scene. */
export const DEFAULT_SCENE = {
  global:     { autoRotate: 0.5, bloom: 0.85, masterVolume: 0.6, muted: true },
  sun:        { visible: true, az: 35, el: 22, dist: 88, scale: 1, speed: 1, planetSpeed: 1, intensity: 1, turbulence: 1, prominence: 1, hot: "#fff0c2", mid: "#ff8c26", sound: true, volume: 0.5 },
  pulsar:     { visible: true, az: 125, el: -28, dist: 70, scale: 1.1, spin: 5.5, beamLength: 1, jet: 1, beamColor: "#bcd2ff", coreColor: "#6a4cff", sound: true, volume: 0.45 },
  binaryBH:   { visible: true, az: -145, el: 30, dist: 120, scale: 1, loopSpeed: 1, diskSpin: 1, diskInner: "#dff0ff", diskOuter: "#ff7a26", sound: true, volume: 0.5 },
  nebula:     { visible: true, az: -55, el: -18, dist: 150, scale: 1, drift: 1, density: 1, c1: "#9650dc", c2: "#3ca0d2", c3: "#e678c8", c4: "#8ef0b8", sound: true, volume: 0.4 },
  galaxyCore: { visible: true, spin: 1, intensity: 1, sound: true, volume: 0.4 },
  fleet:      { visible: true, scale: 0.85, fireRate: 1, color: "#9fe6ff", sound: true, volume: 0.35 },
  lens:       { visible: true, opacity: 0.78, size: 1, warpSpeed: 1, angle: 1, az: 35, el: 22, dist: 22, sound: false, volume: 0 },
  astronaut:  { visible: true, scale: 1, spin: 0.6, bob: 1, suit: "#e8edf4", visor: "#0a1830", az: -22, el: -6, dist: 30, sound: false, volume: 0 },
};

const AED = (label) => [
  { key: "az", type: "slider", label: "Direction (azimuth)", min: -180, max: 180, step: 1 },
  { key: "el", type: "slider", label: "Elevation", min: -90, max: 90, step: 1 },
  { key: "dist", type: "slider", label: "Distance", min: 30, max: 220, step: 1 },
];
const SOUND = [
  { key: "sound", type: "toggle", label: "Sound on" },
  { key: "volume", type: "slider", label: "Volume", min: 0, max: 1, step: 0.02 },
];
/* az/el/dist for close-in set-pieces (lens, astronaut) — allows nearer distances. */
const AED2 = () => [
  { key: "az", type: "slider", label: "Direction (azimuth)", min: -180, max: 180, step: 1 },
  { key: "el", type: "slider", label: "Elevation", min: -90, max: 90, step: 1 },
  { key: "dist", type: "slider", label: "Distance", min: 8, max: 220, step: 1 },
];

/* The bodies shown in the sidebar + the controls each exposes. */
export const BODIES = [
  {
    id: "sun", label: "☀  Sun & Planets", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "speed", type: "slider", label: "Surface speed", min: 0, max: 3, step: 0.05 },
      { key: "planetSpeed", type: "slider", label: "Orbit speed", min: 0, max: 3, step: 0.05 },
      { key: "intensity", type: "slider", label: "Brightness", min: 0.2, max: 2.5, step: 0.05 },
      { key: "turbulence", type: "slider", label: "Surface detail", min: 0.3, max: 2.5, step: 0.05 },
      { key: "prominence", type: "slider", label: "Solar flares", min: 0, max: 2.5, step: 0.05 },
      { key: "scale", type: "slider", label: "Size", min: 0.3, max: 3, step: 0.05 },
      { key: "hot", type: "color", label: "Hot colour" },
      { key: "mid", type: "color", label: "Surface colour" },
      ...AED(), ...SOUND,
    ],
  },
  {
    id: "pulsar", label: "✦  Neutron Star", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "spin", type: "slider", label: "Spin speed", min: 0, max: 14, step: 0.1 },
      { key: "beamLength", type: "slider", label: "Beam length", min: 0.3, max: 2.5, step: 0.05 },
      { key: "jet", type: "slider", label: "Jet intensity", min: 0, max: 2.5, step: 0.05 },
      { key: "scale", type: "slider", label: "Size", min: 0.3, max: 3, step: 0.05 },
      { key: "beamColor", type: "color", label: "Beam colour" },
      { key: "coreColor", type: "color", label: "Core glow" },
      ...AED(), ...SOUND,
    ],
  },
  {
    id: "binaryBH", label: "◐  Binary Black Holes", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "loopSpeed", type: "slider", label: "Merge speed", min: 0.1, max: 3, step: 0.05 },
      { key: "diskSpin", type: "slider", label: "Disk swirl", min: 0, max: 3, step: 0.05 },
      { key: "scale", type: "slider", label: "Size", min: 0.3, max: 3, step: 0.05 },
      { key: "diskInner", type: "color", label: "Disk inner" },
      { key: "diskOuter", type: "color", label: "Disk outer" },
      ...AED(), ...SOUND,
    ],
  },
  {
    id: "nebula", label: "☁  Nebula", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "drift", type: "slider", label: "Drift speed", min: 0, max: 3, step: 0.05 },
      { key: "density", type: "slider", label: "Density", min: 0.2, max: 2.5, step: 0.05 },
      { key: "scale", type: "slider", label: "Size", min: 0.4, max: 2.5, step: 0.05 },
      { key: "c1", type: "color", label: "Colour · purple" },
      { key: "c2", type: "color", label: "Colour · blue" },
      { key: "c3", type: "color", label: "Colour · pink" },
      { key: "c4", type: "color", label: "Colour · green" },
      ...AED(), ...SOUND,
    ],
  },
  {
    id: "galaxyCore", label: "✺  Galactic Core", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "spin", type: "slider", label: "Disk spin", min: 0, max: 3, step: 0.05 },
      { key: "intensity", type: "slider", label: "Brightness", min: 0.3, max: 2.5, step: 0.05 },
      ...SOUND,
    ],
  },
  {
    id: "fleet", label: "✈  Battle Fleet", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "fireRate", type: "slider", label: "Fire rate", min: 0, max: 3, step: 0.05 },
      { key: "scale", type: "slider", label: "Size", min: 0.3, max: 2, step: 0.05 },
      { key: "color", type: "color", label: "Laser colour" },
      ...SOUND,
    ],
  },
  {
    id: "lens", label: "✧  Gravitational Lens", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "opacity", type: "slider", label: "Ring opacity", min: 0, max: 1, step: 0.02 },
      { key: "size", type: "slider", label: "Ring size", min: 0.3, max: 3, step: 0.05 },
      { key: "warpSpeed", type: "slider", label: "Warp speed", min: 0.3, max: 3, step: 0.05 },
      { key: "angle", type: "slider", label: "Appears across angle", min: 0.2, max: 3, step: 0.05 },
      ...AED2(),
    ],
  },
  {
    id: "astronaut", label: "🧑‍🚀  Astronaut", controls: [
      { key: "visible", type: "toggle", label: "Visible" },
      { key: "scale", type: "slider", label: "Size", min: 0.3, max: 4, step: 0.05 },
      { key: "spin", type: "slider", label: "Spin speed", min: 0, max: 3, step: 0.05 },
      { key: "bob", type: "slider", label: "Float bob", min: 0, max: 3, step: 0.05 },
      { key: "suit", type: "color", label: "Suit colour" },
      { key: "visor", type: "color", label: "Visor tint" },
      ...AED2(),
    ],
  },
];

export const GLOBAL_CONTROLS = [
  { key: "autoRotate", type: "slider", label: "Auto-rotate", min: 0, max: 3, step: 0.05 },
  { key: "bloom", type: "slider", label: "Bloom glow", min: 0, max: 2.5, step: 0.05 },
  { key: "masterVolume", type: "slider", label: "Master volume", min: 0, max: 1, step: 0.02 },
  { key: "muted", type: "toggle", label: "Mute all sound" },
];

/* Merge persisted params over defaults (per-body), tolerating missing keys. */
export function hydrateScene(saved) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SCENE)) out[k] = { ...DEFAULT_SCENE[k], ...(saved && saved[k]) };
  return out;
}
