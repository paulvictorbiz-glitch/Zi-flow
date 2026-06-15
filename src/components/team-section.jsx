/* =========================================================
   TeamSection — founding team (interactive-studio.io style).
   Two founders side by side with photo, role, bio, and a social
   link. Photo falls back to a neon initials avatar if the image
   is missing. Prop-driven; the data lives in site-content.jsx and
   is passed in by the page.

   Props:
     team    — [{ id, name, title, photo, initials, accent, bio,
                  social:{ type, label, url } }]
     mission — { eyebrow, headline, body } (optional; the "why")
     compact — bool; tighter version for the Home-page footer block
   ========================================================= */
import React, { useState } from "react";
import "./team-section.css";

function SocialIcon({ type }) {
  if (type === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
      </svg>
    );
  }
  // instagram
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.38C1.35 2.67.94 3.34.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.8.72 1.47 1.38 2.13.66.66 1.33 1.07 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.8-.3 1.47-.72 2.13-1.38.66-.66 1.07-1.33 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.12A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-10.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
    </svg>
  );
}

function FounderCard({ person, compact }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <article className={"tm-card" + (compact ? " tm-card--compact" : "")} style={{ "--accent": person.accent }}>
      <div className="tm-photo-wrap">
        {imgOk ? (
          <img
            className="tm-photo"
            src={person.photo}
            alt={person.name}
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="tm-photo tm-photo--fallback">{person.initials}</div>
        )}
        <a
          className="tm-social"
          href={person.social.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${person.name} on ${person.social.label}`}
          title={person.social.label}
        >
          <SocialIcon type={person.social.type} />
        </a>
      </div>
      <div className="tm-meta">
        <h3 className="tm-name">{person.name}</h3>
        <p className="tm-title">{person.title}</p>
        {!compact && <p className="tm-bio">{person.bio}</p>}
        <a className="tm-link" href={person.social.url} target="_blank" rel="noreferrer">
          {person.social.label} ↗
        </a>
      </div>
    </article>
  );
}

export function TeamSection({ team = [], mission = null, compact = false }) {
  return (
    <section className={"tm" + (compact ? " tm--compact" : "")}>
      <div className="tm-inner">
        <header className="tm-head">
          <p className="tm-eyebrow">Founding team</p>
          <h2 className="tm-h2">The people behind Reel DNA.</h2>
        </header>

        <div className="tm-grid">
          {team.map((p) => (
            <FounderCard key={p.id} person={p} compact={compact} />
          ))}
        </div>

        {mission && (
          <div className="tm-mission">
            <p className="tm-eyebrow">{mission.eyebrow}</p>
            <h3 className="tm-mission-h">{mission.headline}</h3>
            <p className="tm-mission-body">{mission.body}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default TeamSection;
