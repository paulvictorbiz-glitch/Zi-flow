/* ─────────────────────────────────────────────────────
   HudGlobe3D — WebGL "GitHub globe" (three-globe / R3F)
   Smoother replacement for the old 2D-canvas HudGlobe.
   Ported from Aceternity UI's github-globe to plain JSX,
   self-contained (config + arcs + helpers inlined) and
   wired LIVE to the HUD layout-menu prefs:
     globeSpin  → auto-rotate speed
     globeZoom  → camera distance
     globeDots  → glowing point size + ring reach
     globeArc   → arc animation speed
     globeAtmo  → atmosphere glow
─────────────────────────────────────────────────────── */
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Color, Fog, PerspectiveCamera, Vector3, Scene } from "three";
import { extend, Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ThreeGlobe from "three-globe";
import countries from "../data/globe.json";

extend({ ThreeGlobe });

/* ── helpers (inlined) ─────────────────────────────── */
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}
function genRandomNumbers(min, max, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.floor(Math.random() * (max - min + 1)) + min);
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const RING_PROPAGATION_SPEED = 3;
const aspect = 1.2;
const cameraZ = 300;

const staticProps = {
  atmosphereColor: "#5cc9ff",
  polygonColor: "rgba(120,200,255,0.7)",
  globeColor: "#0a2540",
  emissive: "#0a2540",
  emissiveIntensity: 0.12,
  shininess: 0.9,
  arcLength: 0.9,
  rings: 1,
};

let numbersOfRings = [0];

/* live-tunable prefs → concrete globe values (with sane fallbacks) */
function readLive(prefs) {
  const p = prefs || {};
  return {
    spin: p.globeSpin ?? 1,
    zoom: clamp(p.globeZoom ?? 1, 0.5, 1.8),
    dots: clamp(p.globeDots ?? 1, 0, 3),
    arc: clamp(p.globeArc ?? 1, 0.3, 3),
    atmo: clamp(p.globeAtmo ?? 1, 0, 2),
  };
}

function Globe({ data, live }) {
  const [globeData, setGlobeData] = useState(null);
  const globeRef = useRef(null);

  /* build points + material ONCE (heavy) — keyed on data only */
  useEffect(() => {
    if (!globeRef.current) return;

    let points = [];
    for (let i = 0; i < data.length; i++) {
      const arc = data[i];
      const rgb = hexToRgb(arc.color);
      points.push({ order: arc.order, color: (t) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${1 - t})`, lat: arc.startLat, lng: arc.startLng });
      points.push({ order: arc.order, color: (t) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${1 - t})`, lat: arc.endLat, lng: arc.endLng });
    }
    const filteredPoints = points.filter(
      (v, i, a) => a.findIndex((v2) => v2.lat === v.lat && v2.lng === v.lng) === i
    );
    setGlobeData(filteredPoints);

    const m = globeRef.current.globeMaterial();
    m.color = new Color(staticProps.globeColor);
    m.emissive = new Color(staticProps.emissive);
    m.emissiveIntensity = staticProps.emissiveIntensity;
    m.shininess = staticProps.shininess;
  }, [data]);

  /* build hex polygons + arcs + points + rings ONCE — keyed on data */
  useEffect(() => {
    if (!globeRef.current || !globeData) return;

    globeRef.current
      .hexPolygonsData(countries.features)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.7)
      .showAtmosphere(true)
      .atmosphereColor(staticProps.atmosphereColor)
      .atmosphereAltitude(0.1)
      .hexPolygonColor(() => staticProps.polygonColor);

    globeRef.current
      .arcsData(data)
      .arcStartLat((d) => d.startLat)
      .arcStartLng((d) => d.startLng)
      .arcEndLat((d) => d.endLat)
      .arcEndLng((d) => d.endLng)
      .arcColor((e) => e.color)
      .arcAltitude((e) => e.arcAlt)
      .arcStroke(() => [0.32, 0.28, 0.3][Math.round(Math.random() * 2)])
      .arcDashLength(staticProps.arcLength)
      .arcDashInitialGap((e) => e.order)
      .arcDashGap(15)
      .arcDashAnimateTime(1000);

    globeRef.current
      .pointsData(data)
      .pointColor((e) => e.color)
      .pointsMerge(true)
      .pointAltitude(0.0)
      .pointRadius(2);

    globeRef.current
      .ringsData([])
      .ringColor((e) => (t) => e.color(t))
      .ringMaxRadius(3)
      .ringPropagationSpeed(RING_PROPAGATION_SPEED)
      .ringRepeatPeriod((1000 * staticProps.arcLength) / staticProps.rings);
  }, [globeData, data]);

  /* pulsing rings ticker */
  useEffect(() => {
    const interval = setInterval(() => {
      if (!globeRef.current || !globeData) return;
      numbersOfRings = genRandomNumbers(0, data.length, Math.floor((data.length * 4) / 5));
      globeRef.current.ringsData(globeData.filter((d, i) => numbersOfRings.includes(i)));
    }, 2000);
    return () => clearInterval(interval);
  }, [globeData, data]);

  /* ── LIVE effect tuning (cheap setters, keyed on individual prefs) ── */
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.pointRadius(1.1 + live.dots * 1.6);      // glowing dots size
    globeRef.current.ringMaxRadius(2 + live.dots * 2.2);      // ring reach
  }, [live.dots, globeData]);

  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.arcDashAnimateTime(1400 / live.arc);     // arc travel speed
    globeRef.current.ringRepeatPeriod((1400 / live.arc) * staticProps.arcLength);
  }, [live.arc, globeData]);

  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.showAtmosphere(live.atmo > 0.01);
    globeRef.current.atmosphereAltitude(0.06 + live.atmo * 0.09);
  }, [live.atmo, globeData]);

  return <threeGlobe ref={globeRef} />;
}

function WebGLRendererConfig() {
  const { gl, size } = useThree();
  useEffect(() => {
    gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    gl.setSize(size.width, size.height);
    gl.setClearColor(0x000000, 0);
  }, [gl, size]);
  return null;
}

/* Feed live prefs (spin + zoom) into OrbitControls every frame — smooth,
   no React re-render / globe rebuild. Reads from the prefs ref. */
function ControlsSync({ prefsRef, controlsRef, defaultBase }) {
  useFrame(() => {
    const c = controlsRef.current;
    if (!c) return;
    const l = readLive(prefsRef?.current);
    c.autoRotate = l.spin > 0.001;
    c.autoRotateSpeed = l.spin * defaultBase;
    const dist = clamp(cameraZ / l.zoom, 190, 560);           // zoom slider → distance
    c.minDistance = dist;
    c.maxDistance = dist;
  });
  return null;
}

function World({ data, prefsRef, interactive = true }) {
  const controlsRef = useRef(null);
  const [live, setLive] = useState(() => readLive(prefsRef?.current));

  /* poll the prefs ref for the effect-tuning values (dots/arc/atmo).
     Cheap: only updates React state when a value actually changes. */
  useEffect(() => {
    let raf;
    const tick = () => {
      const next = readLive(prefsRef?.current);
      setLive((prev) =>
        prev.dots === next.dots && prev.arc === next.arc && prev.atmo === next.atmo
          ? prev
          : next
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prefsRef]);

  const scene = useMemo(() => {
    const s = new Scene();
    s.fog = new Fog(0x0a2540, 400, 2000);
    return s;
  }, []);
  const camera = useMemo(() => new PerspectiveCamera(50, aspect, 180, 1800), []);

  return (
    <Canvas scene={scene} camera={camera}>
      <WebGLRendererConfig />
      <ambientLight color="#38bdf8" intensity={0.6} />
      <directionalLight color="#ffffff" position={new Vector3(-400, 100, 400)} />
      <directionalLight color="#ffffff" position={new Vector3(-200, 500, 200)} />
      <pointLight color="#ffffff" position={new Vector3(-200, 500, 200)} intensity={0.8} />
      <Globe data={data} live={live} />
      {/* Ambient globe: rotation OFF so it doesn't preventDefault pointerdown
          and swallow the container's dbl-click (autoRotate still spins it).
          Focus-mode globe: full drag-to-rotate. */}
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={false}
        enableRotate={interactive}
        enableDamping={true}
        dampingFactor={0.08}
        rotateSpeed={0.9}
        autoRotate={true}
        autoRotateSpeed={0.6}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI - Math.PI / 6}
      />
      <ControlsSync prefsRef={prefsRef} controlsRef={controlsRef} defaultBase={0.6} />
    </Canvas>
  );
}

const ARC_COLORS = ["#06b6d4", "#3b82f6", "#6366f1"];
const pick = () => ARC_COLORS[Math.floor(Math.random() * (ARC_COLORS.length - 1))];

const SAMPLE_ARCS = [
  { order: 1, startLat: -19.885592, startLng: -43.951191, endLat: -22.9068, endLng: -43.1729, arcAlt: 0.1 },
  { order: 1, startLat: 28.6139, startLng: 77.209, endLat: 3.139, endLng: 101.6869, arcAlt: 0.2 },
  { order: 1, startLat: -19.885592, startLng: -43.951191, endLat: -1.303396, endLng: 36.852443, arcAlt: 0.5 },
  { order: 2, startLat: 1.3521, startLng: 103.8198, endLat: 35.6762, endLng: 139.6503, arcAlt: 0.2 },
  { order: 2, startLat: 51.5072, startLng: -0.1276, endLat: 3.139, endLng: 101.6869, arcAlt: 0.3 },
  { order: 2, startLat: -15.785493, startLng: -47.909029, endLat: 36.162809, endLng: -115.119411, arcAlt: 0.3 },
  { order: 3, startLat: -33.8688, startLng: 151.2093, endLat: 22.3193, endLng: 114.1694, arcAlt: 0.3 },
  { order: 3, startLat: 21.3099, startLng: -157.8581, endLat: 40.7128, endLng: -74.006, arcAlt: 0.3 },
  { order: 3, startLat: -6.2088, startLng: 106.8456, endLat: 51.5072, endLng: -0.1276, arcAlt: 0.3 },
  { order: 4, startLat: 11.986597, startLng: 8.571831, endLat: -15.595412, endLng: -56.05918, arcAlt: 0.5 },
  { order: 4, startLat: -34.6037, startLng: -58.3816, endLat: 22.3193, endLng: 114.1694, arcAlt: 0.7 },
  { order: 4, startLat: 51.5072, startLng: -0.1276, endLat: 48.8566, endLng: -2.3522, arcAlt: 0.1 },
  { order: 5, startLat: 14.5995, startLng: 120.9842, endLat: 51.5072, endLng: -0.1276, arcAlt: 0.3 },
  { order: 5, startLat: 1.3521, startLng: 103.8198, endLat: -33.8688, endLng: 151.2093, arcAlt: 0.2 },
  { order: 5, startLat: 34.0522, startLng: -118.2437, endLat: 48.8566, endLng: -2.3522, arcAlt: 0.2 },
  { order: 6, startLat: -15.432563, startLng: 28.315853, endLat: 1.094136, endLng: -63.34546, arcAlt: 0.7 },
  { order: 6, startLat: 37.5665, startLng: 126.978, endLat: 35.6762, endLng: 139.6503, arcAlt: 0.1 },
  { order: 6, startLat: 22.3193, startLng: 114.1694, endLat: 51.5072, endLng: -0.1276, arcAlt: 0.3 },
  { order: 7, startLat: -19.885592, startLng: -43.951191, endLat: -15.595412, endLng: -56.05918, arcAlt: 0.1 },
  { order: 7, startLat: 48.8566, startLng: -2.3522, endLat: 52.52, endLng: 13.405, arcAlt: 0.1 },
  { order: 7, startLat: 52.52, startLng: 13.405, endLat: 34.0522, endLng: -118.2437, arcAlt: 0.2 },
  { order: 8, startLat: -8.833221, startLng: 13.264837, endLat: -33.936138, endLng: 18.436529, arcAlt: 0.2 },
  { order: 8, startLat: 49.2827, startLng: -123.1207, endLat: 52.3676, endLng: 4.9041, arcAlt: 0.2 },
  { order: 8, startLat: 1.3521, startLng: 103.8198, endLat: 40.7128, endLng: -74.006, arcAlt: 0.5 },
  { order: 9, startLat: 51.5072, startLng: -0.1276, endLat: 34.0522, endLng: -118.2437, arcAlt: 0.2 },
  { order: 9, startLat: 22.3193, startLng: 114.1694, endLat: -22.9068, endLng: -43.1729, arcAlt: 0.7 },
  { order: 9, startLat: 1.3521, startLng: 103.8198, endLat: -34.6037, endLng: -58.3816, arcAlt: 0.5 },
  { order: 10, startLat: -22.9068, startLng: -43.1729, endLat: 28.6139, endLng: 77.209, arcAlt: 0.7 },
  { order: 10, startLat: 34.0522, startLng: -118.2437, endLat: 31.2304, endLng: 121.4737, arcAlt: 0.3 },
  { order: 10, startLat: -6.2088, startLng: 106.8456, endLat: 52.3676, endLng: 4.9041, arcAlt: 0.3 },
  { order: 11, startLat: 41.9028, startLng: 12.4964, endLat: 34.0522, endLng: -118.2437, arcAlt: 0.2 },
  { order: 11, startLat: -6.2088, startLng: 106.8456, endLat: 31.2304, endLng: 121.4737, arcAlt: 0.2 },
  { order: 11, startLat: 22.3193, startLng: 114.1694, endLat: 1.3521, endLng: 103.8198, arcAlt: 0.2 },
  { order: 12, startLat: 34.0522, startLng: -118.2437, endLat: 37.7749, endLng: -122.4194, arcAlt: 0.1 },
  { order: 12, startLat: 35.6762, startLng: 139.6503, endLat: 22.3193, endLng: 114.1694, arcAlt: 0.2 },
  { order: 12, startLat: 22.3193, startLng: 114.1694, endLat: 34.0522, endLng: -118.2437, arcAlt: 0.3 },
  { order: 13, startLat: 52.52, startLng: 13.405, endLat: 22.3193, endLng: 114.1694, arcAlt: 0.3 },
  { order: 13, startLat: 11.986597, startLng: 8.571831, endLat: 35.6762, endLng: 139.6503, arcAlt: 0.3 },
  { order: 13, startLat: -22.9068, startLng: -43.1729, endLat: -34.6037, endLng: -58.3816, arcAlt: 0.1 },
  { order: 14, startLat: -33.936138, startLng: 18.436529, endLat: 21.395643, endLng: 39.883798, arcAlt: 0.3 },
];

export function HudGlobe3D({ prefsRef, interactive = true }) {
  const data = useMemo(() => SAMPLE_ARCS.map((a) => ({ ...a, color: pick() })), []);
  return (
    <div className="hud-globe-r3f">
      <World data={data} prefsRef={prefsRef} interactive={interactive} />
    </div>
  );
}

export default HudGlobe3D;
