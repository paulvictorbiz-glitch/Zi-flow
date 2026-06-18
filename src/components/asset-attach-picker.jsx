/* =========================================================
   AssetAttachPicker — a small "+" button that opens a searchable,
   multi-select popover for attaching assets of ONE category to a
   reel-dna card.

   Pure / store-agnostic: the caller passes the normalized `options`
   for this category and an `onAttach(selections)` callback that does
   the actual batched attachAsset() writes. Items already attached are
   shown checked + disabled so they can't be double-picked (attach is
   upsert-deduped anyway, so this is purely a UX nicety).

   Self-contained trigger + popover (no portal) — positioned absolutely
   inside a position:relative wrapper. Closes on outside-click and Esc.
   ========================================================= */

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./asset-attach-picker.css";

export function AssetAttachPicker({
  title,                 // popover header, e.g. "Attach footage"
  options = [],          // [{ id, label, sublabel? }]
  attachedIds,           // Set<string> of already-attached source ids
  onAttach,              // (selections: Array<{id,label}>) => void
  buttonLabel = "+",
  wide = false,          // true → labeled pill trigger (e.g. "+ Footage")
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const rootRef = useRef(null);

  const attached = attachedIds instanceof Set ? attachedIds : new Set();

  // Outside-click + Esc close — only while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setSelected(new Set());
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      const hay = ((o.label || "") + " " + (o.sublabel || "")).toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const doAttach = () => {
    if (selected.size === 0) return;
    const byId = new Map(options.map(o => [String(o.id), o]));
    const picks = [...selected].map(id => {
      const o = byId.get(String(id));
      return { id, label: o?.label };
    });
    onAttach?.(picks);
    close();
  };

  return (
    <span className="aap-root" ref={rootRef}>
      <button
        type="button"
        className={"aap-trigger" + (wide ? " aap-trigger--wide" : "")}
        title={title || "Attach"}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="aap-pop" role="dialog">
          <div className="aap-pop-head">{title || "Attach"}</div>

          <input
            className="aap-search"
            autoFocus
            placeholder="Search…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />

          <div className="aap-list">
            {filtered.length === 0 ? (
              <div className="aap-empty">
                {options.length === 0 ? "Nothing to attach" : "No matches"}
              </div>
            ) : (
              filtered.map(o => {
                const id = String(o.id);
                const isAttached = attached.has(id);
                const isChecked = isAttached || selected.has(id);
                return (
                  <label
                    key={id}
                    className={"aap-item" + (isAttached ? " is-attached" : "")}
                    title={isAttached ? "Already attached" : (o.label || "")}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isAttached}
                      onChange={() => toggle(id)}
                    />
                    <span className="aap-item-text">
                      <span className="aap-item-label">{o.label || "Untitled"}</span>
                      {o.sublabel && <span className="aap-item-sub">{o.sublabel}</span>}
                    </span>
                    {isAttached && <span className="aap-item-tag">attached</span>}
                  </label>
                );
              })
            )}
          </div>

          <div className="aap-foot">
            <button type="button" className="aap-cancel" onClick={close}>Cancel</button>
            <button
              type="button"
              className="aap-confirm"
              disabled={selected.size === 0}
              onClick={doAttach}
            >
              Attach {selected.size > 0 ? selected.size : ""} selected
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export default AssetAttachPicker;
