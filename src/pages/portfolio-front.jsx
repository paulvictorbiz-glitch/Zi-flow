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
