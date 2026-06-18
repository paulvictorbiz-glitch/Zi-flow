/* =========================================================
   Quiz — interactive self-check for a training module.

   Renders a module's quiz (multiple-choice + true/false). The editor
   selects an answer per question, submits, then sees per-question
   correctness + an explanation and a running score. "Best score"
   semantics: on submit we call onAttempt(score, total, answers); the
   parent (training.jsx) upserts the best score to training_quiz_attempts.

   Presentational only — never touches Supabase. Read-only when the owner
   is previewing another editor (readOnly); attempts aren't saved then.

   quiz item shape (from training-curriculum.jsx or owner override):
     { q, type: "mcq" | "tf", choices: [str], answer: number|boolean, explain }
       · mcq → answer is the index of the correct choice
       · tf  → answer is a boolean; choices ignored (renders True / False)
   ========================================================= */

import React, { useState, useMemo } from "react";

const TF_CHOICES = ["True", "False"];

/* Normalize a quiz item's choices + correct index regardless of type. */
function itemView(item) {
  if (item.type === "tf") {
    return { choices: TF_CHOICES, correct: item.answer === true ? 0 : 1 };
  }
  return { choices: Array.isArray(item.choices) ? item.choices : [], correct: Number(item.answer) };
}

export function Quiz({ quiz, best, readOnly, onAttempt }) {
  const items = Array.isArray(quiz) ? quiz : [];
  const [picks, setPicks] = useState(() => items.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const total = items.length;
  const allAnswered = picks.every((p) => p !== null);

  const score = useMemo(() => {
    if (!submitted) return 0;
    return items.reduce((acc, item, i) => acc + (picks[i] === itemView(item).correct ? 1 : 0), 0);
  }, [submitted, picks, items]);

  if (total === 0) return null;

  const pick = (qi, ci) => {
    if (submitted) return;
    setPicks((prev) => prev.map((p, i) => (i === qi ? ci : p)));
  };

  const submit = () => {
    if (!allAnswered) return;
    const s = items.reduce((acc, item, i) => acc + (picks[i] === itemView(item).correct ? 1 : 0), 0);
    setSubmitted(true);
    if (!readOnly) onAttempt?.(s, total, picks);
  };

  const retry = () => {
    setPicks(items.map(() => null));
    setSubmitted(false);
  };

  const passed = submitted && score === total;

  return (
    <div className="tb-quiz">
      {items.map((item, qi) => {
        const { choices, correct } = itemView(item);
        return (
          <div className="tb-q" key={qi}>
            <div className="tb-q-prompt">
              <span className="tb-q-num">Q{qi + 1}</span>
              {item.q}
            </div>
            <div className="tb-choices">
              {choices.map((c, ci) => {
                const selected = picks[qi] === ci;
                let cls = "tb-choice";
                let mark = selected ? "●" : "○";
                if (submitted) {
                  if (ci === correct) { cls += " is-correct"; mark = "✓"; }
                  else if (selected) { cls += " is-wrong"; mark = "✗"; }
                } else if (selected) {
                  cls += " is-selected";
                }
                return (
                  <button
                    type="button"
                    key={ci}
                    className={cls}
                    disabled={submitted}
                    onClick={() => pick(qi, ci)}
                  >
                    <span className="tb-choice-mark">{mark}</span>
                    <span>{c}</span>
                  </button>
                );
              })}
            </div>
            {submitted && item.explain && (
              <div className={"tb-explain " + (picks[qi] === correct ? "is-correct" : "is-wrong")}>
                {item.explain}
              </div>
            )}
          </div>
        );
      })}

      <div className="tb-quiz-foot">
        {submitted ? (
          <>
            <span className={"tb-score" + (passed ? " is-pass" : "")}>
              Score: <b>{score}</b> / {total}{passed ? " — perfect 🎬" : ""}
            </span>
            <button type="button" className="tb-btn" onClick={retry}>↻ Try again</button>
          </>
        ) : (
          <>
            <span className="tb-score" style={{ color: "var(--fg-dim)" }}>
              {allAnswered ? "Ready to check" : `${picks.filter((p) => p !== null).length} / ${total} answered`}
              {best ? `  ·  best ${best.score}/${best.total}` : ""}
            </span>
            <button type="button" className="tb-btn" disabled={!allAnswered} onClick={submit}>
              Check answers
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default Quiz;
