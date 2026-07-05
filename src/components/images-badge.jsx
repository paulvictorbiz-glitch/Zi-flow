/* =========================================================
   ImagesBadge — Aceternity "Images Badge", ported to this repo's stack
   (plain CSS tokens + `motion`, NO Tailwind).

   A compact pill — [ icon · label · ▚▚▚ ] — whose thumbnail stack sits
   overlapped/peeking at rest, and on hover FANS OUT: each image lifts,
   spreads horizontally, rotates ~15°, and scales up for a clear reveal.
   Used as an at-a-glance preview of the images attached to something
   (here: a pipeline reel's thumbnails + footage) without opening it.

   Geometry note: images are center-anchored (`left:50%`) and we animate
   `x`/`y`/`rotate`/`scale` — NOT width/height — so the centering offset
   (-IMG_W/2) stays constant while scaling, keeping the fan symmetric.

   Props:
     images  — [{ src, alt }]  (only the first `max` are shown)
     label   — short caption (e.g. "3 assets")
     icon    — leading glyph (default folder)
     max     — cap on fanned thumbnails (default 3)
     onClick — optional; if omitted the badge is inert and lets clicks
               bubble (so a card wrapper can own the click).
   ========================================================= */
import React, { useState } from "react";
import { motion } from "motion/react";
import cn from "../lib/cn.js";
import "./images-badge.css";

const IMG_W = 34;
const IMG_H = 22;

export function ImagesBadge({
  images = [],
  label,
  icon = "📁",
  max = 3,
  onClick,
  className,
}) {
  const [hovered, setHovered] = useState(false);
  const shown = (Array.isArray(images) ? images : []).filter(im => im && im.src).slice(0, max);
  if (shown.length === 0) return null;

  const n = shown.length;
  const mid = (n - 1) / 2;
  // Reserve horizontal room so the resting badge doesn't reflow on hover.
  const stackW = IMG_W + (n - 1) * 12;

  return (
    <div
      className={cn("imgbadge", onClick && "imgbadge--btn", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
    >
      <span className="imgbadge__icon" aria-hidden="true">{icon}</span>
      {label != null && <span className="imgbadge__label">{label}</span>}
      <div className="imgbadge__stack" style={{ width: stackW, height: IMG_H }}>
        {shown.map((img, i) => {
          const rel = i - mid;               // signed distance from centre
          const spread = hovered ? 22 : 7;   // px per step
          const rot = hovered ? 15 : 4;      // deg per step
          const x = -IMG_W / 2 + rel * spread;
          const y = hovered ? -32 : -Math.abs(rel) * 1.5;
          return (
            <motion.img
              key={i}
              src={img.src}
              alt={img.alt || ""}
              className="imgbadge__img"
              draggable={false}
              loading="lazy"
              initial={false}
              animate={{ x, y, rotate: rel * rot, scale: hovered ? 1.35 : 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
              style={{ width: IMG_W, height: IMG_H, zIndex: 20 - Math.abs(Math.round(rel * 2)) }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default ImagesBadge;
