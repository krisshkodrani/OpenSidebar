import type {
  PerceptionBenchmarkCaseV1,
  PerceptionDirectModelResultV1,
  PerceptionImageArtifactV1,
  RequestedSeatV1,
} from "@opensidebar/scenario-contracts";
import { perceptionAnswerMatches } from "@opensidebar/scenario-engine";
import { perceptionImageDataUrl } from "./modelbench-image-artifacts.js";

type FetchLike = typeof fetch;

interface CompletionResponse {
  model?: unknown;
  provider?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    cached_tokens?: unknown;
    cost?: unknown;
  };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function endpoint(provider: string): string {
  if (provider === "openrouter") {
    return "https://openrouter.ai/api/v1/chat/completions";
  }
  if (provider === "fireworks") {
    return "https://api.fireworks.ai/inference/v1/chat/completions";
  }
  throw new Error(
    `Perception direct lane does not support provider '${provider}'.`,
  );
}

export function perceptionProviderApiKey(
  provider: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return provider === "openrouter"
    ? environment.OPENROUTER_API_KEY
    : provider === "fireworks"
      ? environment.FIREWORKS_API_KEY
      : undefined;
}

function directAnswer(json: CompletionResponse): {
  answer: string | null;
  evidence: string | null;
} {
  const message = json.choices?.[0]?.message;
  const call = message?.tool_calls?.find(
    (candidate) => candidate.function?.name === "report_visual_answer",
  );
  const raw = call?.function?.arguments;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as {
        answer?: unknown;
        evidence?: unknown;
      };
      return {
        answer: typeof parsed.answer === "string" ? parsed.answer.trim() : null,
        evidence:
          typeof parsed.evidence === "string" ? parsed.evidence.trim() : null,
      };
    } catch {
      return { answer: null, evidence: null };
    }
  }
  return {
    answer:
      typeof message?.content === "string" ? message.content.trim() : null,
    evidence: null,
  };
}

export async function runDirectPerceptionProbe(input: {
  case: PerceptionBenchmarkCaseV1;
  image: PerceptionImageArtifactV1;
  requested: RequestedSeatV1;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<PerceptionDirectModelResultV1> {
  const startedAt = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  let imageUrl: string;
  try {
    imageUrl = perceptionImageDataUrl(input.image);
  } catch (error) {
    return {
      requested: input.requested,
      imageSha256: input.image.sha256,
      passed: false,
      answer: null,
      evidence: null,
      durationMs: Date.now() - startedAt,
      failure: {
        kind: "delivery",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 120_000,
  );
  try {
    const response = await fetchImpl(endpoint(input.requested.provider), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.requested.model,
        temperature: 0,
        max_tokens: 512,
        ...(input.requested.provider === "openrouter" &&
        input.requested.providerPin
          ? {
              provider: {
                order: [input.requested.providerPin],
                allow_fallbacks: false,
              },
            }
          : {}),
        messages: [
          {
            role: "system",
            content:
              "Read only the supplied screenshot. Extract the requested visible fact and identify its visual evidence region. Do not infer from outside knowledge.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: input.case.prompt },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  ...(input.image.detail !== "unknown"
                    ? { detail: input.image.detail }
                    : {}),
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_visual_answer",
              description: "Report the visible answer and where it appears.",
              parameters: {
                type: "object",
                properties: {
                  answer: { type: "string" },
                  evidence: { type: "string" },
                },
                required: ["answer", "evidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "report_visual_answer" },
        },
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        requested: input.requested,
        imageSha256: input.image.sha256,
        passed: false,
        answer: null,
        evidence: null,
        durationMs: Date.now() - startedAt,
        failure: {
          kind: "provider",
          reason: `HTTP ${response.status}: ${raw.slice(0, 300)}`,
        },
      };
    }
    const json = raw ? (JSON.parse(raw) as CompletionResponse) : {};
    const extracted = directAnswer(json);
    const usage = json.usage;
    return {
      requested: input.requested,
      resolved: {
        ...input.requested,
        resolvedProvider:
          typeof json.provider === "string"
            ? json.provider
            : (input.requested.providerPin ?? input.requested.provider),
        resolvedModel:
          typeof json.model === "string" ? json.model : input.requested.model,
      },
      imageSha256: input.image.sha256,
      passed: perceptionAnswerMatches(extracted.answer, input.case.expected),
      answer: extracted.answer,
      evidence: extracted.evidence,
      durationMs: Date.now() - startedAt,
      ...(usage
        ? {
            usage: {
              calls: 1,
              promptTokens: numeric(usage.prompt_tokens),
              completionTokens: numeric(usage.completion_tokens),
              cachedTokens: numeric(usage.cached_tokens),
              costUsd: numeric(usage.cost),
              llmTimeMs: Date.now() - startedAt,
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      requested: input.requested,
      imageSha256: input.image.sha256,
      passed: false,
      answer: null,
      evidence: null,
      durationMs: Date.now() - startedAt,
      failure: {
        kind: "provider",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
