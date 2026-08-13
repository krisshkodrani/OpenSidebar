import type {
  JsonObject,
  JsonValue,
  ScenarioActionV2,
  ScenarioStateV2,
  ScenarioTargetViewV2,
} from "@opensidebar/scenario-contracts";
import { cloneJson } from "./stable-json.js";

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function pathParts(value: JsonValue | undefined): string[] {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Scenario action requires a non-empty path.");
  }
  return value.split(".").filter(Boolean);
}

function parentAt(root: JsonObject, parts: string[]): [JsonObject, string] {
  const final = parts.at(-1);
  if (!final) throw new Error("Scenario action path is empty.");
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    const child = objectValue(parent[part]);
    if (!child) {
      const created: JsonObject = {};
      parent[part] = created;
      parent = created;
    } else {
      parent = child;
    }
  }
  return [parent, final];
}

function workflowControl(control: JsonObject): JsonObject | null {
  return objectValue(control.workflow);
}

function requireCompletedWorkflow(control: JsonObject, publicData: JsonObject): void {
  if (workflowControl(control) && objectValue(publicData.workflowState)?.status !== "complete") {
    throw new Error("Complete the current workflow before recording its final outcome.");
  }
}

export function createScenarioState(input: {
  scenarioId: string;
  scenarioVersion: number;
  seed: number;
  publicData: JsonObject;
  control?: JsonObject;
}): ScenarioStateV2 {
  return {
    schemaVersion: 2,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    seed: input.seed,
    revision: 1,
    lifecycle: "ready",
    route: "/",
    data: {
      public: cloneJson(input.publicData),
      control: cloneJson(input.control ?? {}),
    },
    events: [],
  };
}

export function reduceScenarioState(
  state: ScenarioStateV2,
  action: ScenarioActionV2,
): ScenarioStateV2 {
  const next = cloneJson(state);
  const payload = action.payload ?? {};
  switch (action.type) {
    case "navigate": {
      if (typeof payload.route !== "string" || !payload.route.startsWith("/")) {
        throw new Error("navigate requires an absolute route.");
      }
      next.route = payload.route;
      break;
    }
    case "set": {
      const [parent, key] = parentAt(next.data, pathParts(payload.path));
      if (!("value" in payload)) throw new Error("set requires a value.");
      parent[key] = cloneJson(payload.value as JsonValue);
      break;
    }
    case "append": {
      const [parent, key] = parentAt(next.data, pathParts(payload.path));
      const current = parent[key];
      if (!Array.isArray(current)) throw new Error("append target must be an array.");
      if (!("value" in payload)) throw new Error("append requires a value.");
      current.push(cloneJson(payload.value as JsonValue));
      break;
    }
    case "remove": {
      const [parent, key] = parentAt(next.data, pathParts(payload.path));
      delete parent[key];
      break;
    }
    case "finish": {
      next.lifecycle = "finished";
      break;
    }
    case "workflow.advance": {
      const control = objectValue(next.data.control) ?? {};
      const publicData = objectValue(next.data.public) ?? {};
      const workflow = Array.isArray(publicData.workflow) ? publicData.workflow : [];
      const workflowState = objectValue(publicData.workflowState);
      const workflowSpec = workflowControl(control);
      const stageIds = workflowSpec && Array.isArray(workflowSpec.stageIds)
        ? workflowSpec.stageIds.filter((value): value is string => typeof value === "string")
        : [];
      const index = workflowState?.currentIndex;
      if (
        !workflowState || !workflowSpec || workflowState.status !== "active" ||
        workflowState.requiresRecovery === true || typeof index !== "number" ||
        payload.stageId !== stageIds[index]
      ) {
        throw new Error("The requested workflow stage is not currently available.");
      }
      const current = objectValue(workflow[index]);
      if (!current) throw new Error("The current workflow stage is missing.");
      current.status = "complete";
      workflow[index] = current;
      const nextIndex = index + 1;
      if (nextIndex < workflow.length) {
        const following = objectValue(workflow[nextIndex]);
        if (!following) throw new Error("The next workflow stage is missing.");
        following.status = "active";
        workflow[nextIndex] = following;
        workflowState.currentIndex = nextIndex;
        if (workflowSpec.disruptAfter === index) {
          workflowState.requiresRecovery = true;
          const dynamics = objectValue(publicData.dynamics) ?? {};
          dynamics.status = "interrupted";
          publicData.dynamics = dynamics;
        }
      } else {
        workflowState.currentIndex = workflow.length;
        workflowState.status = "complete";
      }
      publicData.workflow = workflow;
      publicData.workflowState = workflowState;
      next.data.public = publicData;
      break;
    }
    case "workflow.recover": {
      const control = objectValue(next.data.control) ?? {};
      const publicData = objectValue(next.data.public) ?? {};
      const workflowState = objectValue(publicData.workflowState);
      const workflowSpec = workflowControl(control);
      if (!workflowSpec || !workflowState || workflowState.requiresRecovery !== true) {
        throw new Error("There is no interrupted workflow to recover.");
      }
      workflowState.requiresRecovery = false;
      const dynamics = objectValue(publicData.dynamics) ?? {};
      dynamics.status = "recovered";
      publicData.dynamics = dynamics;
      publicData.workflowState = workflowState;
      next.data.public = publicData;
      break;
    }
    case "case.submit": {
      const control = objectValue(next.data.control) ?? {};
      const publicData = objectValue(next.data.public) ?? {};
      const caseState = objectValue(publicData.case) ?? {};
      requireCompletedWorkflow(control, publicData);
      if (!("expected" in control)) {
        throw new Error("Scenario does not define a case submission result.");
      }
      if (control.submissionKind === "value") {
        const normalize = (value: unknown) => String(value ?? "")
          .trim()
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        const actual = normalize(payload.value);
        const accepted = normalize(control.acceptedValue);
        if (!actual || actual !== accepted) {
          throw new Error("The submitted value is not valid for this record.");
        }
      } else if (control.submissionKind === "action") {
        if (payload.decision !== "apply") {
          throw new Error("The requested application action was not confirmed.");
        }
      } else {
        throw new Error("Scenario does not define a supported submission interaction.");
      }
      caseState.status = "complete";
      caseState.value = cloneJson(control.expected);
      publicData.case = caseState;
      next.data.public = publicData;
      next.lifecycle = "finished";
      break;
    }
    case "case.terminal": {
      const control = objectValue(next.data.control) ?? {};
      const publicData = objectValue(next.data.public) ?? {};
      const caseState = objectValue(publicData.case) ?? {};
      requireCompletedWorkflow(control, publicData);
      if (
        typeof payload.decision !== "string" ||
        payload.decision !== control.terminalDecision ||
        control.mode !== "terminal" ||
        typeof control.expected !== "string"
      ) {
        throw new Error("Scenario terminal decision is not available.");
      }
      caseState.status = "complete";
      caseState.outcome = control.expected;
      publicData.case = caseState;
      next.data.public = publicData;
      next.lifecycle = "finished";
      break;
    }
    default:
      throw new Error(`Unsupported scenario action: ${action.type}`);
  }
  next.revision += 1;
  next.lifecycle = next.lifecycle === "ready" ? "active" : next.lifecycle;
  next.events = [
    ...next.events,
    {
      sequence: next.events.length + 1,
      type: action.type,
      payload: cloneJson(payload),
    },
  ];
  return next;
}

export function projectScenarioTarget(
  state: ScenarioStateV2,
): ScenarioTargetViewV2 {
  const publicData = objectValue(state.data.public) ?? {};
  return {
    scenarioId: state.scenarioId,
    scenarioVersion: state.scenarioVersion,
    revision: state.revision,
    lifecycle: state.lifecycle,
    route: state.route,
    data: cloneJson(publicData),
  };
}
