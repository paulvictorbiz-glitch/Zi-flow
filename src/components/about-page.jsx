/* =========================================================
   AboutPage — mission + values + stats. Prop-driven; data from
   site-content.jsx (ABOUT, MISSION) passed in by the page.
   ========================================================= */
import React from "react";
import "./info-pages.css";

export function AboutPage({ about, mission }) {
  return (
    <section className="ip">
      <div className="ip-inner">
        <header className="ip-head">
          <p className="ip-eyebrow">{about.eyebrow}</p>
          <h1 className="ip-h1">{about.headline}</h1>
          <p className="ip-intro">{about.intro}</p>
        </header>

        {about.stats && (
          <div className="ip-stats">
            {about.stats.map((s) => (
              <div className="ip-stat" key={s.label}>
                <span className="ip-stat-val">{s.value}</span>
                <span className="ip-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="ip-values">
          {about.values.map((v) => (
            <div className="ip-value" key={v.title}>
              <h3 className="ip-value-h">{v.title}</h3>
              <p className="ip-value-body">{v.body}</p>
            </div>
          ))}
        </div>

        {mission && (
          <div className="ip-mission">
            <p className="ip-eyebrow">{mission.eyebrow}</p>
            <h2 className="ip-mission-h">{mission.headline}</h2>
            <p className="ip-mission-body">{mission.body}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default AboutPage;
