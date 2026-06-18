/* =========================================================
   ModuleChapters — in-module "lesson player".

   Takes a module's sections pre-grouped into a handful of chapters and
   presents ONE chapter at a time inside a horizontal slide carousel:
     · a clickable stepper rail (chapter chips) across the top
     · a clipped viewport whose height animates to the active chapter
     · a footer with ‹ Back / dots / "n / N" / Next ›
     · ← / → arrow keys (ignored while typing) and basic touch-swipe

   Purely presentational and stateless w.r.t. the data model: every chapter
   panel stays mounted, so quiz progress, flashcard position, and checklist
   ticks survive navigation. No router, no change to training_progress.

   Props:
     chapters — [{ key, label, icon, node }]  (node = the chapter's JSX)
   ========================================================= */

import React, { useState, useRef, useEffect, useCallback } from "react";

export function ModuleChapters({ chapters }) {
  const list = Array.isArray(chapters) ? chapters.filter(Boolean) : [];
  const n = list.length;
  const [active, setActive] = useState(0);
  const [visited, setVisited] = useState(() => new Set([0]));
  const [height, setHeight] = useState(undefined);
  const panelRefs = useRef([]);
  const touchX = useRef(null);

  const measure = useCallback(() => {
    const el = panelRefs.current[active];
    if (el) setHeight(el.offsetHeight);
  }, [active]);

  // Measure the active panel (and re-measure when its content resizes:
  // quiz reveal, flashcard edit, checklist toggles, owner inline edits…).
  useEffect(() => {
    measure();
    const el = panelRefs.current[active];
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, measure, list.length]);

  const go = useCallback((idx) => {
    const next = Math.max(0, Math.min(n - 1, idx));
    setActive(next);
    setVisited((v) => { const s = new Set(v); s.add(next); return s; });
  }, [n]);

  const onKeyDown = (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(active - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(active + 1); }
  };

  const onTouchStart = (e) => { touchX.current = e.changedTouches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 50) go(active + (dx < 0 ? 1 : -1));
    touchX.current = null;
  };

  if (n === 0) return null;

  return (
    <div className="tc" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* Stepper rail */}
      <div className="tc-rail" role="tablist" aria-label="Module chapters">
        {list.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={
              "tc-step" +
              (i === active ? " is-active" : "") +
              (visited.has(i) && i !== active ? " is-visited" : "")
            }
            onClick={() => go(i)}
          >
            <span className="tc-step-num">{i + 1}</span>
            {c.icon && <span className="tc-step-icon">{c.icon}</span>}
            <span className="tc-step-label">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Sliding viewport */}
      <div
        className="tc-viewport"
        style={height != null ? { height } : undefined}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="tc-track" style={{ transform: `translateX(${-active * 100}%)` }}>
          {list.map((c, i) => (
            <div
              key={c.key}
              className="tc-panel"
              ref={(el) => (panelRefs.current[i] = el)}
              aria-hidden={i !== active}
            >
              {c.node}
            </div>
          ))}
        </div>
      </div>

      {/* Footer nav */}
      <div className="tc-nav">
        <button
          type="button"
          className="tc-nav-btn"
          disabled={active === 0}
          onClick={() => go(active - 1)}
        >
          ‹ Back
        </button>
        <div className="tc-dots">
          {list.map((c, i) => (
            <button
              key={c.key}
              type="button"
              className={"tc-dot" + (i === active ? " is-active" : "")}
              aria-label={c.label}
              title={c.label}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <span className="tc-count">{active + 1} / {n}</span>
        <button
          type="button"
          className="tc-nav-btn is-primary"
          disabled={active === n - 1}
          onClick={() => go(active + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

export default ModuleChapters;
