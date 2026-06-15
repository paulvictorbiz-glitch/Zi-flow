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
import React, { useEffect, useMemo, useState } from "react";
import DEMO_REEL, { genes } from "../lib/reel-dna-demo.jsx";
import { TEAM, MISSION, ABOUT, PRODUCT, NAV } from "../lib/site-content.jsx";
import { HelixFlat } from "../components/helix-flat.jsx";
import { AssetFan } from "../components/asset-fan.jsx";
import { TimelineView } from "../components/timeline-view.jsx";
import { ReelPlayer } from "../components/reel-player.jsx";
import { TeamSection } from "../components/team-section.jsx";
import { AboutPage } from "../components/about-page.jsx";
import { ProductPage } from "../components/product-page.jsx";
import "./landing.css";

const LOGO_SRC = "/brand/reel-dna-logo.png";

function scrollToBreakdown() {
  const el = document.getElementById("breakdown");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Reusable wordmark lockup (top bar + footer). */
function Wordmark({ onClick }) {
  return (
    <span className="lp-wordmark" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <span className="lp-wordmark-icon" aria-hidden="true">▶</span>
      <span className="lp-wordmark-text">REEL<span> DNA</span></span>
    </span>
  );
}

/* ── Home view (the v3 breakdown experience) ─────────────── */
function HomeView({ onEnterApp }) {
  const [hoveredGene, setHoveredGene] = useState(null);
  const [reelUrl, setReelUrl] = useState(DEMO_REEL.sampleReel.sourceUrl);
  const [logoOk, setLogoOk] = useState(true);

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
          {logoOk ? (
            <img className="lp-hero-logo" src={LOGO_SRC} alt="REEL DNA"
                 onError={() => setLogoOk(false)} />
          ) : (
            <div className="lp-hero-logo-fallback">
              <span className="lp-grad-strong">REEL DNA</span>
            </div>
          )}

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
          <div className="lp-hud-right">
            <div className="lp-hud-stat"><span>SYS_STATUS:</span> <b className="ok">READY</b></div>
            <div className="lp-hud-stat"><span>RENDER_ENGINE:</span> <b className="cy">NEURAL_STREAM v2.8</b></div>
            <div className="lp-hud-stat"><span>LATENCY:</span> <b>0.02ms</b></div>
          </div>
        </div>

        <div className="lp-stage">
          <div className="lp-stage-top">
            <div className="lp-helix-col">
              <span className="lp-stage-cap">GENETIC_STREAM.mp4</span>
              <div className="lp-helix-wrap">
                <HelixFlat genes={genes} hoveredGene={hoveredGene}
                           onHoverGene={setHoveredGene} onSelectGene={setHoveredGene} />
              </div>
              {!activeGene && <div className="lp-helix-hint">Hover a gene node →</div>}
            </div>

            <div className="lp-fan-col">
              {activeGene && <span className="lp-dispatch-line" aria-hidden="true" />}
              <AssetFan gene={activeGene} onClose={() => setHoveredGene(null)} />
              {!activeGene && (
                <div className="lp-fan-idle">
                  <span className="lp-fan-idle-tag">RADIAL_FAN_DISPATCH</span>
                  <p>Select a gene on the helix to load its assets.</p>
                </div>
              )}
            </div>

            <div className="lp-player-col">
              <ReelPlayer sampleReel={DEMO_REEL.sampleReel} />
            </div>
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
                      className={"lp-chip" + (hoveredGene === g.key ? " is-on" : "")}
                      style={{ "--chip": g.color }}
                      onMouseEnter={() => setHoveredGene(g.key)}
                      onMouseLeave={() => setHoveredGene(null)}
                      onClick={() => { setHoveredGene(g.key); scrollToBreakdown(); }}>
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

      {/* ── Founding team (also lives at bottom of Home) ── */}
      <TeamSection team={TEAM} mission={MISSION} compact />
    </>
  );
}

export function Landing({ onEnterApp = () => {} }) {
  const [page, setPage] = useState("home");

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
        <button className="lp-login" onClick={onEnterApp}>Log in / Sign up</button>
      </header>

      {/* ── Active page ── */}
      {page === "home" && <HomeView onEnterApp={onEnterApp} />}
      {page === "product" && <ProductPage product={PRODUCT} onEnterApp={onEnterApp} />}
      {page === "about" && <AboutPage about={ABOUT} mission={MISSION} />}
      {page === "team" && <TeamSection team={TEAM} mission={MISSION} />}

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
