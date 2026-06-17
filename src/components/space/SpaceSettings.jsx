/* =========================================================
   SpaceSettings — L1 PRESENTATION. The customization panel: change the
   cube's edge color + style, and toggle the background. Pure DOM/CSS,
   prop-driven; persistence is handled by L2 (space3d.jsx).

   Props:
     open      — boolean
     prefs     — { edgeColor, style, bg }
     onChange(partialPrefs)
     onClose()
   ========================================================= */
import React from "react";

export const EDGE_COLORS = [
  { key: "#f5c266", label: "Gold" },
  { key: "#7fd9ff", label: "Cyan" },
  { key: "#a99bff", label: "Violet" },
  { key: "#7fd49a", label: "Green" },
  { key: "#e6edf7", label: "White" },
];
export const CUBE_STYLES = [
  { key: "metallic", label: "Metallic" },
  { key: "solid", label: "Matte" },
  { key: "wire", label: "Wire" },
];
export const BACKGROUNDS = [
  { key: "nebula", label: "Nebula" },
  { key: "deep", label: "Deep space" },
  { key: "aurora", label: "Aurora" },
  { key: "minimal", label: "Minimal" },
];

export function SpaceSettings({ open = false, prefs = {}, onChange = () => {}, onClose = () => {} }) {
  return (
    <div className={"s3d-settings" + (open ? " s3d-settings--in" : "")}>
      <div className="s3d-settings-head">
        <span>Customize</span>
        <button type="button" className="s3d-settings-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="s3d-settings-group">
        <div className="s3d-settings-label">Edge color</div>
        <div className="s3d-swatches">
          {EDGE_COLORS.map(c => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              className={"s3d-swatch" + (prefs.edgeColor === c.key ? " s3d-swatch--on" : "")}
              style={{ background: c.key }}
              onClick={() => onChange({ edgeColor: c.key })}
            />
          ))}
        </div>
      </div>

      <div className="s3d-settings-group">
        <div className="s3d-settings-label">Cube style</div>
        <div className="s3d-seg">
          {CUBE_STYLES.map(o => (
            <button
              key={o.key}
              type="button"
              className={"s3d-seg-btn" + (prefs.style === o.key ? " s3d-seg-btn--on" : "")}
              onClick={() => onChange({ style: o.key })}
            >{o.label}</button>
          ))}
        </div>
      </div>

      <div className="s3d-settings-group">
        <div className="s3d-settings-label">Background</div>
        <div className="s3d-seg s3d-seg--wrap">
          {BACKGROUNDS.map(o => (
            <button
              key={o.key}
              type="button"
              className={"s3d-seg-btn" + (prefs.bg === o.key ? " s3d-seg-btn--on" : "")}
              onClick={() => onChange({ bg: o.key })}
            >{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SpaceSettings;
