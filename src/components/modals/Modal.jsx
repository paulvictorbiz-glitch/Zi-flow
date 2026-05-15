/* =========================================================
   Modal shell + form primitives.

   Shared by every modal in the app (CreateTask, CreateReel,
   future ones). The shell traps Esc to close and renders the
   ziflow-style m-backdrop / m-shell DOM. Form primitives
   (Field, SegRow, SelectInput) are styled by the .m-* classes
   in styles.css.
   ========================================================= */

import React, { useEffect } from "react";
import { DPill } from "../components.jsx";

export function Modal({ title, subtitle, children, onClose, onSubmit, submitLabel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="m-backdrop" onClick={onClose}>
      <div className="m-shell" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div>
            <div className="m-eyebrow">New</div>
            <div className="m-title">{title}</div>
            <div className="m-sub">{subtitle}</div>
          </div>
          <button className="m-x" onClick={onClose}>✕</button>
        </div>
        <div className="m-body">{children}</div>
        <div className="m-foot">
          <span className="mono dim">Esc to cancel · ⌘↵ to submit</span>
          <div style={{ display: "flex", gap: 8 }}>
            <DPill onClick={onClose}>Cancel</DPill>
            <DPill primary onClick={onSubmit}>{submitLabel}</DPill>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="m-field">
      <div className="m-label">{label} {hint && <span className="m-hint">— {hint}</span>}</div>
      {children}
    </div>
  );
}

export function SegRow({ value, onChange, options }) {
  return (
    <div className="m-seg">
      {options.map((o) => (
        <button key={o.k}
          className={"m-seg-opt " + (value === o.k ? "is-active" : "")}
          onClick={() => onChange(o.k)}>{o.l}</button>
      ))}
    </div>
  );
}

export function SelectInput({ value, onChange, options }) {
  return (
    <select className="m-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}
    </select>
  );
}
