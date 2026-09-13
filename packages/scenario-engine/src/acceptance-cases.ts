import type {
  BenchmarkCaseV1,
  JsonObject,
  ScenarioActionV2,
} from "@opensidebar/scenario-contracts";
import { stableHash } from "./stable-json.js";
import type {
  EngineCaseDefinitionV1,
  OracleOutcomeV1,
  ValidatorAssertionSpecV1,
} from "./types.js";

const ID = "acceptance.mb-101-workspace-tab";
const TRACKING_NUMBER = "1Z-9F3-2048";

function set(path: string, value: string): ScenarioActionV2 {
  return { type: "set", payload: { path, value } };
}

const contract: BenchmarkCaseV1 = {
  schemaVersion: 1,
  id: ID,
  version: 1,
  title: "Open a linked record in a workspace tab",
  prompt:
    "Open the linked order NW-1048 in a new tab, read its tracking number, return to this support-note tab, enter only the tracking number, and save. Leave both tabs open and tell me the tracking number.",
  scenarioId: "session-lab",
  scenarioVersion: 2,
  seed: 101,
  difficulty: "medium",
  character: "diagnostic",
  primaryRole: "orchestration",
  capabilityTags: [
    "durability",
    "orchestration",
    "multi-tab",
    "workspace-grouping",
    "side-panel",
  ],
  suites: [],
  maxTurns: 20,
  timeoutMs: 300_000,
  approvalPolicy: "none",
  validatorId: `${ID}.v1`,
  roleRationale:
    "The task requires a real browser-tab handoff, evidence recovery, workspace ownership, and a verified return to the originating tab.",
  metadata: { ordinal: 101, acceptanceProbe: true, headlineScored: false },
};

const driverEvidence: JsonObject = {
  linkedResourceOpened: true,
  spawnedTabInWorkspaceGroup: true,
  sourcePanelEnabled: true,
  spawnedPanelEnabled: true,
  returnedToSourceTab: true,
  openingActionObserved: true,
};

const assertions: ValidatorAssertionSpecV1[] = [
  {
    id: `${ID}.status`,
    source: "state",
    operator: "equals",
    path: "data.public.case.status",
    expected: "complete",
    evidence: "The support note was saved in the source application.",
  },
  {
    id: `${ID}.value`,
    source: "state",
    operator: "equals",
    path: "data.public.case.value",
    expected: TRACKING_NUMBER,
    evidence: "The saved support note contains the tracking number from the linked order.",
  },
  {
    id: `${ID}.answer`,
    source: "answer",
    operator: "includes",
    expected: TRACKING_NUMBER,
    evidence: "The final answer reports the tracking number read from the linked order.",
  },
  ...Object.entries(driverEvidence).map(
    ([path, expected]): ValidatorAssertionSpecV1 => ({
      id: `${ID}.${path}`,
      source: "driver",
      operator: "equals",
      path,
      expected,
      evidence: `The extension driver directly observed ${path}.`,
    }),
  ),
];

const actions = [
  set("public.case.status", "complete"),
  set("public.case.value", TRACKING_NUMBER),
];
const oracle: OracleOutcomeV1 = {
  actions,
  finalAnswer: `The tracking number is ${TRACKING_NUMBER}.`,
  driverEvidence,
};

const base = {
  contract,
  control: {
    public: {
      applicationFamily: "durability",
      case: {
        title: "Support note for order NW-1048",
        status: "pending",
        value: null,
      },
      interaction: {
        mode: "state-and-answer",
        mutable: true,
        requiresValue: true,
        valueLabel: "Support note",
        control: "text",
        submitLabel: "Save support note",
        activeSection: "Sessions",
      },
      evidence: [
        { label: "Order", value: "NW-1048" },
        { label: "Support note", value: "Tracking number pending" },
      ],
      linkedResource: {
        href: "?view=linked-resource",
        label: "Open order NW-1048",
        title: "Order NW-1048",
        description: "Open this order record in a separate tab to read its shipping details.",
        evidence: [
          { label: "Order", value: "NW-1048" },
          { label: "Carrier", value: "Northwind Parcel" },
          { label: "Tracking number", value: TRACKING_NUMBER },
        ],
      },
      notice: null,
      unrelated: { changed: false },
    },
    control: {
      expected: TRACKING_NUMBER,
      mode: "state-and-answer",
      submissionKind: "value",
      acceptedValue: TRACKING_NUMBER,
    },
  } as JsonObject,
  validator: {
    id: contract.validatorId,
    version: 1,
    assertions,
    allowedMutationPaths: ["data.public.case.status", "data.public.case.value"],
  },
  oracle,
  nearMisses: [
    {
      id: "no-op",
      description: "The agent reports completion without saving the support note.",
      outcome: { actions: [], finalAnswer: oracle.finalAnswer, driverEvidence },
    },
    {
      id: "wrong-tracking-number",
      description: "The support note contains a value not grounded in the linked order.",
      outcome: {
        actions: [
          set("public.case.status", "complete"),
          set("public.case.value", "1Z-WRONG"),
        ],
        finalAnswer: "The tracking number is 1Z-WRONG.",
        driverEvidence,
      },
    },
    {
      id: "ungrouped-tab",
      description: "The linked record opens outside the active workspace group.",
      outcome: {
        ...oracle,
        driverEvidence: { ...driverEvidence, spawnedTabInWorkspaceGroup: false },
      },
    },
  ],
};

export const MODEL_BENCH_ACCEPTANCE_CASES: readonly EngineCaseDefinitionV1[] = [
  { ...base, contentHash: stableHash(contract as unknown as JsonObject) },
];
