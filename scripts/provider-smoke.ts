import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DEFAULT_LLM_MODEL_CONFIG } from "../apps/extension/src/config/model-config";

export type SmokeProvider = "openrouter" | "fireworks";

const PROVIDERS: Record<SmokeProvider, { env: string; endpoint: string; model: string }> = {
  openrouter: {
    env: "OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: DEFAULT_LLM_MODEL_CONFIG.openrouter.executor,
  },
  fireworks: {
    env: "FIREWORKS_API_KEY",
    endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    model: DEFAULT_LLM_MODEL_CONFIG.fireworks.executor,
  },
};

export async function smokeProvider(
  provider: SmokeProvider,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ model: string; answer: string; promptTokens?: number; completionTokens?: number; costUsd?: number }> {
  const config = PROVIDERS[provider];
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}`);
  const result = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error(`${provider} returned an empty completion`);
  }
  return {
    model: config.model,
    answer: answer.trim(),
    ...(Number.isFinite(result.usage?.prompt_tokens) ? { promptTokens: result.usage!.prompt_tokens } : {}),
    ...(Number.isFinite(result.usage?.completion_tokens) ? { completionTokens: result.usage!.completion_tokens } : {}),
    ...(Number.isFinite(result.usage?.cost) ? { costUsd: result.usage!.cost } : {}),
  };
}

async function main(): Promise<void> {
  const choice = process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) ?? "all";
  if (choice !== "all" && choice !== "openrouter" && choice !== "fireworks") {
    throw new Error("--provider must be openrouter, fireworks, or all");
  }
  const providers: SmokeProvider[] = choice === "all" ? ["openrouter", "fireworks"] : [choice];
  for (const provider of providers) {
    const config = PROVIDERS[provider];
    const key = process.env[config.env]?.trim();
    if (!key) {
      console.log(`SKIP ${provider}: ${config.env} is unset`);
      continue;
    }
    const result = await smokeProvider(provider, key);
    console.log(`PASS ${provider}/${result.model}: ${JSON.stringify(result.answer)}; prompt=${result.promptTokens ?? "unreported"}, completion=${result.completionTokens ?? "unreported"}, costUsd=${result.costUsd ?? "unreported"}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[providers:smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
