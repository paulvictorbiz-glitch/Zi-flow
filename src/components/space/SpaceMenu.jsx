/* =========================================================
   SpaceMenu — L1 PRESENTATION. The left-of-screen category menu.

   Lists the 6 faces (categories). Hovering spotlights a face on the
   cube; clicking explodes the cube to that face's tiles. Pure DOM +
   CSS, prop-driven.

   Props:
     faces        — FACES array [{ key, label, color, blurb }]
     hoveredFace  — string|null
     onHoverFace(faceKey|null)
     onPickFace(faceKey)
     visible      — boolean (slides in once past the hero)
   ========================================================= */
import React from "react";

export function SpaceMenu({ faces = [], hoveredFace = null, onHoverFace = () => {}, onPickFace = () => {}, visible = true }) {
  return (
    <nav className={"s3d-menu" + (visible ? " s3d-menu--in" : "")} aria-label="Categories">
      <div className="s3d-menu-title">Categories</div>
      <ul className="s3d-menu-list">
        {faces.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              className={"s3d-menu-item" + (hoveredFace === f.key ? " s3d-menu-item--hot" : "")}
              style={{ "--s3d-face": f.color }}
              onMouseEnter={() => onHoverFace(f.key)}
              onMouseLeave={() => onHoverFace(null)}
              onFocus={() => onHoverFace(f.key)}
              onBlur={() => onHoverFace(null)}
              onClick={() => onPickFace(f.key)}
            >
              <span className="s3d-menu-dot" />
              <span className="s3d-menu-label">{f.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default SpaceMenu;
