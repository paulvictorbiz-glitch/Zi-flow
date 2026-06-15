/* =========================================================
   ProductPage — features grid + how-it-works steps. Prop-driven;
   data from site-content.jsx (PRODUCT) passed in by the page.

   Props:
     product    — { eyebrow, headline, intro, features[], steps[] }
     onEnterApp — CTA handler
   ========================================================= */
import React from "react";
import "./info-pages.css";

export function ProductPage({ product, onEnterApp = () => {} }) {
  return (
    <section className="ip">
      <div className="ip-inner">
        <header className="ip-head">
          <p className="ip-eyebrow">{product.eyebrow}</p>
          <h1 className="ip-h1">{product.headline}</h1>
          <p className="ip-intro">{product.intro}</p>
        </header>

        <div className="ip-features">
          {product.features.map((f) => (
            <div className="ip-feature" key={f.key} style={{ "--accent": f.color }}>
              <span className="ip-feature-dot" />
              <h3 className="ip-feature-h">{f.title}</h3>
              <p className="ip-feature-body">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="ip-steps">
          <h2 className="ip-steps-h">How it works</h2>
          <div className="ip-steps-row">
            {product.steps.map((s) => (
              <div className="ip-step" key={s.n}>
                <span className="ip-step-n">{s.n}</span>
                <h4 className="ip-step-title">{s.title}</h4>
                <p className="ip-step-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="ip-cta-row">
          <button className="ip-cta" onClick={onEnterApp}>
            Try Reel DNA →
          </button>
        </div>
      </div>
    </section>
  );
}

export default ProductPage;
