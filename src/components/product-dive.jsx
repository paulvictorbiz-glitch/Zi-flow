/* =========================================================
   ProductDive — the Product tab as an immersive, scroll-scrubbed
   "dive" experience. A 120-frame image sequence (public/product-dive/
   frames) is painted to a fixed full-viewport canvas and scrubbed by
   scroll position; the Reel DNA product cards ("beats") fade in at their
   own scroll sections over the footage.

   Ported/adapted from the arya-vs 3D scroll landing (frames + HUD +
   beat-opacity scrubber). Re-themed to Reel DNA and made prop-driven.

   Props:
     product    — { eyebrow, headline, intro, features[], steps[] } (site-content PRODUCT)
     onEnterApp — CTA handler (navigates to /app)

   NOTE: the old static Product page (ProductPage + PlatformShowcase +
   ContentStudio) is now DORMANT — kept in the codebase, no longer rendered.
   ========================================================= */
import React, { useEffect, useRef } from "react";
import "./product-dive.css";

const FRAME_BASE = "/product-dive/frames/";
const FRAME_PATTERN = "dive-%04d.jpg";
const N = 120;      // frame count
const DUR = 15;     // notional clip length (s) for the HUD timecode

// Screen placement per feature card, alternating sides as you descend.
const SIDE = ["left", "right", "left", "right", "left", "right"];

// Scroll windows [from, to] in progress-space (0..1), one per beat.
// hero, then 6 feature cards, then the how-it-works steps, then arrival.
const BEAT_WINDOWS = {
  hero: [0.0, 0.085],
  f0: [0.1, 0.205],
  f1: [0.225, 0.33],
  f2: [0.35, 0.455],
  f3: [0.475, 0.58],
  f4: [0.6, 0.705],
  f5: [0.725, 0.83],
  steps: [0.85, 0.93],
  arrival: [0.945, 1.01],
};

const ZONES = [
  [0.0, "INTAKE"],
  [0.1, "SEQUENCE"],
  [0.35, "HELIX"],
  [0.6, "GENOME"],
  [0.83, "ASSETS"],
  [0.94, "READY"],
];

function pad(n) {
  return ("000" + n).slice(-4);
}
function frameUrl(i) {
  return FRAME_BASE + FRAME_PATTERN.replace("%04d", pad(i + 1));
}

export function ProductDive({ product, onEnterApp = () => {} }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");

    const reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const frames = new Array(N);
    let loaded = 0;
    let current = 0;
    let target = 0;
    let lastDrawnIdx = -1;
    let rafId = 0;
    let started = false;

    const $ = (sel) => root.querySelector(sel);
    const loader = $(".pd-loader");
    const loadbar = $(".pd-loadbar");
    const sigEl = $(".pd-sig");
    const zoneEl = $(".pd-zone b");
    const tcEl = $(".pd-tc");
    const railEl = $(".pd-rail-dot");
    const cueEl = $(".pd-cue");
    // Collect the beat elements + their scroll windows once.
    const beats = Array.from(root.querySelectorAll(".pd-beat")).map((el) => ({
      el,
      from: parseFloat(el.dataset.from),
      to: parseFloat(el.dataset.to),
    }));

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      lastDrawnIdx = -1;
    }

    function draw(idx) {
      let img = frames[idx];
      if (!img || !img.complete || !img.naturalWidth) {
        let j = idx;
        while (j >= 0 && (!frames[j] || !frames[j].complete || !frames[j].naturalWidth)) j--;
        if (j < 0) return;
        img = frames[j];
        idx = j;
      }
      if (idx === lastDrawnIdx) return;
      lastDrawnIdx = idx;
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s;
      const dh = ih * s;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    function beatOpacity(p, a, b) {
      const f = Math.min((b - a) * 0.22, 0.035);
      if (p < a || p > b) return 0;
      if (p < a + f) return a <= 0 ? 1 : (p - a) / f;
      if (p > b - f) return b >= 1 ? 1 : (b - p) / f;
      return 1;
    }

    function apply(p) {
      const idx = Math.max(0, Math.min(N - 1, Math.floor(p * (N - 1))));
      draw(idx);
      if (sigEl) sigEl.textContent = Math.round(p * 100) + "%";
      if (tcEl) {
        const t = p * DUR;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        tcEl.textContent =
          (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
      }
      if (zoneEl) {
        let z = ZONES[0][1];
        for (let i = 0; i < ZONES.length; i++) if (p >= ZONES[i][0]) z = ZONES[i][1];
        zoneEl.textContent = z;
      }
      if (railEl) railEl.style.top = "calc(" + p * 100 + "% - " + p * 26 + "px)";
      for (let b = 0; b < beats.length; b++) {
        beats[b].el.style.opacity = beatOpacity(p, beats[b].from, beats[b].to);
      }
      if (cueEl) cueEl.style.visibility = p < 0.04 ? "visible" : "hidden";
      const arr = root.querySelector(".pd-arrival");
      if (arr) arr.style.pointerEvents = p > 0.93 ? "auto" : "none";
    }

    function scrollProgress() {
      const scroller = root.querySelector(".pd-scroll");
      if (!scroller) return 0;
      const max = scroller.offsetHeight - window.innerHeight;
      if (max <= 0) return 0;
      const y = window.pageYOffset || document.documentElement.scrollTop || 0;
      return Math.max(0, Math.min(1, y / max));
    }

    function loop() {
      target = scrollProgress();
      current += (target - current) * (reduced ? 1 : 0.12);
      if (Math.abs(target - current) < 0.0004) current = target;
      apply(current);
      rafId = requestAnimationFrame(loop);
    }

    function begin() {
      if (started) return;
      started = true;
      resize();
      apply(0);
      if (loader) {
        loader.style.opacity = "0";
        setTimeout(() => {
          loader.style.display = "none";
        }, 650);
      }
      rafId = requestAnimationFrame(loop);
    }

    // Progressive preload — coarse pass first (every 8th frame), then fill in.
    const order = [];
    for (let step = 8; step >= 1; step = step / 2) {
      for (let i = 0; i < N; i += step) if (order.indexOf(i) === -1) order.push(i);
    }
    const MIN_START = 15;
    const CONC = 6;
    let qi = 0;
    let inflight = 0;
    function pump() {
      while (inflight < CONC && qi < order.length) {
        const idx = order[qi];
        qi++;
        inflight++;
        const im = new Image();
        im.onload = im.onerror = () => {
          inflight--;
          loaded++;
          if (loadbar) loadbar.style.width = Math.round((100 * loaded) / N) + "%";
          if (loaded >= MIN_START) begin();
          if (loaded === N && loadbar) loadbar.style.width = "100%";
          pump();
        };
        im.src = frameUrl(idx);
        frames[idx] = im;
      }
    }

    window.addEventListener("resize", resize);
    resize();
    pump();
    // Safety: if images are cached and fire before listeners settle, kick off.
    const startTimer = setTimeout(begin, 1500);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(startTimer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const features = product.features || [];
  const steps = product.steps || [];

  return (
    <div className="pd" ref={rootRef}>
      <div className="pd-loader">
        <div>REEL&nbsp;DNA — SEQUENCING</div>
        <div className="pd-bar">
          <i className="pd-loadbar" />
        </div>
      </div>

      <div className="pd-scroll">
        <div className="pd-stage">
          <canvas className="pd-canvas" ref={canvasRef} />
          <div className="pd-vignette" />
          <div className="pd-grain" />

          <span className="pd-reticle tl" />
          <span className="pd-reticle tr" />
          <span className="pd-reticle bl" />
          <span className="pd-reticle br" />

          {/* ── HUD ── */}
          <div className="pd-hud pd-brand">REEL&nbsp;DNA</div>
          <div className="pd-hud pd-signal">
            SEQUENCE DEPTH
            <br />
            <b className="pd-sig">0%</b>
          </div>
          <div className="pd-hud pd-zone">
            ZONE&nbsp;/&nbsp;<b>INTAKE</b>
          </div>
          <div className="pd-hud pd-time">
            <span className="pd-tc">00:00</span> / 00:15
          </div>
          <div className="pd-rail">
            <i className="pd-rail-dot" />
          </div>

          {/* ── Beats ── */}
          <div
            className="pd-beat pd-hero"
            data-from={BEAT_WINDOWS.hero[0]}
            data-to={BEAT_WINDOWS.hero[1]}
          >
            <div className="pd-eyebrow">{product.eyebrow}</div>
            <h1>{product.headline}</h1>
            <p>{product.intro}</p>
          </div>

          {features.map((f, i) => {
            const win = BEAT_WINDOWS["f" + i] || [0.1 + i * 0.12, 0.2 + i * 0.12];
            return (
              <div
                key={f.key}
                className={"pd-beat pd-feature side-" + (SIDE[i] || "left")}
                data-from={win[0]}
                data-to={win[1]}
                style={{ "--accent": f.color }}
              >
                <div className="pd-card">
                  <div className="pd-k">
                    {pad(i + 1).replace(/^0+(?=\d)/, "")} / {f.title}
                  </div>
                  <span className="pd-card-dot" />
                  <h2>{f.title}</h2>
                  <p>{f.body}</p>
                </div>
              </div>
            );
          })}

          <div
            className="pd-beat pd-steps"
            data-from={BEAT_WINDOWS.steps[0]}
            data-to={BEAT_WINDOWS.steps[1]}
          >
            <div className="pd-k">How it works</div>
            <div className="pd-steps-row">
              {steps.map((s) => (
                <div className="pd-step" key={s.n}>
                  <span className="pd-step-n">{s.n}</span>
                  <h4>{s.title}</h4>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div
            className="pd-beat pd-arrival"
            data-from={BEAT_WINDOWS.arrival[0]}
            data-to={BEAT_WINDOWS.arrival[1]}
          >
            <div className="pd-k">The surface — with its genome in hand</div>
            <h2>Every reel, decoded.</h2>
            <button className="pd-cta" onClick={onEnterApp}>
              Try Reel DNA →
            </button>
          </div>

          <div className="pd-cue">▼ Scroll to dive</div>
        </div>
      </div>
    </div>
  );
}

export default ProductDive;
