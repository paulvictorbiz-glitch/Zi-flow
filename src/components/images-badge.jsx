/* =========================================================
   ImagesBadge — Aceternity "Images Badge", ported to this repo's stack
   (plain CSS tokens + `motion`, NO Tailwind).

   A compact pill — [ icon · label · ▚▚▚ ] — whose thumbnail stack sits
   overlapped/peeking at rest, and on hover POPS OUT into a big fan of
   clearly-visible, NON-overlapping clips:
     · ≤5 clips → a semicircle "rainbow" arc
     · >5 clips → a full ring, so the clips stay close instead of
       fanning way out to the sides.

   The popped fan is PORTALED to <body> (like the card's kebab menu) so it
   can't be hidden behind neighbouring pipeline cards — a plain z-index only
   wins inside its own card's stacking context, which is why the fan used to
   disappear under cards in the next lane.

   Non-overlap: on hover each clip sits on a circle of radius R at angle
   theta = rel·step. R is sized so the arc distance between neighbours
   (R·step) always clears a scaled clip's width — so raising `max` or
   `hoverScale` never makes clips collide; the fan just grows.

   Props:
     images  — [{ src, alt, fallback? }]  (only the first `max` are shown;
               `fallback` is swapped in via onError if `src` 404s)
     label   — short caption (e.g. "3 assets")
     icon    — leading glyph (default folder)
     max     — cap on fanned thumbnails (default 3)
     imgW/imgH — per-thumbnail size in px at REST (default 34x22).
     hoverScale — how big each clip grows on hover (default 2.4).
     arcSpanDeg — sweep of the ≤5-clip semicircle arc (default 170°).
     onClick — optional; if omitted the badge is inert and lets clicks
               bubble (so a card wrapper can own the click).
   ========================================================= */
import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import cn from "../lib/cn.js";
import "./images-badge.css";

export function ImagesBadge({
  images = [],
  label,
  icon = "📁",
  max = 3,
  imgW = 34,
  imgH = 22,
  hoverScale = 2.4,
  arcSpanDeg = 170,
  onClick,
  className,
}) {
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState(null); // {x,y} viewport coords of the stack's centre-bottom
  const stackRef = useRef(null);

  const shown = (Array.isArray(images) ? images : []).filter(im => im && im.src).slice(0, max);
  if (shown.length === 0) return null;

  const n = shown.length;
  const mid = (n - 1) / 2;
  // Reserve horizontal room so the resting badge doesn't reflow on hover.
  const stackW = imgW + (n - 1) * 12;

  // ---- Hover fan geometry ----
  // >5 clips ring all the way around (step = 360/n) so they stay compact;
  // ≤5 clips fan across a semicircle arc. Never let one gap exceed 30°.
  const ring = n > 5;
  const stepDeg = n > 1 ? (ring ? 360 / n : Math.min(30, arcSpanDeg / (n - 1))) : 0;
  const stepRad = (stepDeg * Math.PI) / 180;
  const scaledW = imgW * hoverScale;
  // Radius so neighbours (arc dist R·stepRad) clear a scaled clip + 14% gap.
  const minGap = scaledW * 1.14;
  const radius = n > 1 ? Math.max(scaledW, minGap / stepRad) : 0;

  const restGeom = (rel) => ({
    x: -imgW / 2 + rel * 7,
    y: -Math.abs(rel) * 1.5,
    rotate: rel * 4,
    scale: 1,
    zIndex: 20 - Math.abs(Math.round(rel * 2)),
  });
  const fanGeom = (rel) => {
    const theta = rel * stepRad;
    return {
      x: radius * Math.sin(theta) - imgW / 2,
      y: -radius * Math.cos(theta) - 10, // lift the arc clear of the pill
      rotate: rel * stepDeg,             // tangential tilt
      scale: hoverScale,
      zIndex: 40 - Math.abs(Math.round(rel)), // middle clip on top
    };
  };

  const onEnter = () => {
    const el = stackRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setAnchor({ x: r.left + r.width / 2, y: r.bottom });
    }
    setHovered(true);
  };
  const onLeave = () => setHovered(false);

  const renderImg = (img, i, mode) => {
    const rel = i - mid;
    const g = mode === "fan" ? fanGeom(rel) : restGeom(rel);
    return (
      <motion.img
        key={i}
        src={img.src}
        alt={img.alt || ""}
        className="imgbadge__img"
        draggable={false}
        loading="lazy"
        initial={mode === "fan" ? restGeom(rel) : false}
        animate={{ x: g.x, y: g.y, rotate: g.rotate, scale: g.scale }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        style={{ width: imgW, height: imgH, zIndex: g.zIndex }}
        onError={img.fallback ? (e) => {
          if (e.currentTarget.src !== img.fallback) e.currentTarget.src = img.fallback;
        } : undefined}
      />
    );
  };

  return (
    <div
      className={cn("imgbadge", onClick && "imgbadge--btn", className)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
    >
      <span className="imgbadge__icon" aria-hidden="true">{icon}</span>
      {label != null && <span className="imgbadge__label">{label}</span>}
      <div className="imgbadge__stack" ref={stackRef} style={{ width: stackW, height: imgH }}>
        {/* Resting peek — the popped fan is portaled to <body> while hovered. */}
        {!hovered && shown.map((img, i) => renderImg(img, i, "rest"))}
      </div>
      {hovered && anchor && createPortal(
        <div
          className="imgbadge__portal"
          style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 0, height: 0, zIndex: 9999, pointerEvents: "none" }}
        >
          {shown.map((img, i) => renderImg(img, i, "fan"))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default ImagesBadge;
