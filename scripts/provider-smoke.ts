import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DEFAULT_LLM_MODEL_CONFIG } from "../apps/extension/src/config/model-config";

const KEY_ENV = "OPENROUTER_API_KEY";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = DEFAULT_LLM_MODEL_CONFIG.executor;

export async function smokeProvider(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ model: string; answer: string; promptTokens?: number; completionTokens?: number; costUsd?: number }> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`openrouter returned HTTP ${response.status}`);
  const result = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("openrouter returned an empty completion");
  }
  return {
    model: MODEL,
    answer: answer.trim(),
    ...(Number.isFinite(result.usage?.prompt_tokens) ? { promptTokens: result.usage!.prompt_tokens } : {}),
    ...(Number.isFinite(result.usage?.completion_tokens) ? { completionTokens: result.usage!.completion_tokens } : {}),
    ...(Number.isFinite(result.usage?.cost) ? { costUsd: result.usage!.cost } : {}),
  };
}

async function main(): Promise<void> {
  const key = process.env[KEY_ENV]?.trim();
  if (!key) {
    console.log(`SKIP openrouter: ${KEY_ENV} is unset`);
    return;
  }
  const result = await smokeProvider(key);
  console.log(`PASS openrouter/${result.model}: ${JSON.stringify(result.answer)}; prompt=${result.promptTokens ?? "unreported"}, completion=${result.completionTokens ?? "unreported"}, costUsd=${result.costUsd ?? "unreported"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[providers:smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
