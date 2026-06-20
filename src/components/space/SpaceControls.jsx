/* =========================================================
   SpaceControls — slide-in "Scene Studio" sidebar for /space.

   Expand the handle → a panel slides in with a Global section + an
   ACCORDION list of every major cosmic system. Click a body to drop
   down its settings (speed, lighting, angle/direction, colour, detail,
   size, sound, volume). Clicking a body in the 3D scene also opens its
   drawer (parent drives `sel`). Pure presentation: every change calls
   onChange(bodyId, key, value); the parent owns scene-params + audio.
   ========================================================= */
import React from "react";
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

export default function SpaceControls({ open, onToggle, scene, onChange, sel = null, onSel = () => {} }) {
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

        <div className="s3d-ctrl-title">Cosmic systems</div>
        <div className="s3d-acc">
          {BODIES.map((b) => {
            const isOpen = b.id === sel;
            return (
              <div key={b.id} className={"s3d-acc-item" + (isOpen ? " is-open" : "")}>
                <button
                  type="button"
                  className="s3d-acc-head"
                  aria-expanded={isOpen}
                  onClick={() => onSel(isOpen ? null : b.id)}
                >
                  <span>{b.label}</span>
                  <span className="s3d-acc-caret">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div className="s3d-acc-body">
                    {b.controls.map((c) => (
                      <Control key={c.key} bodyId={b.id} c={c} vals={scene[b.id]} onChange={onChange} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
