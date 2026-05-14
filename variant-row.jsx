/* =========================================================
   Variant readiness — renameable list rows
   ========================================================= */

import React, { useState, useRef, useEffect } from "react";
import { Pill } from "./components.jsx";
import { VARIANT_TYPES } from "./detail-data.jsx";

function VariantRow({ row, onChange }) {
  const [open, setOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const wrap = useRef(null);

  useEffect(() => {
    const h = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  const pick = key => {
    if (key === "other") {
      onChange({ ...row, type: "other", label: otherText || row.label || "Other" });
    } else {
      const t = VARIANT_TYPES.find(v => v.key === key);
      onChange({ ...row, type: key, label: t.label });
    }
    setOpen(false);
  };

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <div className={"var-row " + (row.state || "")}>
        <div className="var-letter" onClick={() => setOpen(o => !o)}>{row.letter}</div>
        <div className="var-name">
          <span className={"label" + (row.type ? "" : " placeholder")}>
            {row.label || "click letter to pick a variant style"}
          </span>
          <span className="hint">
            {row.state === "active" ? "in progress · Jay"
              : row.state === "done" ? "packaged"
              : row.state === "warn" ? "needs upstream"
              : "queued"}
          </span>
        </div>
        <Pill tone={row.state === "done" ? "ok" : row.state === "active" ? "cyan" : row.state === "warn" ? "warn" : ""}>
          {row.state === "done" ? "ready" : row.state === "active" ? "in progress" : row.state === "warn" ? "waiting" : "queued"}
        </Pill>
      </div>

      {open && (
        <div className="var-popover" onClick={e => e.stopPropagation()}>
          <div style={{ padding: "6px 8px", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-mute)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Variant {row.letter} style
          </div>
          {VARIANT_TYPES.map((t, i) => (
            <div key={t.key} className="opt" onClick={() => pick(t.key)}>
              <span className="k">{String.fromCharCode(97 + i)}.</span>
              <span>{t.label}</span>
              {row.type === t.key && (
                <span style={{ marginLeft: "auto", color: "var(--c-cyan)", fontFamily: "var(--f-mono)", fontSize: 11 }}>✓</span>
              )}
            </div>
          ))}
          {row.type === "other" || row.label === "Other" ? (
            <input
              autoFocus
              placeholder="e.g. Vertical pano with re-cut intro"
              value={otherText}
              onChange={e => setOtherText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  onChange({ ...row, type: "other", label: otherText || "Other" });
                  setOpen(false);
                }
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export { VariantRow };
