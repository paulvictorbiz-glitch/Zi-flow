/* =========================================================
   FlashcardDeck — term/definition recall deck for a training module.

   Editors flip each card (CSS 3D rotateY, no library) and page through the
   deck. The owner (canEdit) gets an inline authoring panel: edit front/back
   of each card, add/remove cards, save the whole array. Saving commits via
   onSave(arr) → training_module_content "flashcards::data"; onReset deletes
   that override row, reverting to the curriculum default.

   Presentational only — never touches Supabase.

   card shape: { front, back }
   ========================================================= */

import React, { useState } from "react";

export function FlashcardDeck({ cards, canEdit, onSave, onReset }) {
  const list = Array.isArray(cards) ? cards : [];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);

  if (list.length === 0 && !canEdit) return null;

  const go = (delta) => {
    setFlipped(false);
    setIdx((i) => {
      const n = list.length || 1;
      return (i + delta + n) % n;
    });
  };

  const safeIdx = Math.min(idx, Math.max(0, list.length - 1));
  const card = list[safeIdx] || { front: "", back: "" };

  return (
    <div className="tb-block">
      <div className="tb-block-head">
        <span className="tb-block-title">🗂 Flashcards</span>
        {canEdit && (
          <button type="button" className="tb-mini-btn" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done editing" : "Edit cards"}
          </button>
        )}
      </div>

      {editing ? (
        <FlashcardEditor cards={list} onSave={onSave} onReset={onReset} onClose={() => setEditing(false)} />
      ) : list.length === 0 ? (
        <span className="tb-deck-hint">No flashcards yet. Use “Edit cards” to add some.</span>
      ) : (
        <div className="tb-deck">
          <div className="tb-card-stage">
            <div
              className={"tb-card" + (flipped ? " is-flipped" : "")}
              onClick={() => setFlipped((f) => !f)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); } }}
            >
              <div className="tb-card-face tb-card-front">
                <span className="tb-card-tag">Term</span>
                <span className="tb-card-text">{card.front}</span>
              </div>
              <div className="tb-card-face tb-card-back">
                <span className="tb-card-tag">Definition</span>
                <span className="tb-card-text">{card.back}</span>
              </div>
            </div>
          </div>
          <div className="tb-deck-nav">
            <button type="button" onClick={() => go(-1)} aria-label="Previous card">‹</button>
            <span>{safeIdx + 1} / {list.length}</span>
            <button type="button" onClick={() => go(1)} aria-label="Next card">›</button>
          </div>
          <span className="tb-deck-hint">Click the card to flip</span>
        </div>
      )}
    </div>
  );
}

function FlashcardEditor({ cards, onSave, onReset, onClose }) {
  const [draft, setDraft] = useState(() => (Array.isArray(cards) ? cards.map((c) => ({ ...c })) : []));

  const update = (i, patch) => setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const add = () => setDraft((d) => [...d, { front: "", back: "" }]);

  const save = () => {
    const cleaned = draft
      .map((c) => ({ front: (c.front || "").trim(), back: (c.back || "").trim() }))
      .filter((c) => c.front || c.back);
    onSave?.(cleaned);
    onClose?.();
  };

  return (
    <div className="tb-editor">
      {draft.map((c, i) => (
        <div className="tb-edit-row" key={i}>
          <div className="tb-edit-head">
            <span className="tb-edit-label">Card {i + 1}</span>
            <button type="button" className="tb-mini-btn is-danger" onClick={() => remove(i)}>Remove</button>
          </div>
          <input
            className="tb-input"
            placeholder="Front — term or prompt"
            value={c.front}
            onChange={(e) => update(i, { front: e.target.value })}
          />
          <input
            className="tb-input"
            placeholder="Back — definition or answer"
            value={c.back}
            onChange={(e) => update(i, { back: e.target.value })}
          />
        </div>
      ))}
      <div className="tb-editor-foot">
        <button type="button" className="tb-mini-btn" onClick={add}>+ Add card</button>
        <span style={{ flex: 1 }} />
        {onReset && (
          <button type="button" className="tb-mini-btn is-danger" onClick={() => { onReset(); onClose?.(); }}>
            Reset to default
          </button>
        )}
        <button type="button" className="tb-mini-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-btn" onClick={save}>Save cards</button>
      </div>
    </div>
  );
}

export default FlashcardDeck;
