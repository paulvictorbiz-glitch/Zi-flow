import { useState, useEffect } from "react";

const IMAGES = [
  "/assets/loading/loading-1.jpg",
  "/assets/loading/loading-2.jpg",
  "/assets/loading/loading-3.jpg",
  "/assets/loading/loading-4.jpg",
  "/assets/loading/loading-5.jpg",
  "/assets/loading/loading-6.jpg",
  "/assets/loading/loading-7.jpg",
];

const FADE_MS  = 500;
const CYCLE_MS = 4500;

const spinKf = "@keyframes ls-spin{to{transform:rotate(360deg)}}";

/* Full-screen loading cover shown while the store hydrates on login. */
export function LoadingScreen({ error }) {
  const [phase, setPhase] = useState({ idx: 0, visible: true });

  useEffect(() => {
    const id = setInterval(() => {
      setPhase(p => ({ ...p, visible: false }));
      const swap = setTimeout(() => {
        setPhase(p => ({ idx: (p.idx + 1) % IMAGES.length, visible: true }));
      }, FADE_MS);
      return () => clearTimeout(swap);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0a0a0a", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <style>{spinKf}</style>

      {/* Cycling background photo */}
      <img
        src={IMAGES[phase.idx]}
        alt=""
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          imageOrientation: "from-image",
          opacity: phase.visible ? 0.38 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          filter: "brightness(0.7) saturate(0.75)",
          willChange: "opacity",
        }}
      />

      {/* Vignette — deepens edges so center content always pops */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 20%, rgba(0,0,0,0.65) 100%)",
      }} />

      {/* Centered spinner + label */}
      <div style={{
        position: "relative",
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.12)",
          borderTopColor: "var(--c-cyan, #6bd6e0)",
          animation: "ls-spin 0.9s linear infinite",
        }} />
        <div style={{
          fontFamily: "var(--f-mono, 'JetBrains Mono', monospace)",
          fontSize: 11, letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
        }}>
          {error ? `error · ${error}` : "loading workflow…"}
        </div>
      </div>
    </div>
  );
}

/* Inline fallback shown while a lazy-loaded page chunk downloads.
   Uses a random still from the library — chunk loads are too brief for cycling. */
export function ViewFallback() {
  const [idx] = useState(() => Math.floor(Math.random() * IMAGES.length));

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: 320, borderRadius: 6,
    }}>
      <style>{spinKf}</style>

      <img
        src={IMAGES[idx]}
        alt=""
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          imageOrientation: "from-image",
          opacity: 0.22,
          filter: "brightness(0.6) saturate(0.65)",
        }}
      />

      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 10%, rgba(0,0,0,0.55) 100%)",
      }} />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.1)",
          borderTopColor: "var(--c-cyan, #6bd6e0)",
          animation: "ls-spin 0.9s linear infinite",
        }} />
        <div style={{
          fontFamily: "var(--f-mono, monospace)", fontSize: 11,
          letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.35)",
        }}>Loading…</div>
      </div>
    </div>
  );
}
