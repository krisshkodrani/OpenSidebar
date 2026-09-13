import type { CloudProviderId, ProviderVerifier } from "./contracts.ts";

const PROVIDERS: Record<CloudProviderId, { modelsUrl: string; completionUrl: string }> = {
  openrouter: {
    modelsUrl: "https://openrouter.ai/api/v1/models",
    completionUrl: "https://openrouter.ai/api/v1/chat/completions",
  },
  fireworks: {
    modelsUrl: "https://api.fireworks.ai/inference/v1/models",
    completionUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
  },
};

export class LiveProviderVerifier implements ProviderVerifier {
  async verify(provider: CloudProviderId, credential: string): Promise<void> {
    const response = await fetch(PROVIDERS[provider].modelsUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("credential verification failed");
    await response.body?.cancel();
  }
}

export function providerCompletionUrl(provider: CloudProviderId): string {
  return PROVIDERS[provider].completionUrl;
}
