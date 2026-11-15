/* =========================================================
   Portfolio front page (public root "/").

   The Paul Victor cinematic portfolio ships as its OWN self-contained
   Vite build under /public/portfolio/ (built with base:"./"). We embed it
   in a full-viewport iframe so its global CSS + GSAP + Lenis are perfectly
   isolated from the FootageBrain app — the app tree at /app cannot be
   affected by it in any way.

   The portfolio's own nav shows a "Log in" link (only when embedded) that
   drives the TOP window to /app, so `onEnterApp` here is just a same-origin
   fallback and to keep the prop contract identical to the old Landing.
   ========================================================= */
import React from "react";

export function PortfolioFront({ onEnterApp = () => {} }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#070907" }}>
      <button
        onClick={() => window.location.assign("/")}
        style={{
          position: "absolute", top: 18, left: 18, zIndex: 10,
          padding: "9px 16px", borderRadius: 10, cursor: "pointer",
          border: "1px solid rgba(255,255,255,0.22)",
          background: "rgba(7,9,7,0.55)", color: "rgba(255,255,255,0.85)",
          fontFamily: "monospace", fontSize: 12.5, fontWeight: 600,
          letterSpacing: "0.02em", backdropFilter: "blur(6px)",
        }}
      >
        ← Back
      </button>
      <iframe
        src="/portfolio/index.html"
        title="Paul Victor — Social Growth Systems"
        style={{ border: "none", width: "100%", height: "100%", display: "block" }}
        allow="autoplay; fullscreen"
      />
    </div>
  );
}

export default PortfolioFront;
