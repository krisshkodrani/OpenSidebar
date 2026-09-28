import { cleanLabel } from "./text-utils";

const USER_CONTEXT_MARKERS: RegExp[] = [
  /\bStay focused on this goal\b/i,
  /\s##\s+/i,
  /\n\s*(?:Objective|Success criteria|Page Context|Page history[^\n:]*|Prior actions[^\n:]*|Current task|Relevant context|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Pre-execution advisory)\s*:/i,
];

const CURRENT_OBJECTIVE_MARKERS: RegExp[] = [
  /\n\s*(?:Success criteria|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Page history[^\n:]*|Prior actions[^\n:]*|Pre-execution advisory)\s*:/i,
  /\s##\s+/i,
];

const CURRENT_SUCCESS_CRITERIA_MARKERS: RegExp[] = [
  /\n\s*(?:Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Page history[^\n:]*|Prior actions[^\n:]*|Pre-execution advisory)\s*:/i,
  /\s##\s+/i,
];

export function extractCanonicalUserRequest(value: string): string {
  const originalUserRequest = extractLabeledRequest(value, [
    ...USER_CONTEXT_MARKERS,
  ]);
  if (originalUserRequest) return originalUserRequest;

  const workflowMatch =
    /\bcomplete the workflow for the original request\s*:\s*([\s\S]*)/i.exec(
      value,
    );
  if (workflowMatch) {
    const request = takeUntilFirstMarker(workflowMatch[1], [
      /\n\s*(?:Success criteria|Page Context|Page history[^\n:]*|Prior actions[^\n:]*|Current task|Relevant context|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Pre-execution advisory)\s*:/i,
      /\s+Success criteria\s*:/i,
      /\s##\s+/i,
    ]);
    if (request) return request;
  }

  return cleanLabel(value);
}

export function extractCurrentObjectiveRequestText(value: string): string {
  const objective = extractPromptSection(
    value,
    "Objective",
    CURRENT_OBJECTIVE_MARKERS,
  );
  const successCriteria = extractPromptSection(
    value,
    "Success criteria",
    CURRENT_SUCCESS_CRITERIA_MARKERS,
  );
  return [objective, successCriteria].filter(Boolean).join("\n");
}

function extractPromptSection(
  value: string,
  label: string,
  markers: RegExp[],
): string | null {
  const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*`, "i").exec(value);
  if (!match) return null;
  return takeUntilFirstMarker(
    value.slice(match.index + match[0].length),
    markers,
  );
}

function extractLabeledRequest(
  value: string,
  markers: RegExp[],
): string | null {
  const match =
    /\boriginal user request(?:\s*\([^)]*\))?\s*:\s*([\s\S]*)/i.exec(value);
  if (!match) return null;
  return takeUntilFirstMarker(match[1], markers) || null;
}

function takeUntilFirstMarker(value: string, markers: RegExp[]): string {
  let end = value.length;
  for (const marker of markers) {
    const match = marker.exec(value);
    if (match?.index != null && match.index < end) {
      end = match.index;
    }
  }
  return cleanLabel(value.slice(0, end));
}
