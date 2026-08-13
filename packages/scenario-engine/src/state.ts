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
    case "case.submit": {
      const control = objectValue(next.data.control) ?? {};
      const publicData = objectValue(next.data.public) ?? {};
      const caseState = objectValue(publicData.case) ?? {};
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
