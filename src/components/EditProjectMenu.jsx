/* =========================================================
   EditProjectMenu — a self-contained 3-dot (⋯) per-project
   action menu for the Editor Projects gallery.

   Surfaces Rename / Archive(or Unarchive) / Delete behind a
   single overflow button so the project card footer stays
   compact. Owner-gated by the CALLER (editor-projects.jsx only
   renders this when canManage is true) — this component makes
   no permission decisions of its own.

   ── Why this lives in its OWN component (FB_PROJECTS scope) ──
   It is the only NEW FootageBrain file this team owns. It is
   fully self-contained — it imports nothing from the store and
   takes everything it needs as props, so it never couples to
   store.jsx internals:

     · project   -> the project row (for title + status)
     · onRename(project)   -> caller prompts + calls renameEditProject
     · onArchive(project)  -> caller calls archiveEditProject(id, !archived)
     · onDelete(project)   -> caller confirms + calls deleteEditProject

   ── Portal-escape (reference_portal-escape-overflow-clip) ──
   The gallery card has `overflow: hidden`, so a normally-positioned
   dropdown would be clipped. The menu panel is rendered into a
   portal on document.body and positioned with a fixed rect taken
   from the trigger button, and it closes on outside-click, scroll,
   resize, and Escape.

   Styling is inline (design-token-driven) so this component needs
   no CSS file edits — it slots into the existing .ep-card-foot.
   ========================================================= */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

/* Normalize status -> is this project archived? (mirror editor-projects.jsx) */
function isArchived(status) {
  return String(status || "draft").toLowerCase().replace(/[^a-z]/g, "") === "archived";
}

export function EditProjectMenu({ project, onRename, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);       // trigger bounding rect (for fixed positioning)
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const archived = isArchived(project?.status);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen && btnRef.current) {
        setRect(btnRef.current.getBoundingClientRect());
      }
      return !wasOpen;
    });
  }, []);

  /* Close on outside-click (checking BOTH the trigger and the portal panel —
     the portal is OUTSIDE the card DOM subtree), Escape, scroll, and resize. */
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    // capture so a scroll anywhere in the page dismisses the (now-misplaced) menu
    window.addEventListener("mousedown", onDocClick, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    return () => {
      window.removeEventListener("mousedown", onDocClick, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
    };
  }, [open, close]);

  const run = useCallback((fn) => {
    close();
    if (typeof fn === "function") fn(project);
  }, [close, project]);

  /* Panel position: right-aligned to the trigger, dropping below it. Clamped
     so it never overflows the right edge of the viewport. */
  const panelStyle = rect
    ? {
        position: "fixed",
        top: Math.round(rect.bottom + 6),
        left: Math.round(Math.min(rect.right - 176, window.innerWidth - 188)),
        zIndex: 1300,
      }
    : { position: "fixed", top: 0, left: 0, zIndex: 1300 };

  const itemStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    appearance: "none",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: "var(--fg, #e6e6e6)",
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 12px",
    borderRadius: 7,
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="ep-act ep-act--menu"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Project actions — rename, archive, delete"
        style={{ flex: "0 0 auto", minWidth: 40, fontSize: 16, lineHeight: 1 }}
      >
        ⋯
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label="Project actions"
          style={{
            ...panelStyle,
            width: 176,
            padding: 6,
            borderRadius: 10,
            border: "1px solid var(--line, #2a2d33)",
            background: "var(--bg-2, #15171b)",
            boxShadow: "0 12px 40px rgba(0,0,0,.5)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <button
            type="button"
            role="menuitem"
            style={itemStyle}
            onClick={() => run(onRename)}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3, #1a1c20)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            ✎ Rename
          </button>
          <button
            type="button"
            role="menuitem"
            style={itemStyle}
            onClick={() => run(onArchive)}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3, #1a1c20)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {archived ? "📤 Unarchive" : "🗄 Archive"}
          </button>
          <div style={{ height: 1, background: "var(--line, #2a2d33)", margin: "3px 4px" }} aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            style={{ ...itemStyle, color: "var(--c-red, #e2554a)" }}
            onClick={() => run(onDelete)}
            onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--c-red, #e2554a) 12%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            🗑 Delete
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

export default EditProjectMenu;
