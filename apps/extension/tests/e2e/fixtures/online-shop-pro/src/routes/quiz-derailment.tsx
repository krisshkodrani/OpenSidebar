import { useEffect, useMemo, useState } from "react";

const OPTIONS = [
  "Domain Adaptation Fine-Tuning",
  "Continued Pre-Training",
  "Incremental Learning",
] as const;

const CORRECT_OPTIONS = new Set<string>([
  "Domain Adaptation Fine-Tuning",
  "Continued Pre-Training",
]);

export default function QuizDerailment() {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedOptions = useMemo(
    () => OPTIONS.filter((option) => selected[option]),
    [selected],
  );
  const isCorrect =
    selectedOptions.length === CORRECT_OPTIONS.size &&
    selectedOptions.every((option) => CORRECT_OPTIONS.has(option));

  useEffect(() => {
    (window as any).quizResult = isCorrect
      ? {
          completed: true,
          questionNumber: 32,
          selected: selectedOptions,
        }
      : null;
  }, [isCorrect, selectedOptions]);

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Quiz Derailment Fixture</h1>
        <p>Question 32 / 40</p>
      </div>

      <main className="container">
        <section className="card" aria-labelledby="question-title">
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 8 }}>
            Question 32
          </p>
          <h2 id="question-title" style={{ marginBottom: 16 }}>
            Which approaches help adapt a foundation model to a specialized
            domain?
          </h2>
          <p className="instructions" style={{ marginBottom: 18 }}>
            Select two options. This question intentionally differs from the
            stale planner note used by the test.
          </p>

          <fieldset
            aria-label="Question 32 answer options"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 18,
            }}
          >
            <legend style={{ padding: "0 8px", fontWeight: 600 }}>
              Answer choices
            </legend>
            {OPTIONS.map((option) => {
              const id = `quiz-${option.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              return (
                <label
                  key={option}
                  htmlFor={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    cursor: "pointer",
                  }}
                >
                  <input
                    id={id}
                    name="question-32"
                    type="checkbox"
                    checked={Boolean(selected[option])}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [option]: event.target.checked,
                      }))
                    }
                    style={{ width: 16, height: 16 }}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </fieldset>

          <div
            id="selected-answer-summary"
            aria-live="polite"
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 8,
              background: "#f8fafc",
              color: "#334155",
            }}
          >
            Selected answers:{" "}
            {selectedOptions.length ? selectedOptions.join(", ") : "None"}
          </div>

          {isCorrect && (
            <div
              id="quiz-success"
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 8,
                background: "#dcfce7",
                color: "#166534",
                fontWeight: 600,
              }}
            >
              Selected answer set is complete for Question 32.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
