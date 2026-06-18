/* =========================================================
   EditableText — reusable click-to-edit-inline primitive.

   Presentational only: it never touches Supabase. The parent passes
   `onCommit(newValue)` which wires to a store action
   (e.g. actions.setModuleContent(moduleId, fieldPath, value)).

   Props:
     value      — the current (resolved) string to show / seed the editor
     canEdit    — when false, render read-only (preserves line breaks)
     multiline  — textarea instead of input; Shift+Enter inserts a newline
     placeholder— shown (dimmed) when value is empty
     onCommit   — (string) => void, called when the user commits a change
     className  — extra class on the wrapper

   Interaction (owner / canEdit):
     · whole text is the click target (cursor:text, subtle dotted underline
       + a ✎ pencil affordance on hover)
     · click enters edit mode → autoFocused input/textarea seeded from value
     · Enter commits (single-line); in a textarea Enter commits too but
       Shift+Enter inserts a newline
     · blur commits; Esc cancels (restores the original value)
     · the new value is trimmed; onCommit is skipped when unchanged
   ========================================================= */

import React, { useState, useEffect, useRef } from "react";
import { linkifyText } from "../lib/linkify";
import "./editable.css";

export function EditableText({
  value,
  canEdit = false,
  multiline = false,
  placeholder = "",
  onCommit,
  className = "",
  linkify = false,
  // Optional persisted-embed wiring forwarded to linkifyText (YouTube links).
  embeddedUrls,
  onToggleEmbed,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef(null);

  // Keep the draft in sync if the resolved value changes while not editing
  // (e.g. another field's optimistic update re-renders the parent).
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  // Autofocus + place cursor at the end when entering edit mode.
  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
    }
  }, [editing]);

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = (draft ?? "").trim();
    const cur = (value ?? "").trim();
    if (next === cur) return; // unchanged — skip the write
    onCommit?.(next);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === "Enter") {
      if (multiline && e.shiftKey) return; // allow newline
      e.preventDefault();
      commit();
    }
  };

  // ── Read-only render ─────────────────────────────────────────────
  if (!canEdit) {
    const empty = !value;
    return (
      <span
        className={"et-readonly " + (multiline ? "et-multiline " : "") + className}
        style={empty ? { opacity: 0.4 } : undefined}
      >
        {empty ? (placeholder || "—") : (linkify ? linkifyText(value, { embeddedUrls, onToggleEmbed }) : value)}
      </span>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────
  if (editing) {
    const sharedStyle = {
      width: "100%",
      boxSizing: "border-box",
      background: "var(--bg-3, var(--bg-2))",
      border: "1px solid var(--c-violet, var(--line-hard))",
      color: "var(--fg)",
      borderRadius: 4,
      padding: multiline ? "7px 9px" : "4px 7px",
      fontSize: "inherit",
      fontFamily: "inherit",
      lineHeight: "inherit",
      resize: "vertical",
    };
    return multiline ? (
      <textarea
        ref={ref}
        className={"et-input " + className}
        value={draft}
        rows={Math.min(14, Math.max(3, String(draft).split("\n").length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={sharedStyle}
      />
    ) : (
      <input
        ref={ref}
        className={"et-input " + className}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={sharedStyle}
      />
    );
  }

  // ── Editable, not yet editing ────────────────────────────────────
  // With `linkify`, the owner still sees clickable links + the embed toggle;
  // link/button clicks stopPropagation so they don't trigger edit mode, and
  // the ✎ pencil (or any plain-text run) remains the click-to-edit target.
  const empty = !value;
  return (
    <span
      className={"et-editable " + (multiline ? "et-multiline " : "") + className}
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      title="Click to edit"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDraft(value ?? ""); setEditing(true); } }}
      style={empty ? { opacity: 0.55 } : undefined}
    >
      {empty ? (placeholder || "Click to add…") : (linkify ? linkifyText(value, { embeddedUrls, onToggleEmbed }) : value)}
      <span className="et-pencil" aria-hidden="true">✎</span>
    </span>
  );
}

export default EditableText;
