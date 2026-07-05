/* =========================================================
   TestimonialsMarquee — a 3D, auto-scrolling wall of testimonials.

   Renders 2-3 rows of cards that loop seamlessly (each row's content
   is duplicated back-to-back so the CSS keyframe can translate a full
   -50% and reset invisibly). Rows alternate scroll direction, and the
   whole track gets a subtle 3D read via a perspective/rotateX tilt.

   Motion is PURE CSS (@keyframes) — no JS animation loop. The animation
   pauses on hover and is disabled entirely under prefers-reduced-motion
   (both handled in the CSS).

   Props:
     testimonials — [{ name, role, quote, avatar? }]
   ========================================================= */
import React from "react";
import "./testimonials-marquee.css";

function initialsOf(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function Avatar({ person }) {
  const [imgOk, setImgOk] = React.useState(!!person.avatar);
  if (person.avatar && imgOk) {
    return (
      <img
        className="tmq-avatar"
        src={person.avatar}
        alt={person.name}
        onError={() => setImgOk(false)}
      />
    );
  }
  return (
    <span className="tmq-avatar tmq-avatar--fallback" aria-hidden="true">
      {initialsOf(person.name) || "★"}
    </span>
  );
}

function Card({ person }) {
  return (
    <figure className="tmq-card">
      <blockquote className="tmq-quote">“{person.quote}”</blockquote>
      <figcaption className="tmq-who">
        <Avatar person={person} />
        <span className="tmq-meta">
          <span className="tmq-name">{person.name}</span>
          <span className="tmq-role">{person.role}</span>
        </span>
      </figcaption>
    </figure>
  );
}

/* One marquee row. The list is duplicated (aria-hidden on the copy) so the
   -50% keyframe loops seamlessly. `reverse` flips the scroll direction. */
function Row({ items, reverse }) {
  return (
    <div className="tmq-row">
      <div className={"tmq-track" + (reverse ? " tmq-track--reverse" : "")}>
        {items.map((p, i) => (
          <Card key={"a" + i} person={p} />
        ))}
        {/* seamless-loop duplicate */}
        {items.map((p, i) => (
          <div key={"b" + i} aria-hidden="true" style={{ display: "contents" }}>
            <Card person={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TestimonialsMarquee({ testimonials = [] }) {
  if (!testimonials.length) return null;

  // Split into two interleaved rows so each row has a distinct set of cards.
  const rowA = testimonials.filter((_, i) => i % 2 === 0);
  const rowB = testimonials.filter((_, i) => i % 2 === 1);
  // Guard: if everything landed in one row, mirror it so both rows populate.
  const top = rowA.length ? rowA : testimonials;
  const bottom = rowB.length ? rowB : testimonials;

  return (
    <section className="tmq" aria-label="What creators say">
      <div className="tmq-head">
        <p className="tmq-eyebrow">Loved by creators</p>
        <h2 className="tmq-h2">Editors are decoding reels every day.</h2>
      </div>
      <div className="tmq-stage">
        <Row items={top} reverse={false} />
        <Row items={bottom} reverse={true} />
      </div>
    </section>
  );
}

export default TestimonialsMarquee;
