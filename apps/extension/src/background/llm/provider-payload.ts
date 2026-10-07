import type { ProviderConfig } from "./types";

export function shapeProviderPayload(
  providerId: ProviderConfig["providerId"],
  payload: Record<string, unknown>,
  pin?: string,
): Record<string, unknown> {
  if (providerId === "openrouter" && pin?.trim()) {
    return {
      ...payload,
      provider: { order: [pin.trim()], allow_fallbacks: true },
    };
  }
  if (providerId !== "moonshot") return payload;
  const shaped = { ...payload };
  if (shaped.max_tokens !== undefined) {
    shaped.max_completion_tokens = shaped.max_tokens;
    delete shaped.max_tokens;
  }
  delete shaped.temperature;
  shaped.thinking = { type: "disabled" };
  return shaped;
}
