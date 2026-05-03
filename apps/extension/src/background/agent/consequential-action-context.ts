interface ConsequentialActionPlanSubtask {
  description?: string;
  status?: string;
}

interface ConsequentialActionPlanStep {
  objective?: string;
  successCriteria?: string;
}

interface ConsequentialActionPlanStatus {
  currentIndex?: number | null;
}

export interface ConsequentialActionTaskTextInput {
  planStatus?: ConsequentialActionPlanStatus | null;
  planSubtasks: ConsequentialActionPlanSubtask[];
  planSteps: ConsequentialActionPlanStep[];
  lastPlanIndex: number;
  originalQuery: string;
}

export function buildConsequentialActionTaskText(
  input: ConsequentialActionTaskTextInput,
): string {
  const activeIndex =
    input.planStatus?.currentIndex ??
    input.planSubtasks.findIndex((subtask) => subtask.status === "running");
  const stepIndex =
    activeIndex != null && activeIndex >= 0 ? activeIndex : input.lastPlanIndex;

  const currentTaskObjective =
    input.originalQuery.match(/## Current Task[\s\S]*?Objective:\s*([^\n]+)/i)?.[1] ??
    input.originalQuery.match(/^Objective:\s*([^\n]+)/im)?.[1] ??
    "";
  const originalUserRequest =
    input.originalQuery.match(/Original user request[^:\n]*:\s*\n([^\n]+)/i)?.[1] ??
    "";

  return [
    input.planSubtasks[stepIndex]?.description,
    input.planSteps[stepIndex]?.objective,
    input.planSteps[stepIndex]?.successCriteria,
    currentTaskObjective,
    originalUserRequest,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}
