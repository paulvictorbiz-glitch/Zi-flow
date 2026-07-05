/* =========================================================
   FileUpload — Aceternity "File Upload", ported to this repo's stack
   (plain CSS tokens + `motion`, NO Tailwind, NO react-dropzone).

   A grid-backed dropzone that accepts a file by DRAG-AND-DROP or CLICK,
   then shows an animated card for the picked file (name + size + type).
   Micro-interactions: the grid lifts on drag-over, the drop hint swaps,
   and the file card springs in via `motion`.

   Contract mirrors the upstream component: the ONLY required prop is
   `onChange(files)` — an array of File objects. Everything else is
   presentational / state passthrough so a parent (here detail.jsx) keeps
   owning the actual upload + persistence.

   Props:
     onChange   — (files: File[]) => void        [required]
     accept     — input accept string (e.g. "video/mp4,video/quicktime")
     multiple   — allow multi-select (default false)
     disabled   — block interaction
     busy       — show an "uploading…" spinner state
     title      — main hint line
     hint       — sub hint line (e.g. accepted types)
     files      — controlled list of picked files to display (optional);
                  when omitted the component tracks its own last pick.
   ========================================================= */
import React, { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import cn from "../lib/cn.js";
import "./file-upload.css";

function prettySize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileUpload({
  onChange,
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  title = "Drag & drop a file here, or click to browse",
  hint,
  files: controlledFiles,
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [ownFiles, setOwnFiles] = useState([]);
  const files = controlledFiles != null ? controlledFiles : ownFiles;

  const emit = useCallback(
    (list) => {
      const arr = Array.from(list || []).filter(Boolean);
      if (arr.length === 0) return;
      const picked = multiple ? arr : arr.slice(0, 1);
      if (controlledFiles == null) setOwnFiles(picked);
      onChange && onChange(picked);
    },
    [multiple, onChange, controlledFiles]
  );

  const openPicker = () => {
    if (disabled || busy) return;
    inputRef.current && inputRef.current.click();
  };

  const onInputChange = (e) => {
    emit(e.target.files);
    e.target.value = ""; // allow re-picking the same file
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled || busy) return;
    emit(e.dataTransfer?.files);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || busy) return;
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  return (
    <div
      className={cn(
        "fup",
        dragActive && "fup--drag",
        (disabled || busy) && "fup--disabled",
        busy && "fup--busy"
      )}
      onClick={openPicker}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || busy || undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && !busy) {
          e.preventDefault();
          openPicker();
        }
      }}
    >
      <div className="fup__grid" aria-hidden="true" />

      <input
        ref={inputRef}
        type="file"
        className="fup__input"
        accept={accept}
        multiple={multiple}
        disabled={disabled || busy}
        onChange={onInputChange}
      />

      <div className="fup__body">
        <div className={cn("fup__icon", dragActive && "fup__icon--drag")} aria-hidden="true">
          {busy ? <span className="fup__spinner" /> : "⬆"}
        </div>
        <div className="fup__text">
          <div className="fup__title">
            {busy ? "Uploading…" : dragActive ? "Drop it here" : title}
          </div>
          {hint && !busy && <div className="fup__hint">{hint}</div>}
        </div>
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.ul
            className="fup__files"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            {files.map((f, i) => (
              <motion.li
                key={(f.name || "file") + i}
                className="fup__file"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
              >
                <span className="fup__file-icon" aria-hidden="true">🎬</span>
                <span className="fup__file-name" title={f.name}>{f.name}</span>
                <span className="fup__file-meta">
                  {prettySize(f.size)}
                  {f.type ? ` · ${f.type.split("/").pop()}` : ""}
                </span>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export default FileUpload;
