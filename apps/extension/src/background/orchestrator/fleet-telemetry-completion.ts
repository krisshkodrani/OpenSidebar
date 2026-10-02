import { chromePersistencePort } from "../environment/chrome";
import { collectFleetTelemetryLocally, projectFleetTelemetryEnvelope } from "../telemetry";
import { buildTaskFleetTelemetryProjectionInput, createTaskFleetTelemetryState, type TaskFleetTelemetryState } from "./fleet-telemetry";
import { getFleetTelemetryRuntimeContext } from "./runtime-policy";
import type { OrchestratorTask } from "./types";

/** Queue a bounded terminal summary without retaining raw task data. */
export function queueTaskFleetTelemetry(
  task: OrchestratorTask,
  completionStatus: "completed" | "partial" | "failed" | "stopped",
  states: Map<string, TaskFleetTelemetryState>,
): void {
  const state = states.get(task.id) ?? createTaskFleetTelemetryState();
  states.delete(task.id);
  void collectFleetTelemetryLocally({
    storage: chromePersistencePort.local,
    project: () => projectFleetTelemetryEnvelope(
      buildTaskFleetTelemetryProjectionInput({
        task, state, runtime: getFleetTelemetryRuntimeContext(), completionStatus,
      }),
    ),
  });
}
