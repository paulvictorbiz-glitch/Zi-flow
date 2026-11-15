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
import { useIsMobile } from "../../lib/use-is-mobile.js";

export function Modal({ title, subtitle, children, onClose, onSubmit, submitLabel }) {
  /* Mobile shell (T1): at ≤768px styles-mobile.css turns the .m-shell into a
     bottom sheet (C-SHELL-PRIMITIVES) — lock body scroll behind it so the page
     can't rubber-band under the sheet on touch. isMobile is the frozen C-HOOK
     contract; on desktop the effect body never runs, so ≥769px behavior is
     byte-identical to before. */
  const { isMobile } = useIsMobile();
  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile]);
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
          {/* m-kbd-hint: hidden ≤768px by styles-mobile.css — keyboard
              shortcuts are meaningless on touch. Untouched on desktop. */}
          <span className="mono dim m-kbd-hint">Esc to cancel · ⌘↵ to submit</span>
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
