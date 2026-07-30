/**
 * Closed fleet-telemetry contract (RFC LP-25, Phase 1).
 *
 * This wire shape is intentionally separate from TraceEntry/ObsSpan. It has no
 * generic attributes, free-text diagnostics, URLs, timestamps, or blob refs.
 * Every string is either a bounded identifier with a strict pattern or a value
 * from a reviewed enum.
 */

export const FLEET_TELEMETRY_SCHEMA_VERSION = 1 as const;

export const FLEET_EXTENSION_CHANNELS = ["stable", "beta", "dev"] as const;
export type FleetExtensionChannel = (typeof FLEET_EXTENSION_CHANNELS)[number];

export const FLEET_OS_FAMILIES = [
  "windows",
  "macos",
  "linux",
  "chromeos",
  "other",
] as const;
export type FleetOsFamily = (typeof FLEET_OS_FAMILIES)[number];

export const FLEET_PROVIDER_IDS = [
  "openrouter",
  "openai",
  "groq",
  "fireworks",
  "moonshot",
  "deepseek",
  "xiaomi",
  "cerebras",
  "other",
] as const;
export type FleetProviderId = (typeof FLEET_PROVIDER_IDS)[number];

/**
 * Provider-specific model IDs are projected into these stable families. Raw
 * custom model strings and endpoints must never enter the envelope.
 */
export const FLEET_MODEL_IDS = [
  "minimax_m3",
  "kimi_k2_7_code",
  "kimi_k2_6",
  "kimi_k2_5",
  "glm_5_2",
  "gpt_oss_120b",
  "mimo_v2",
  "deepseek_v4",
  "qwen_3_7",
  "qwen_3_vl",
  "grok_4_5",
  "gemma_4_31b",
  "other",
] as const;
export type FleetModelId = (typeof FLEET_MODEL_IDS)[number];

export const FLEET_TASK_SHAPES = [
  "single_interaction",
  "navigation",
  "read",
  "form",
  "multi_tab",
  "download",
  "browser_management",
  "mixed",
  "unknown",
] as const;
export type FleetTaskShape = (typeof FLEET_TASK_SHAPES)[number];

export const FLEET_DURATION_BUCKETS = [
  "under_1s",
  "1s_to_5s",
  "5s_to_15s",
  "15s_to_60s",
  "1m_to_5m",
  "over_5m",
] as const;
export type FleetDurationBucket = (typeof FLEET_DURATION_BUCKETS)[number];

export const FLEET_TOOL_NAMES = [
  "click",
  "type",
  "read",
  "navigate",
  "scroll",
  "tab",
  "form",
  "download",
  "browser_management",
  "done",
  "other",
] as const;
export type FleetToolName = (typeof FLEET_TOOL_NAMES)[number];

export const FLEET_COMPLETION_REASONS = [
  "missing_evidence",
  "task_contract",
  "workflow_contract",
  "read_not_grounded",
  "plan_incomplete",
  "duplicate_terminal",
  "kernel_reject",
  "other",
] as const;
export type FleetCompletionReason = (typeof FLEET_COMPLETION_REASONS)[number];

export const FLEET_EVIDENCE_TYPES = [
  "navigation_committed",
  "target_state_observed",
  "media_state_changed",
  "form_state_observed",
  "download_observed",
  "page_confirmation_observed",
  "none",
] as const;
export type FleetEvidenceType = (typeof FLEET_EVIDENCE_TYPES)[number];

export const FLEET_COMPLETION_SOURCES = [
  "model_done",
  "trusted_tool",
  "none",
] as const;
export type FleetCompletionSource = (typeof FLEET_COMPLETION_SOURCES)[number];

export const FLEET_OUTCOMES = [
  "completed",
  "stopped",
  "guardrail_stopped",
  "failed",
  "paused",
  "abandoned",
] as const;
export type FleetOutcome = (typeof FLEET_OUTCOMES)[number];

export const FLEET_TERMINAL_REASONS = [
  "completion_accepted",
  "user_stopped",
  "max_turns",
  "stuck_guardrail",
  "give_up_guardrail",
  "error",
  "awaiting_user",
  "worker_abandoned",
  "unknown",
] as const;
export type FleetTerminalReason = (typeof FLEET_TERMINAL_REASONS)[number];

export const FLEET_ERROR_CODES = [
  "provider_error",
  "tool_error",
  "navigation_error",
  "completion_error",
  "guardrail_exhausted",
  "user_abort",
  "worker_abandoned",
  "unknown",
] as const;
export type FleetErrorCode = (typeof FLEET_ERROR_CODES)[number];

export interface FleetToolCount {
  attempted: number;
  failed: number;
}

export interface FleetTelemetryEnvelopeV1 {
  schemaVersion: typeof FLEET_TELEMETRY_SCHEMA_VERSION;
  /** Random UUID for this summary only. Never reused across sessions. */
  eventId: string;
  extension: {
    version: string;
    channel: FleetExtensionChannel;
  };
  environment: {
    browserMajor: number;
    osFamily: FleetOsFamily;
  };
  runtime: {
    provider: FleetProviderId;
    executorModel: FleetModelId;
    plannerModel: FleetModelId;
    judgeModel: FleetModelId;
    taskShape: FleetTaskShape;
  };
  execution: {
    plannerStepCount: number;
    turnCount: number;
    durationBucket: FleetDurationBucket;
    toolCounts: Partial<Record<FleetToolName, FleetToolCount>>;
  };
  completion: {
    doneCallCount: number;
    firstDoneCandidateTurn?: number;
    acceptedDoneTurn?: number;
    acceptedSource: FleetCompletionSource;
    rejectedDoneCount: number;
    rejectionReasons: FleetCompletionReason[];
    evidenceTypes: FleetEvidenceType[];
    firstSatisfiedEvidenceTurn?: number;
    turnsAfterFirstSatisfiedEvidence?: number;
  };
  result: {
    outcome: FleetOutcome;
    terminalReason: FleetTerminalReason;
    errorCodes: FleetErrorCode[];
  };
}

type FleetStringSchema = {
  readonly type: "string";
  readonly enum?: readonly string[];
  readonly pattern?: string;
  readonly maxLength?: number;
};

type FleetIntegerSchema = {
  readonly type: "integer";
  readonly const?: number;
  readonly minimum?: number;
  readonly maximum?: number;
};

type FleetArraySchema = {
  readonly type: "array";
  readonly items: FleetSchemaNode;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
};

type FleetObjectSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, FleetSchemaNode>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly maxProperties?: number;
};

type FleetSchemaNode =
  | FleetStringSchema
  | FleetIntegerSchema
  | FleetArraySchema
  | FleetObjectSchema;

const enumString = (values: readonly string[]): FleetStringSchema => ({
  type: "string",
  enum: values,
});

const boundedInteger = (maximum: number): FleetIntegerSchema => ({
  type: "integer",
  minimum: 0,
  maximum,
});

const toolCountSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    attempted: boundedInteger(1_000),
    failed: boundedInteger(1_000),
  },
  required: ["attempted", "failed"],
  additionalProperties: false,
};

const toolCountsSchema: FleetObjectSchema = {
  type: "object",
  properties: Object.fromEntries(
    FLEET_TOOL_NAMES.map((name) => [name, toolCountSchema]),
  ),
  required: [],
  additionalProperties: false,
  maxProperties: FLEET_TOOL_NAMES.length,
};

const extensionSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    version: {
      type: "string",
      pattern: "^\\d+(?:\\.\\d+){1,3}$",
      maxLength: 32,
    },
    channel: enumString(FLEET_EXTENSION_CHANNELS),
  },
  required: ["version", "channel"],
  additionalProperties: false,
};

const environmentSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    browserMajor: {
      type: "integer",
      minimum: 1,
      maximum: 999,
    },
    osFamily: enumString(FLEET_OS_FAMILIES),
  },
  required: ["browserMajor", "osFamily"],
  additionalProperties: false,
};

const runtimeSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    provider: enumString(FLEET_PROVIDER_IDS),
    executorModel: enumString(FLEET_MODEL_IDS),
    plannerModel: enumString(FLEET_MODEL_IDS),
    judgeModel: enumString(FLEET_MODEL_IDS),
    taskShape: enumString(FLEET_TASK_SHAPES),
  },
  required: [
    "provider",
    "executorModel",
    "plannerModel",
    "judgeModel",
    "taskShape",
  ],
  additionalProperties: false,
};

const executionSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    plannerStepCount: boundedInteger(200),
    turnCount: boundedInteger(500),
    durationBucket: enumString(FLEET_DURATION_BUCKETS),
    toolCounts: toolCountsSchema,
  },
  required: ["plannerStepCount", "turnCount", "durationBucket", "toolCounts"],
  additionalProperties: false,
};

const completionSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    doneCallCount: boundedInteger(500),
    firstDoneCandidateTurn: boundedInteger(500),
    acceptedDoneTurn: boundedInteger(500),
    acceptedSource: enumString(FLEET_COMPLETION_SOURCES),
    rejectedDoneCount: boundedInteger(500),
    rejectionReasons: {
      type: "array",
      items: enumString(FLEET_COMPLETION_REASONS),
      maxItems: FLEET_COMPLETION_REASONS.length,
      uniqueItems: true,
    },
    evidenceTypes: {
      type: "array",
      items: enumString(FLEET_EVIDENCE_TYPES),
      maxItems: FLEET_EVIDENCE_TYPES.length,
      uniqueItems: true,
    },
    firstSatisfiedEvidenceTurn: boundedInteger(500),
    turnsAfterFirstSatisfiedEvidence: boundedInteger(500),
  },
  required: [
    "doneCallCount",
    "acceptedSource",
    "rejectedDoneCount",
    "rejectionReasons",
    "evidenceTypes",
  ],
  additionalProperties: false,
};

const resultSchema: FleetObjectSchema = {
  type: "object",
  properties: {
    outcome: enumString(FLEET_OUTCOMES),
    terminalReason: enumString(FLEET_TERMINAL_REASONS),
    errorCodes: {
      type: "array",
      items: enumString(FLEET_ERROR_CODES),
      maxItems: FLEET_ERROR_CODES.length,
      uniqueItems: true,
    },
  },
  required: ["outcome", "terminalReason", "errorCodes"],
  additionalProperties: false,
};

/**
 * JSON Schema subset shared by the extension and the future ingest Lambda.
 * The Phase 3 backend may compile this with Ajv; Phase 1 uses the dependency-free
 * validator below so the schema package remains browser-safe.
 */
export const FLEET_TELEMETRY_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://opensidebar.dev/schemas/fleet-telemetry-v1.json",
  type: "object",
  properties: {
    schemaVersion: {
      type: "integer",
      const: FLEET_TELEMETRY_SCHEMA_VERSION,
    },
    eventId: {
      type: "string",
      pattern:
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      maxLength: 36,
    },
    extension: extensionSchema,
    environment: environmentSchema,
    runtime: runtimeSchema,
    execution: executionSchema,
    completion: completionSchema,
    result: resultSchema,
  },
  required: [
    "schemaVersion",
    "eventId",
    "extension",
    "environment",
    "runtime",
    "execution",
    "completion",
    "result",
  ],
  additionalProperties: false,
} as const satisfies FleetObjectSchema & {
  readonly $schema: string;
  readonly $id: string;
};

export type FleetTelemetryValidationResult =
  | { valid: true; errors: readonly [] }
  | { valid: false; errors: readonly string[] };

/**
 * Validate unknown JSON against the exported schema subset. This is not a
 * general JSON-Schema implementation; it deliberately supports only the closed
 * constructs used above.
 */
export function validateFleetTelemetryEnvelope(
  value: unknown,
): FleetTelemetryValidationResult {
  const errors: string[] = [];
  validateNode(value, FLEET_TELEMETRY_JSON_SCHEMA, "$", errors);
  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
}

export function isFleetTelemetryEnvelopeV1(
  value: unknown,
): value is FleetTelemetryEnvelopeV1 {
  return validateFleetTelemetryEnvelope(value).valid;
}

function validateNode(
  value: unknown,
  schema: FleetSchemaNode,
  path: string,
  errors: string[],
): void {
  if (schema.type === "object") {
    validateObject(value, schema, path, errors);
    return;
  }
  if (schema.type === "array") {
    validateArray(value, schema, path, errors);
    return;
  }
  if (schema.type === "integer") {
    validateInteger(value, schema, path, errors);
    return;
  }
  validateString(value, schema, path, errors);
}

function validateObject(
  value: unknown,
  schema: FleetObjectSchema,
  path: string,
  errors: string[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    schema.maxProperties !== undefined &&
    keys.length > schema.maxProperties
  ) {
    errors.push(`${path} must have at most ${schema.maxProperties} properties`);
  }

  for (const key of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  for (const key of keys) {
    const childSchema = schema.properties[key];
    if (!childSchema) {
      errors.push(`${path}.${key} is not allowed`);
      continue;
    }
    validateNode(record[key], childSchema, `${path}.${key}`, errors);
  }
}

function validateArray(
  value: unknown,
  schema: FleetArraySchema,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push(`${path} must have at most ${schema.maxItems} items`);
  }
  if (schema.uniqueItems) {
    const unique = new Set(value.map((item) => JSON.stringify(item)));
    if (unique.size !== value.length) {
      errors.push(`${path} must contain unique items`);
    }
  }
  value.forEach((item, index) => {
    validateNode(item, schema.items, `${path}[${index}]`, errors);
  });
}

function validateInteger(
  value: unknown,
  schema: FleetIntegerSchema,
  path: string,
  errors: string[],
): void {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
    return;
  }
  const integer = value as number;
  if (schema.const !== undefined && integer !== schema.const) {
    errors.push(`${path} must equal ${schema.const}`);
  }
  if (schema.minimum !== undefined && integer < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && integer > schema.maximum) {
    errors.push(`${path} must be <= ${schema.maximum}`);
  }
}

function validateString(
  value: unknown,
  schema: FleetStringSchema,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return;
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${path} must have at most ${schema.maxLength} characters`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be an allowed value`);
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path} has an invalid format`);
  }
}
