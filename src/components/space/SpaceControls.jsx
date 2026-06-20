/* =========================================================
   SpaceControls — slide-in "Scene Studio" sidebar for /space.

   Expand the handle → a panel slides in with a Global section + a tab per
   celestial body. Pick a body and its sliders / colour pickers / toggles
   (speed, lighting, angle/direction, colour, texture detail, size, sound,
   volume) appear. Pure presentation: every change calls onChange(bodyId,
   key, value); the parent owns the scene-params state + audio.
   ========================================================= */
import React, { useState } from "react";
import { BODIES, GLOBAL_CONTROLS } from "../../lib/space-scene-params.jsx";

function Control({ bodyId, c, vals, onChange }) {
  const v = vals[c.key];
  if (c.type === "toggle") {
    return (
      <label className="s3d-ctrl-row s3d-ctrl-row--toggle">
        <span>{c.label}</span>
        <input type="checkbox" checked={!!v} onChange={(e) => onChange(bodyId, c.key, e.target.checked)} />
      </label>
    );
  }
  if (c.type === "color") {
    return (
      <label className="s3d-ctrl-row s3d-ctrl-row--color">
        <span>{c.label}</span>
        <input type="color" value={v} onChange={(e) => onChange(bodyId, c.key, e.target.value)} />
      </label>
    );
  }
  // slider
  return (
    <label className="s3d-ctrl-row s3d-ctrl-row--slider">
      <span className="s3d-ctrl-rowtop">
        <span>{c.label}</span>
        <em>{typeof v === "number" ? (Number.isInteger(c.step) ? v : Number(v).toFixed(2)) : v}</em>
      </span>
      <input
        type="range"
        min={c.min} max={c.max} step={c.step} value={v}
        onChange={(e) => onChange(bodyId, c.key, parseFloat(e.target.value))}
      />
    </label>
  );
}

export default function SpaceControls({ open, onToggle, scene, onChange }) {
  const [sel, setSel] = useState("sun");
  const body = BODIES.find((b) => b.id === sel) || BODIES[0];

  return (
    <>
      <button type="button" className="s3d-ctrl-handle" onClick={onToggle} aria-expanded={open}>
        {open ? "›  Close" : "‹  Customize"}
      </button>

      <aside className={"s3d-ctrl" + (open ? " is-open" : "")} aria-hidden={!open}>
        <div className="s3d-ctrl-head">Scene Studio</div>

        <section className="s3d-ctrl-sec">
          <div className="s3d-ctrl-title">Global</div>
          {GLOBAL_CONTROLS.map((c) => (
            <Control key={c.key} bodyId="global" c={c} vals={scene.global} onChange={onChange} />
          ))}
        </section>

        <div className="s3d-ctrl-tabs">
          {BODIES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={"s3d-ctrl-tab" + (b.id === sel ? " is-active" : "")}
              onClick={() => setSel(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <section className="s3d-ctrl-sec s3d-ctrl-panel">
          <div className="s3d-ctrl-title">{body.label}</div>
          {body.controls.map((c) => (
            <Control key={c.key} bodyId={sel} c={c} vals={scene[sel]} onChange={onChange} />
          ))}
        </section>
      </aside>
    </>
  );
}
