/* =========================================================
   Landing — L2 COMPOSITION (public marketing site)

   Multi-page public site with client-side view switching:
     · Home    — v3 "AI Video Synthesis Core": logo, helix breakdown,
                 explainers, and the founding-team section at the bottom.
     · Product — feature grid + how-it-works.
     · About   — mission, values, stats.
     · Team    — founding team (interactive-studio style) + the "why".

   This is the ONLY layer allowed to import the demo + site content data.
   It composes the prop-driven L1 components and owns the shared
   `hoveredGene` state for the helix↔timeline highlight.

   Props:
     onEnterApp() — called by the top-right auth button (navigates to /app).
   ========================================================= */
import React, { useEffect, useMemo, useRef, useState } from "react";
import DEMO_REEL, { genes } from "../lib/reel-dna-demo.jsx";
import { TEAM, MISSION, ABOUT, PRODUCT, NAV } from "../lib/site-content.jsx";
import { HelixFlat } from "../components/helix-flat.jsx";
import { AssetFan } from "../components/asset-fan.jsx";
import { TimelineView } from "../components/timeline-view.jsx";
import { ReelPlayer } from "../components/reel-player.jsx";
import { TeamSection } from "../components/team-section.jsx";
import { AboutPage } from "../components/about-page.jsx";
import { ProductPage } from "../components/product-page.jsx";
import { ContentStudio } from "../components/content-studio.jsx";
import { CreditsModal } from "../components/credits-modal.jsx";
import { PlatformShowcase } from "../components/platform-showcase.jsx";
import "./landing.css";

const LOGO_SRC = "/brand/reel-dna-logo.png";

function scrollToBreakdown() {
  const el = document.getElementById("breakdown");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Reusable logo lockup (top bar + HUD + footer). The PNG already
   contains the "REEL DNA" wordmark, so no extra text is rendered.
   Falls back to a text wordmark only if the image fails to load. */
function Wordmark({ onClick }) {
  const [imgOk, setImgOk] = React.useState(true);
  return (
    <span className="lp-wordmark" onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}>
      {imgOk ? (
        <img className="lp-logo-img" src={LOGO_SRC} alt="REEL DNA"
             onError={() => setImgOk(false)} />
      ) : (
        <span className="lp-wordmark-text">REEL<span> DNA</span></span>
      )}
    </span>
  );
}

/* ── Home view (the v3 breakdown experience) ─────────────── */
function HomeView({ onEnterApp }) {
  const [hoveredGene, setHoveredGene] = useState(null);
  const [reelUrl, setReelUrl] = useState(DEMO_REEL.sampleReel.sourceUrl);

  // Deferred, cancelable hover-clear. For the top genes the asset fan renders
  // directly over the hovered node, so the cursor crossing node→fan fires the
  // node's mouseleave → onHoverGene(null). Scheduling the clear (instead of
  // clearing immediately) lets the fan's mouseenter cancel it, so state holds.
  const clearTimer = useRef(null);
  const cancelClear = () => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
  };
  const clearNow = () => { cancelClear(); setHoveredGene(null); };
  const scheduleClear = () => {
    cancelClear();
    clearTimer.current = setTimeout(() => { setHoveredGene(null); clearTimer.current = null; }, 120);
  };
  // Set immediately and cancel any pending clear (hover-in, select, click).
  const setGeneNow = (key) => {
    cancelClear();
    if (key == null) setHoveredGene(null);
    else setHoveredGene(key);
  };
  // onHoverGene from HelixFlat: a key sets immediately; null defers the clear.
  const onHoverGene = (key) => { if (key == null) scheduleClear(); else setGeneNow(key); };

  // Clear the pending timeout on unmount (avoid setState after unmount).
  useEffect(() => () => cancelClear(), []);

  const activeGene = useMemo(
    () => genes.find((g) => g.key === hoveredGene) || null,
    [hoveredGene]
  );

  return (
    <>
      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-inner">
          <p className="lp-eyebrow">Reverse-engineer any reel</p>
          <h1 className="lp-hero-title">
            See the <span className="lp-grad-strong">DNA</span> of any reel.
          </h1>

          <p className="lp-subhead">
            Paste any reel and we break the edit down to its genes — footage,
            titles, captions, transitions, SFX, music, color, speed — then hand
            you every layer, timed and downloadable.
          </p>

          <form className="lp-paste"
                onSubmit={(e) => { e.preventDefault(); scrollToBreakdown(); }}>
            <span className="lp-paste-label">SEQUENCE INPUT</span>
            <div className="lp-paste-row">
              <input className="lp-paste-input" type="text" value={reelUrl}
                     onChange={(e) => setReelUrl(e.target.value)}
                     placeholder="Paste any Reel URL…" aria-label="Reel URL" />
              <button className="lp-paste-btn" type="submit">Deconstruct</button>
            </div>
          </form>
          <p className="lp-paste-note">
            Demo loaded below — a real, reverse-engineered 28-second reel.
          </p>
        </div>
      </section>

      {/* ── THE BREAKDOWN ── */}
      <section className="lp-breakdown" id="breakdown">
        <div className="lp-hud">
          <div className="lp-hud-left">
            <Wordmark />
            <span className="lp-hud-tag">AI VIDEO SYNTHESIS CORE</span>
          </div>
        </div>

        <div className="lp-stage lp-stage--split">
          {/* Left: the tall DNA helix (with the asset fan floating beside it) */}
          <div className="lp-helix-col">
            <span className="lp-stage-cap">GENETIC_STREAM.mp4</span>
            <div className="lp-helix-wrap">
              <HelixFlat genes={genes} hoveredGene={hoveredGene}
                         onHoverGene={onHoverGene} onSelectGene={setGeneNow} />
              {/* Asset fan floats over the helix area on hover. Keep it open
                  while the cursor is over it (the top genes' fan overlaps the
                  hovered node, so node→fan would otherwise drop the state). */}
              <div className="lp-fan-float"
                   onMouseEnter={cancelClear} onMouseLeave={scheduleClear}>
                {activeGene && <span className="lp-dispatch-line" aria-hidden="true" />}
                <AssetFan gene={activeGene} onClose={clearNow} />
              </div>
            </div>
            {!activeGene && <div className="lp-helix-hint">Hover a gene node →</div>}
          </div>

          {/* Right: shorter sample reel stacked above the timeline dock so the
              helix and the timeline are visible together (hover highlight reads). */}
          <div className="lp-right-col">
            <div className="lp-player-col lp-player-col--compact">
              <ReelPlayer sampleReel={DEMO_REEL.sampleReel} preferEmbed={false} />
            </div>

            <div className="lp-dock">
              <div className="lp-dock-transport">
                <div className="lp-dock-controls">
                  <button className="lp-tbtn lp-tbtn--play" title="Play">▶</button>
                  <button className="lp-tbtn" title="Prev">⏮</button>
                  <button className="lp-tbtn" title="Next">⏭</button>
                  <span className="lp-tbar-sep" />
                  <button className="lp-tbtn lp-tbtn--ghost">✂ Split</button>
                  <button className="lp-tbtn lp-tbtn--ghost">🗑 Delete</button>
                  <button className="lp-tbtn lp-tbtn--ghost">✦ AI Crop</button>
                </div>
                <div className="lp-dock-tc"><b>00:00:14:02</b> <span>/ 00:00:28:00</span></div>
              </div>

              <TimelineView segments={DEMO_REEL.timeline} lanes={DEMO_REEL.LANES}
                            totalSec={DEMO_REEL.totalSec} hoveredGene={hoveredGene} />

              <div className="lp-dock-foot">
                <span className="lp-dock-foot-live">
                  <span className="lp-dock-dot" /> Timeline auto-syncing with Neural Cloud DNA
                </span>
                <span className="lp-dock-foot-id">
                  Active Segment ID: <b>{activeGene ? `DNA-${activeGene.key.toUpperCase()}` : "DNA-011402-WARP"}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Explainer: downloadable genes ── */}
      <section className="lp-explain">
        <div className="lp-explain-inner">
          <p className="lp-eyebrow">Every gene, downloadable</p>
          <h2 className="lp-h2">Not just analysis — the actual assets.</h2>
          <p className="lp-explain-copy">
            Each gene carries the real building blocks: the exact fonts, the LUT,
            the transition presets, the SFX, the beat-grid for the track. Click
            any asset to grab it — or swap it with your own.
          </p>
          <div className="lp-chips">
            {genes.map((g) => (
              <button key={g.key}
                      type="button"
                      className="lp-chip"
                      style={{ "--chip": g.color }}
                      onClick={() => { setGeneNow(g.key); scrollToBreakdown(); }}>
                <span className="lp-chip-dot" style={{ background: g.color }} />
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Explainer: swap with your own ── */}
      <section className="lp-explain lp-explain--alt">
        <div className="lp-explain-inner">
          <p className="lp-eyebrow">Swap any asset with your own</p>
          <h2 className="lp-h2">Keep the structure. Make it yours.</h2>
          <p className="lp-explain-copy">
            Love the pacing but not the footage? Drop in your own clips, your
            font, your logo — the timeline keeps the proven structure while every
            layer becomes 100% you.
          </p>
          <button className="lp-cta" onClick={onEnterApp}>Start deconstructing →</button>
        </div>
      </section>

      {/* ── Create Content / Analyze Video intake panel ── */}
      <ContentStudio />

      {/* ── Founding team (also lives at bottom of Home) ── */}
      <TeamSection team={TEAM} mission={MISSION} compact />
    </>
  );
}

export function Landing({ onEnterApp = () => {} }) {
  const [page, setPage] = useState("home");
  const [creditsOpen, setCreditsOpen] = useState(false);

  // Reset scroll to top whenever the page view changes.
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [page]);

  const go = (key) => setPage(key);

  return (
    <div className="lp">
      {/* ── Sticky top bar with nav tabs ── */}
      <header className="lp-topbar">
        <Wordmark onClick={() => go("home")} />
        <nav className="lp-nav">
          {NAV.map((n) => (
            <button key={n.key}
                    className={"lp-nav-link" + (page === n.key ? " is-active" : "")}
                    onClick={() => go(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="lp-topbar-actions">
          <button className="lp-credits" onClick={() => setCreditsOpen(true)}>
            <span aria-hidden="true">✦</span> Get Credits
          </button>
          <button className="lp-login" onClick={onEnterApp}>Log in / Sign up</button>
        </div>
      </header>

      {/* ── Active page ── */}
      {page === "home" && <HomeView onEnterApp={onEnterApp} />}
      {page === "product" && (
        <>
          <ProductPage product={PRODUCT} onEnterApp={onEnterApp} />
          <PlatformShowcase />
          <ContentStudio defaultTab="analyze" />
        </>
      )}
      {page === "about" && <AboutPage about={ABOUT} mission={MISSION} />}
      {page === "team" && <TeamSection team={TEAM} mission={MISSION} />}

      {/* ── Get Credits payment modal (mockup) ── */}
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <Wordmark onClick={() => go("home")} />
        <nav className="lp-footer-nav">
          {NAV.map((n) => (
            <button key={n.key} className="lp-footer-link" onClick={() => go(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <span className="lp-footer-note">Reel DNA · AI Video Synthesis Core</span>
      </footer>
    </div>
  );
}

export default Landing;
