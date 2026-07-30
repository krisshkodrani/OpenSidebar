import type { DelegatedModelRole } from "@shared-types/browser-bridge";
import { ToolName, type UserSettings } from "../../types";
import type { LLMClientOptions } from "../llm/client";

/** Keep every orchestrator lane on one provider/model configuration contract. */
export function buildLlmModelOverrides(
  settings: UserSettings,
): LLMClientOptions {
  return {
    executorModel: settings.executorModel,
    plannerModel: settings.plannerModel,
    writerModel: settings.writerModel,
    useNitro: settings.useNitro,
    providerMode: settings.providerMode,
    provider: settings.provider,
    openaiApiKey: settings.openaiApiKey,
    groqApiKey: settings.groqApiKey,
    fireworksApiKey: settings.fireworksApiKey,
    deepseekApiKey: settings.deepseekApiKey,
    kimiApiKey: settings.kimiApiKey,
    xiaomiApiKey: settings.xiaomiApiKey,
    cerebrasApiKey: settings.cerebrasApiKey,
    temperature: settings.temperature,
  };
}

export function restrictDelegatedWriterModel(
  overrides: LLMClientOptions,
  roles: DelegatedModelRole[] | undefined,
): LLMClientOptions {
  return roles && !roles.includes("writer")
    ? { ...overrides, writerModel: undefined }
    : overrides;
}

export function restrictDelegatedWriterTool(
  disabledTools: ReadonlySet<ToolName>,
  roles: DelegatedModelRole[] | undefined,
): Set<ToolName> {
  const restricted = new Set(disabledTools);
  if (roles && !roles.includes("writer")) {
    restricted.add(ToolName.COMPOSE_TEXT);
  }
  return restricted;
}
