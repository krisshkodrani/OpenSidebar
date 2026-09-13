import type {
  PlaygroundScenarioV2,
  ScenarioActionV2,
  ScenarioStateV2,
} from "@opensidebar/scenario-contracts";
import { scenarioEngine } from "./engine.js";

/** LP-36 public projection. Internal case/validator identities stay server-side. */
const PUBLIC_CASES: Readonly<Record<string, string>> = {
  "restock-alert": "monitoring.watch-and-act-on-restock",
  "price-watch": "monitoring.set-price-threshold",
  "dashboard-threshold": "monitoring.dedupe-repeated-signal",
  "message-watch": "monitoring.recover-monitor-reconnect",
  "online-purchase": "retail.checkout-multi-item",
  registration: "hr.recover-validation-errors",
  procurement: "procurement.compare-approved-vendors",
  "email-compose": "email.draft-short-reply",
  "data-table": "records.filter-overdue-records",
  "article-research": "knowledge.synthesize-two-policies",
  "dashboard-extraction": "analytics.compare-region-conversion",
  "renewal-investigation": "analytics.find-linked-driver",
};

export function publicPlaygroundCase(id: string) {
  if (!Object.hasOwn(PUBLIC_CASES, id))
    throw new Error("Unknown public scenario");
  return scenarioEngine.case(PUBLIC_CASES[id]);
}

export function publicPlaygroundCatalog(): PlaygroundScenarioV2[] {
  return Object.keys(PUBLIC_CASES).map((id) => {
    const definition = publicPlaygroundCase(id);
    const { contract } = definition;
    return {
      id,
      version: contract.version,
      title: contract.title,
      task: contract.prompt,
      family: scenarioEngine.scenario(contract.scenarioId).manifest.family,
      difficulty: contract.difficulty,
      observationOnly: contract.capabilityTags.includes("answer"),
    };
  });
}

/** Accept only simulated operational actions, never answer/trace/telemetry payloads. */
export function publicPlaygroundAction(
  state: ScenarioStateV2,
  input: unknown,
): ScenarioActionV2 {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid action");
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["type", "payload"].includes(key)))
    throw new Error("Unsupported action data");
  const payload = raw.payload ?? {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid action payload");
  const fields = payload as Record<string, unknown>;
  if (
    raw.type === "workflow.advance" &&
    Object.keys(fields).every((key) => key === "stageId") &&
    typeof fields.stageId === "string" &&
    fields.stageId.length <= 100
  ) {
    return { type: raw.type, payload: { stageId: fields.stageId } };
  }
  if (raw.type === "workflow.recover" && Object.keys(fields).length === 0)
    return { type: raw.type, payload: {} };
  if (raw.type !== "case.submit") throw new Error("Unsupported public action");
  const view = scenarioEngine.targetView(state);
  const interaction = view.data.interaction;
  if (
    !interaction ||
    typeof interaction !== "object" ||
    Array.isArray(interaction) ||
    interaction.mutable !== true
  )
    throw new Error(
      "This task is read-only; answers stay in your browser agent",
    );
  if (
    !interaction.requiresValue &&
    Object.keys(fields).length === 1 &&
    fields.decision === "apply"
  )
    return { type: "case.submit", payload: { decision: "apply" } };
  // The curated public set has one editable numeric threshold; arbitrary text is not retained.
  if (
    interaction.requiresValue &&
    interaction.control === "number" &&
    Object.keys(fields).length === 1 &&
    typeof fields.value === "string" &&
    /^\d{1,7}(?:\.\d{1,2})?$/.test(fields.value)
  )
    return { type: "case.submit", payload: { value: fields.value } };
  throw new Error("Unsupported public action data");
}
