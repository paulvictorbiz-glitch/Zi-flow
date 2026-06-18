/* =========================================================
   QuizEditor — owner-only authoring UI for a module's quiz.

   Maintains a local draft of the quiz array (seeded from the resolved
   quiz — owner override or curriculum default) and commits the WHOLE
   array on Save via onSave(arr), which the parent serializes to
   training_module_content under field_path "quiz::data". onReset deletes
   that override row, reverting to the code default.

   Shown inline below the quiz when the owner toggles "Edit quiz". Never
   rendered for editors (gated by canEdit in the parent).

   quiz item shape:
     { q, type: "mcq" | "tf", choices: [str], answer: number|boolean, explain }
   ========================================================= */

import React, { useState } from "react";

const blankMcq = () => ({ q: "", type: "mcq", choices: ["", ""], answer: 0, explain: "" });
const blankTf = () => ({ q: "", type: "tf", answer: true, explain: "" });

export function QuizEditor({ quiz, onSave, onReset, onClose }) {
  const [draft, setDraft] = useState(() =>
    (Array.isArray(quiz) ? quiz : []).map((it) => ({
      ...it,
      choices: Array.isArray(it.choices) ? [...it.choices] : ["", ""],
    }))
  );

  const update = (i, patch) => setDraft((d) => d.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const addMcq = () => setDraft((d) => [...d, blankMcq()]);
  const addTf = () => setDraft((d) => [...d, blankTf()]);

  const setType = (i, type) =>
    update(i, type === "tf" ? { type: "tf", answer: true } : { type: "mcq", choices: ["", ""], answer: 0 });

  const setChoice = (i, ci, val) =>
    setDraft((d) => d.map((it, j) => (j === i ? { ...it, choices: it.choices.map((c, k) => (k === ci ? val : c)) } : it)));
  const addChoice = (i) =>
    setDraft((d) => d.map((it, j) => (j === i ? { ...it, choices: [...it.choices, ""] } : it)));
  const removeChoice = (i, ci) =>
    setDraft((d) =>
      d.map((it, j) => {
        if (j !== i) return it;
        const choices = it.choices.filter((_, k) => k !== ci);
        const answer = it.answer >= choices.length ? Math.max(0, choices.length - 1) : it.answer;
        return { ...it, choices, answer };
      })
    );

  const save = () => {
    // Drop empty questions / blank choices before persisting.
    const cleaned = draft
      .map((it) => ({
        ...it,
        q: (it.q || "").trim(),
        explain: (it.explain || "").trim(),
        ...(it.type === "mcq"
          ? { choices: it.choices.map((c) => (c || "").trim()).filter(Boolean) }
          : {}),
      }))
      .filter((it) => it.q && (it.type === "tf" || it.choices.length >= 2));
    onSave?.(cleaned);
    onClose?.();
  };

  return (
    <div className="tb-editor">
      {draft.map((it, i) => (
        <div className="tb-edit-row" key={i}>
          <div className="tb-edit-head">
            <div className="tb-seg">
              <button type="button" className={it.type === "mcq" ? "is-active" : ""} onClick={() => setType(i, "mcq")}>
                Multiple choice
              </button>
              <button type="button" className={it.type === "tf" ? "is-active" : ""} onClick={() => setType(i, "tf")}>
                True / False
              </button>
            </div>
            <button type="button" className="tb-mini-btn is-danger" onClick={() => remove(i)}>Remove</button>
          </div>

          <input
            className="tb-input"
            placeholder="Question prompt…"
            value={it.q}
            onChange={(e) => update(i, { q: e.target.value })}
          />

          {it.type === "mcq" ? (
            <>
              <div className="tb-edit-label">Choices (select the correct one)</div>
              {it.choices.map((c, ci) => (
                <div className="tb-choice-edit" key={ci}>
                  <input
                    type="radio"
                    name={"correct-" + i}
                    checked={Number(it.answer) === ci}
                    onChange={() => update(i, { answer: ci })}
                    title="Mark correct"
                  />
                  <input
                    className="tb-input"
                    placeholder={"Choice " + (ci + 1)}
                    value={c}
                    onChange={(e) => setChoice(i, ci, e.target.value)}
                  />
                  {it.choices.length > 2 && (
                    <button type="button" className="tb-mini-btn is-danger" onClick={() => removeChoice(i, ci)}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="tb-mini-btn" onClick={() => addChoice(i)} style={{ alignSelf: "flex-start" }}>
                + Add choice
              </button>
            </>
          ) : (
            <div className="tb-choice-edit">
              <div className="tb-seg">
                <button type="button" className={it.answer === true ? "is-active" : ""} onClick={() => update(i, { answer: true })}>
                  Correct: True
                </button>
                <button type="button" className={it.answer === false ? "is-active" : ""} onClick={() => update(i, { answer: false })}>
                  Correct: False
                </button>
              </div>
            </div>
          )}

          <input
            className="tb-input"
            placeholder="Explanation shown after answering (optional)"
            value={it.explain}
            onChange={(e) => update(i, { explain: e.target.value })}
          />
        </div>
      ))}

      <div className="tb-editor-foot">
        <button type="button" className="tb-mini-btn" onClick={addMcq}>+ Multiple choice</button>
        <button type="button" className="tb-mini-btn" onClick={addTf}>+ True / False</button>
        <span style={{ flex: 1 }} />
        {onReset && (
          <button type="button" className="tb-mini-btn is-danger" onClick={() => { onReset(); onClose?.(); }}>
            Reset to default
          </button>
        )}
        <button type="button" className="tb-mini-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-btn" onClick={save}>Save quiz</button>
      </div>
    </div>
  );
}

export default QuizEditor;
