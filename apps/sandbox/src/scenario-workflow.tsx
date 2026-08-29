import type { JsonObject, JsonValue } from "@opensidebar/scenario-contracts";

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function display(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function workflowCompletionMessage(finalActionComplete: boolean): string {
  return finalActionComplete
    ? "The final action was saved successfully."
    : "All dependent stages are complete; the final action is now available.";
}

export function ScenarioWorkflow({
  workflow,
  workflowState,
  dynamics,
  busy,
  finalActionComplete,
  onAdvance,
  onRecover,
}: {
  workflow: JsonValue | undefined;
  workflowState: JsonValue | undefined;
  dynamics: JsonValue | undefined;
  busy: boolean;
  finalActionComplete: boolean;
  onAdvance(stageId: string): void;
  onRecover(): void;
}) {
  const stages = Array.isArray(workflow) ? workflow.map(objectValue) : [];
  if (!stages.length) return null;
  const state = objectValue(workflowState);
  const dynamic = objectValue(dynamics);
  const currentIndex =
    typeof state.currentIndex === "number" ? state.currentIndex : 0;
  const active = stages[currentIndex];
  const interrupted = state.requiresRecovery === true;
  const completed = state.status === "complete";

  return (
    <>
      <ol className="scenario-progress" aria-label="Workflow progress">
        {stages.map((stage, index) => (
          <li className={String(stage.status)} key={display(stage.id)}>
            <span>{index + 1}</span>
            <div>
              <strong>{display(stage.title)}</strong>
              <small>{display(stage.status)}</small>
            </div>
          </li>
        ))}
      </ol>
      {interrupted && (
        <section className="scenario-panel scenario-interruption" role="alert">
          <h2>Application changed</h2>
          <p>{display(dynamic.trigger)}</p>
          <button
            className="scenario-primary"
            disabled={busy}
            onClick={onRecover}
          >
            {busy ? "Recovering…" : display(dynamic.recoveryLabel)}
          </button>
        </section>
      )}
      {!interrupted && dynamic.status === "recovered" && (
        <section className="scenario-recovered" role="status">
          <strong>State recovered.</strong> {display(dynamic.recoverySignal)}
        </section>
      )}
      {!completed && !interrupted && active && (
        <section className="scenario-panel scenario-stage">
          <div className="scenario-stage-heading">
            <span>
              Step {currentIndex + 1} of {stages.length}
            </span>
            <h2>{display(active.title)}</h2>
            <p>{display(active.detail)}</p>
          </div>
          {Array.isArray(active.evidence) && active.evidence.length > 0 && (
            <dl className="scenario-evidence">
              {active.evidence.map((entry, index) => {
                const item = objectValue(entry);
                return (
                  <div key={index}>
                    <dt>{display(item.label)}</dt>
                    <dd>{display(item.value)}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          <button
            className="scenario-primary"
            disabled={busy}
            onClick={() => onAdvance(display(active.id))}
          >
            {busy ? "Updating…" : display(active.actionLabel)}
          </button>
        </section>
      )}
      {completed && (
        <section className="scenario-recovered" role="status">
          <strong>
            {finalActionComplete ? "Workflow complete." : "Workflow reviewed."}
          </strong>{" "}
          {workflowCompletionMessage(finalActionComplete)}
        </section>
      )}
    </>
  );
}
