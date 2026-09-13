export interface ProviderRoutingOptions {
  executorProviderPin?: string;
  plannerProviderPin?: string;
  judgeProviderPin?: string;
  /** Disable cross-model/provider recovery and require pinned OpenRouter routes. */
  strictModelRouting?: boolean;
}

export function providerRoutingOptions(options?: ProviderRoutingOptions): ProviderRoutingOptions {
  return {
    executorProviderPin: options?.executorProviderPin,
    plannerProviderPin: options?.plannerProviderPin,
    judgeProviderPin: options?.judgeProviderPin,
    strictModelRouting: options?.strictModelRouting,
  };
}

export function providerPinsForOptions(options?: ProviderRoutingOptions & { writerModel?: string }) {
  return {
    executor: options?.executorProviderPin,
    planner: options?.plannerProviderPin,
    judge: options?.judgeProviderPin,
    writer: options?.writerModel ? undefined : options?.executorProviderPin,
  };
}

export function applyOpenRouterRouting(
  payload: Record<string, unknown>,
  pin: string | undefined,
  strict: boolean,
): Record<string, unknown> {
  if (strict && !pin?.trim()) {
    throw new Error("Strict model routing requires an OpenRouter provider pin for the active seat.");
  }
  if (pin?.trim()) {
    payload.provider = strict
      ? { only: [pin.trim()], allow_fallbacks: false }
      : { order: [pin.trim()], allow_fallbacks: true };
  }
  return payload;
}
