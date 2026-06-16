/* =========================================================
   MedalBadge — SVG medal silhouette (bronze → silver → gold).

   When `medal` is "none" the silhouette renders greyed with a fill
   that rises from the bottom by `progress` (0..1) — a teaser of the
   next tier filling up. An earned medal renders fully in its tier
   color with a soft glow.
   ========================================================= */

import React from "react";
import { MEDAL_TIERS } from "../lib/gamify-data.jsx";

const COLOR = {
  none:   "#3a3a44",
  bronze: "#cd7f32",
  silver: "#c0c0c0",
  gold:   "#ffd700",
};

export default function MedalBadge({ medal = "none", progress = 0, size = 64 }) {
  const earned = medal !== "none";
  const color = COLOR[medal] || COLOR.none;
  const gid = "medalfill-" + Math.random().toString(36).slice(2, 8);
  const fillStop = Math.max(0, Math.min(1, progress));
  const tierTitle = MEDAL_TIERS.find(t => t.id === medal)?.title || "Unranked";

  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64"
      role="img" aria-label={tierTitle}
      style={{ filter: earned ? `drop-shadow(0 0 6px ${color}88)` : "none" }}
    >
      <defs>
        {/* Partial vertical fill for the un-earned (progress) state. */}
        <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#5a5a66" />
          <stop offset={`${fillStop * 100}%`} stopColor="#5a5a66" />
          <stop offset={`${fillStop * 100}%`} stopColor="#2a2a30" />
          <stop offset="100%" stopColor="#2a2a30" />
        </linearGradient>
      </defs>

      {/* ribbon */}
      <path d="M24 6 L28 30 L20 30 Z" fill={earned ? color : "#33333b"} opacity="0.7" />
      <path d="M40 6 L44 30 L36 30 Z" fill={earned ? color : "#33333b"} opacity="0.7" />

      {/* medallion */}
      <circle
        cx="32" cy="40" r="18"
        fill={earned ? color : `url(#${gid})`}
        stroke={earned ? "#ffffff55" : "#ffffff22"}
        strokeWidth="1.5"
      />
      {/* inner star */}
      <path
        d="M32 30 l2.9 6.1 6.6 .9 -4.8 4.7 1.2 6.6 -5.9 -3.2 -5.9 3.2 1.2 -6.6 -4.8 -4.7 6.6 -.9 z"
        fill={earned ? "#ffffffcc" : "#ffffff33"}
      />
    </svg>
  );
}
