import type { JudgeSeat } from "../agent/completion/judge";
import type { ProviderConfig } from "./types";
import { buildJsonHeaders } from "./provider-headers";
import { jevRubricRequest } from "./jev-decision";

/** Explicitly selected Decisions seat; never falls back to another model. */
export async function runJevJudge(
  provider: ProviderConfig,
  model: string,
  args: Parameters<JudgeSeat["runJudge"]>[0],
): ReturnType<JudgeSeat["runJudge"]> {
  if (
    provider.providerId !== "openrouter" ||
    !provider.apiKey ||
    provider.apiKey === "__opensidebar_cloud__"
  ) {
    throw new Error(
      "Jev requires a direct OpenRouter credential; cloud Decisions transport is not configured.",
    );
  }
  if (!args.rubric) throw new Error("Jev requires a typed outcome rubric.");
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: buildJsonHeaders(provider),
    body: JSON.stringify(jevRubricRequest(args.rubric, model)),
    signal: args.signal,
  });
  if (!response.ok) throw new Error(`Jev request failed (${response.status})`);
  const raw = await response.json();
  if (raw.error) throw new Error("Jev returned a provider error");
  const usage = raw.usage;
  const validTokens = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return {
    text: "",
    model: typeof raw.model === "string" ? raw.model : model,
    providerId: "openrouter",
    decision: raw,
    ...(validTokens(usage?.input_tokens) && validTokens(usage?.output_tokens)
      ? {
          usage: {
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
            ...(typeof usage.cost === "number" &&
            Number.isFinite(usage.cost) &&
            usage.cost >= 0
              ? { costUsd: usage.cost }
              : {}),
          },
        }
      : {}),
  };
}
