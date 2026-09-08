import type {
  CloudPreferencesV1,
  CloudProviderId,
  RelayRequestV1,
} from "@opensidebar/shared-types";

export class ControlPolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_provider"
      | "revision_conflict"
      | "verification_failed"
      | "credential_missing"
      | "quota_exceeded"
      | "duplicate_request",
  ) {
    super(code);
  }
}

export const providerId = (value: unknown): CloudProviderId => {
  if (value !== "openrouter" && value !== "fireworks")
    throw new ControlPolicyError("invalid_provider");
  return value;
};
export const credentialValue = (value: unknown) => {
  if (typeof value !== "string")
    throw new ControlPolicyError("invalid_request");
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized) > 8192)
    throw new ControlPolicyError("invalid_request");
  return normalized;
};

const preferenceKeys = new Set([
  "schemaVersion",
  "revision",
  "inferenceMode",
  "providerMode",
  "executorModel",
  "plannerModel",
  "writerModel",
  "maxTurns",
  "theme",
  "showSessionMetrics",
  "showMessageDetailsByDefault",
  "laneTopologyMode",
  "enabledSkillPackIds",
  "disabledSkillIds",
  "useNitro",
  "temperature",
  "perceptionMode",
  "maxImagePromptTokenEstimate",
  "presenceMode",
  "presenceHideDuringCapture",
]);
const stringArray = (value: unknown, max: number) =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every(
    (item) => typeof item === "string" && item.length > 0 && item.length <= 128,
  );
export function parseCloudPreferences(value: unknown): CloudPreferencesV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ControlPolicyError("invalid_request");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !preferenceKeys.has(key)))
    throw new ControlPolicyError("invalid_request");
  if (
    raw.schemaVersion !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    Number(raw.revision) < 1 ||
    !(["local", "cloud"] as unknown[]).includes(raw.inferenceMode) ||
    !(["openrouter", "fireworks"] as unknown[]).includes(raw.providerMode) ||
    !Number.isInteger(raw.maxTurns) ||
    Number(raw.maxTurns) < 1 ||
    Number(raw.maxTurns) > 200 ||
    !(["light", "dark", "system"] as unknown[]).includes(raw.theme) ||
    typeof raw.showSessionMetrics !== "boolean"
  )
    throw new ControlPolicyError("invalid_request");
  for (const key of ["executorModel", "plannerModel", "writerModel"]) {
    if (
      raw[key] !== undefined &&
      (typeof raw[key] !== "string" || String(raw[key]).length > 256)
    )
      throw new ControlPolicyError("invalid_request");
  }
  if (
    raw.temperature !== undefined &&
    (typeof raw.temperature !== "number" ||
      raw.temperature < 0 ||
      raw.temperature > 2)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.maxImagePromptTokenEstimate !== undefined &&
    (!Number.isInteger(raw.maxImagePromptTokenEstimate) ||
      Number(raw.maxImagePromptTokenEstimate) < 0 ||
      Number(raw.maxImagePromptTokenEstimate) > 1_000_000)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.enabledSkillPackIds !== undefined &&
    !stringArray(raw.enabledSkillPackIds, 100)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.disabledSkillIds !== undefined &&
    !stringArray(raw.disabledSkillIds, 500)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.showMessageDetailsByDefault !== undefined &&
    typeof raw.showMessageDetailsByDefault !== "boolean"
  )
    throw new ControlPolicyError("invalid_request");
  if (raw.useNitro !== undefined && typeof raw.useNitro !== "boolean")
    throw new ControlPolicyError("invalid_request");
  if (
    raw.presenceHideDuringCapture !== undefined &&
    typeof raw.presenceHideDuringCapture !== "boolean"
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.laneTopologyMode !== undefined &&
    !["simple", "standard", "full"].includes(String(raw.laneTopologyMode))
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.perceptionMode !== undefined &&
    !["auto", "unified_vl", "structured"].includes(String(raw.perceptionMode))
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.presenceMode !== undefined &&
    !["off", "subtle", "cinematic"].includes(String(raw.presenceMode))
  )
    throw new ControlPolicyError("invalid_request");
  return structuredClone(raw) as unknown as CloudPreferencesV1;
}

const relayKeys = new Set([
  "schemaVersion",
  "requestId",
  "abortScopeId",
  "provider",
  "modelId",
  "seat",
  "messages",
  "tools",
  "temperature",
  "maxTokens",
  "stop",
  "responseFormat",
  "toolChoice",
]);
const messageKeys = new Set([
  "role",
  "content",
  "tool_calls",
  "tool_call_id",
  "name",
  "cache_control",
]);
const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).every((key) => allowed.includes(key));
const validToolCall = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>,
    fn = raw.function;
  if (
    !exactKeys(raw, ["id", "type", "function"]) ||
    typeof raw.id !== "string" ||
    raw.id.length > 256 ||
    raw.type !== "function" ||
    !fn ||
    typeof fn !== "object" ||
    Array.isArray(fn)
  )
    return false;
  const callable = fn as Record<string, unknown>;
  return (
    exactKeys(callable, ["name", "arguments"]) &&
    typeof callable.name === "string" &&
    callable.name.length <= 128 &&
    typeof callable.arguments === "string"
  );
};
const schemaTypes = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
]);
const validSchemaProperty = (value: unknown, depth = 0): boolean => {
  if (depth > 8 || !value || typeof value !== "object" || Array.isArray(value))
    return false;
  const raw = value as Record<string, unknown>;
  if (
    !exactKeys(raw, [
      "type",
      "description",
      "enum",
      "items",
      "default",
      "properties",
      "required",
    ]) ||
    !schemaTypes.has(String(raw.type)) ||
    typeof raw.description !== "string" ||
    raw.description.length > 8_192
  )
    return false;
  if (
    raw.enum !== undefined &&
    (!Array.isArray(raw.enum) ||
      raw.enum.length > 500 ||
      !raw.enum.every(
        (item) => typeof item === "string" || typeof item === "number",
      ))
  )
    return false;
  if (raw.items !== undefined && !validSchemaProperty(raw.items, depth + 1))
    return false;
  if (
    raw.properties !== undefined &&
    (!raw.properties ||
      typeof raw.properties !== "object" ||
      Array.isArray(raw.properties) ||
      Object.entries(raw.properties).length > 500 ||
      !Object.entries(raw.properties).every(
        ([key, item]) =>
          key.length <= 128 && validSchemaProperty(item, depth + 1),
      ))
  )
    return false;
  if (raw.required !== undefined && !stringArray(raw.required, 500))
    return false;
  return true;
};
const validTool = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>,
    fn = raw.function;
  if (
    !exactKeys(raw, ["type", "function"]) ||
    raw.type !== "function" ||
    !fn ||
    typeof fn !== "object" ||
    Array.isArray(fn)
  )
    return false;
  const callable = fn as Record<string, unknown>,
    parameters = callable.parameters;
  if (
    !exactKeys(callable, ["name", "description", "parameters"]) ||
    typeof callable.name !== "string" ||
    callable.name.length > 128 ||
    typeof callable.description !== "string" ||
    callable.description.length > 16_384 ||
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  )
    return false;
  const schema = parameters as Record<string, unknown>;
  return (
    exactKeys(schema, ["type", "properties", "required"]) &&
    schema.type === "object" &&
    !!schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties) &&
    Object.entries(schema.properties).length <= 500 &&
    Object.entries(schema.properties).every(
      ([key, item]) => key.length <= 128 && validSchemaProperty(item),
    ) &&
    stringArray(schema.required, 500)
  );
};
const validMessage = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) => !messageKeys.has(key)) ||
    !(["system", "user", "assistant", "tool"] as unknown[]).includes(raw.role)
  )
    return false;
  const content = raw.content;
  if (
    content !== null &&
    typeof content !== "string" &&
    !(
      Array.isArray(content) &&
      content.length <= 100 &&
      content.every((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part))
          return false;
        const item = part as Record<string, unknown>;
        return (
          (item.type === "text" &&
            Object.keys(item).every(
              (key) => key === "type" || key === "text",
            ) &&
            typeof item.text === "string") ||
          (item.type === "image_url" &&
            Object.keys(item).every(
              (key) => key === "type" || key === "image_url",
            ) &&
            !!item.image_url &&
            typeof item.image_url === "object" &&
            !Array.isArray(item.image_url) &&
            exactKeys(item.image_url as Record<string, unknown>, [
              "url",
              "detail",
            ]) &&
            typeof (item.image_url as Record<string, unknown>).url ===
              "string" &&
            ((item.image_url as Record<string, unknown>).detail === undefined ||
              ["low", "high", "auto"].includes(
                String((item.image_url as Record<string, unknown>).detail),
              )))
        );
      })
    )
  )
    return false;
  if (
    raw.tool_calls !== undefined &&
    (!Array.isArray(raw.tool_calls) ||
      raw.tool_calls.length > 200 ||
      !raw.tool_calls.every(validToolCall))
  )
    return false;
  if (raw.tool_call_id !== undefined && typeof raw.tool_call_id !== "string")
    return false;
  if (raw.name !== undefined && typeof raw.name !== "string") return false;
  if (
    raw.cache_control !== undefined &&
    (!raw.cache_control ||
      typeof raw.cache_control !== "object" ||
      Array.isArray(raw.cache_control) ||
      !exactKeys(raw.cache_control as Record<string, unknown>, ["type"]) ||
      (raw.cache_control as Record<string, unknown>).type !== "ephemeral")
  )
    return false;
  return true;
};
export function parseRelayRequest(
  value: unknown,
  rawBytes: number,
  modelAllowlist: ReadonlySet<string>,
): RelayRequestV1 {
  if (
    rawBytes < 2 ||
    rawBytes > 8 * 1024 * 1024 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new ControlPolicyError("invalid_request");
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) => !relayKeys.has(key)) ||
    raw.schemaVersion !== 1 ||
    typeof raw.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(raw.requestId) ||
    typeof raw.abortScopeId !== "string" ||
    raw.abortScopeId.length < 1 ||
    raw.abortScopeId.length > 128 ||
    !(["openrouter", "fireworks"] as unknown[]).includes(raw.provider) ||
    typeof raw.modelId !== "string" ||
    !modelAllowlist.has(raw.modelId) ||
    !(["executor", "planner", "writer", "judge"] as unknown[]).includes(
      raw.seat,
    ) ||
    !Array.isArray(raw.messages) ||
    raw.messages.length === 0 ||
    raw.messages.length > 500 ||
    !raw.messages.every(validMessage)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.tools !== undefined &&
    (!Array.isArray(raw.tools) ||
      raw.tools.length > 200 ||
      !raw.tools.every(validTool))
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.maxTokens !== undefined &&
    (!Number.isInteger(raw.maxTokens) ||
      Number(raw.maxTokens) < 1 ||
      Number(raw.maxTokens) > 200_000)
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.stop !== undefined &&
    (!Array.isArray(raw.stop) ||
      raw.stop.length > 16 ||
      !raw.stop.every(
        (item) => typeof item === "string" && item.length <= 1_024,
      ))
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.responseFormat !== undefined &&
    (!raw.responseFormat ||
      typeof raw.responseFormat !== "object" ||
      Array.isArray(raw.responseFormat) ||
      !exactKeys(raw.responseFormat as Record<string, unknown>, ["type"]) ||
      (raw.responseFormat as Record<string, unknown>).type !== "json_object")
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.toolChoice !== undefined &&
    !["auto", "required", "none"].includes(String(raw.toolChoice))
  )
    throw new ControlPolicyError("invalid_request");
  if (
    raw.temperature !== undefined &&
    (typeof raw.temperature !== "number" ||
      raw.temperature < 0 ||
      raw.temperature > 2)
  )
    throw new ControlPolicyError("invalid_request");
  return structuredClone(raw) as unknown as RelayRequestV1;
}
