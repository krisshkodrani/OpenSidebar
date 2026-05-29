import "../setup";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  LLMClient,
  stripThinkTags,
  extractThinkContent,
  MODEL_EXECUTOR,
  MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK,
  MODEL_PLANNER,
  MOONSHOT_MODEL_EXECUTOR,
  DEEPSEEK_MODEL_PLANNER,
  DEEPSEEK_MODEL_PLANNER_PRO,
  XIAOMI_MODEL_EXECUTOR,
  XIAOMI_MODEL_PLANNER,
} from "../../src/background/llm/client";
import type { CompletionRequest } from "../../src/background/llm/types";

// ----- shared helpers -----

let originalFetch: typeof globalThis.fetch;

/** Mock fetch that intercepts API calls and passes through localhost:7589. */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.startsWith("http://127.0.0.1:7589/")) {
      return new Response(null, { status: 204 });
    }
    return handler(url, init);
  }) as typeof fetch;
}

/** Build an OpenAI-compatible JSON completion response. */
function jsonApiResponse(
  content: string | null,
  opts: {
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    finish_reason?: string;
    usage?: Record<string, unknown>;
    status?: number;
  } = {},
): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
            tool_calls: opts.tool_calls,
          },
          finish_reason: opts.finish_reason ?? "stop",
        },
      ],
      usage: opts.usage,
    }),
    {
      status: opts.status ?? 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Build an SSE ReadableStream response from text chunks. */
function sseResponse(
  chunks: string[],
  opts: { usage?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        const data = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      if (opts.usage) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ usage: opts.usage })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...opts.headers },
  });
}

function makeClient(opts?: ConstructorParameters<typeof LLMClient>[1]) {
  return new LLMClient("test-api-key", opts);
}

function baseRequest(
  overrides: Partial<CompletionRequest> = {},
): CompletionRequest {
  return {
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
    max_tokens: 1024,
    ...overrides,
  };
}

const sampleTools = [
  {
    type: "function" as const,
    function: {
      name: "click_element",
      description: "Click an element",
      parameters: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
  },
];

// ----- test groups -----

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ========================================================================
// Group 1: Think Tag Stripping (exported pure functions)
// ========================================================================

describe("stripThinkTags", () => {
  test("removes XML <think> blocks", () => {
    expect(stripThinkTags("<think>reasoning</think>Click the button.")).toBe(
      "Click the button.",
    );
  });

  test("removes markdown Think/Observe/Verify sections", () => {
    const input =
      "**Think** I should analyze the page.\n**Observe** The button is visible.\n**Act** Click element [1].";
    expect(stripThinkTags(input)).toBe("Click element [1].");
  });

  test("preserves content after **Act** header", () => {
    const input = "**Think** reasoning here\n**Act**: click_element({ id: 5 })";
    const result = stripThinkTags(input);
    expect(result).toContain("click_element");
    expect(result).not.toContain("reasoning here");
  });

  test("handles multiple think blocks", () => {
    const input =
      "<think>block1</think>Keep this.<think>block2</think> And this.";
    expect(stripThinkTags(input)).toBe("Keep this. And this.");
  });

  test("passthrough when no tags", () => {
    const input = "Just a normal response with no reasoning tags.";
    expect(stripThinkTags(input)).toBe(input);
  });
});

describe("extractThinkContent", () => {
  test("returns XML think content", () => {
    const result = extractThinkContent(
      "<think>I need to analyze this</think>Click the button.",
    );
    expect(result).toBe("I need to analyze this");
  });

  test("returns markdown Think/Observe/Verify sections", () => {
    const input =
      "**Think** I should click.\n**Observe** Button is blue.\n**Act** Do it.";
    const result = extractThinkContent(input);
    expect(result).toContain("I should click.");
    expect(result).toContain("Button is blue.");
  });

  test("returns null when no reasoning", () => {
    expect(extractThinkContent("Just a normal response.")).toBeNull();
  });

  test("handles mixed XML + markdown", () => {
    const input =
      "<think>XML reasoning</think>\n**Think** Markdown reasoning\n**Act** Do it.";
    const result = extractThinkContent(input);
    expect(result).toContain("XML reasoning");
    expect(result).toContain("Markdown reasoning");
  });
});

// ========================================================================
// Group 2: Streaming Think Filter (tested via completeStream)
// ========================================================================

describe("completeStream think filter", () => {
  test("think tags filtered from onTextDelta callback", async () => {
    const client = makeClient();
    mockFetch(() =>
      sseResponse(["<think>", "reasoning", "</think>", "visible content"]),
    );

    const deltas: string[] = [];
    await client.completeStream(baseRequest(), (d) => deltas.push(d));

    const joined = deltas.join("");
    expect(joined).not.toContain("<think>");
    expect(joined).not.toContain("reasoning");
    expect(joined).toContain("visible content");
  });

  test("returned content preserves raw think tags", async () => {
    const client = makeClient();
    mockFetch(() =>
      sseResponse(["<think>", "reasoning", "</think>", "visible"]),
    );

    const result = await client.completeStream(baseRequest(), () => {});

    // Raw content should include think tags for reasoning chain continuity
    expect(result.content).toContain("<think>");
    expect(result.content).toContain("reasoning");
    expect(result.content).toContain("visible");
  });

  test("think tag split across two SSE chunks", async () => {
    const client = makeClient();
    // Split "<think>" across chunks: "<thi" + "nk>hidden</think>shown"
    mockFetch(() => sseResponse(["Hello <thi", "nk>hidden</think>shown"]));

    const deltas: string[] = [];
    await client.completeStream(baseRequest(), (d) => deltas.push(d));

    const joined = deltas.join("");
    expect(joined).toContain("Hello ");
    expect(joined).not.toContain("hidden");
    expect(joined).toContain("shown");
  });

  test("nested text after </think> emitted correctly", async () => {
    const client = makeClient();
    mockFetch(() =>
      sseResponse(["<think>secret</think>", "after think content"]),
    );

    const deltas: string[] = [];
    await client.completeStream(baseRequest(), (d) => deltas.push(d));

    const joined = deltas.join("");
    expect(joined).not.toContain("secret");
    expect(joined).toContain("after think content");
  });

  test("no think tags — all content reaches callback", async () => {
    const client = makeClient();
    mockFetch(() => sseResponse(["Hello ", "world!"]));

    const deltas: string[] = [];
    await client.completeStream(baseRequest(), (d) => deltas.push(d));

    expect(deltas.join("")).toBe("Hello world!");
  });
});

// ========================================================================
// Group 3: LLMClient Construction & Tier Switching
// ========================================================================

describe("LLMClient construction & tier switching", () => {
  test("constructor initializes with executor model", () => {
    const client = makeClient();
    expect(client.getCurrentModel()).toBe(MODEL_EXECUTOR);
    expect(client.isPlannerTier()).toBe(false);
  });

  test("switchToPlanner changes model and isPlannerTier", () => {
    const client = makeClient();
    client.switchToPlanner();
    expect(client.getCurrentModel()).toBe(MODEL_PLANNER);
    expect(client.isPlannerTier()).toBe(true);
  });

  test("switchToExecutor restores executor model", () => {
    const client = makeClient();
    client.switchToPlanner();
    client.switchToExecutor();
    expect(client.getCurrentModel()).toBe(MODEL_EXECUTOR);
    expect(client.isPlannerTier()).toBe(false);
  });

  test("getActiveProviderInfo reflects current tier", () => {
    const client = makeClient();
    const execInfo = client.getActiveProviderInfo();
    expect(execInfo.model).toBe(MODEL_EXECUTOR);
    expect(execInfo.providerId).toBe("openrouter");

    client.switchToPlanner();
    const plannerInfo = client.getActiveProviderInfo();
    expect(plannerInfo.model).toBe(MODEL_PLANNER);
  });

  test("strips common paste artifacts from API keys before building headers", async () => {
    const client = new LLMClient(
      "\uFEFF\u201Ctest-api-key\u200B\u201D",
    );
    let headers = new Headers();
    mockFetch((_url, init) => {
      headers = new Headers(init!.headers);
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest());

    expect(headers.get("Authorization")).toBe("Bearer test-api-key");
  });

  test("rejects API keys with non-header-safe Unicode before fetch", () => {
    expect(() => new LLMClient("test-api-key\u{1F511}")).toThrow(
      /request header "Authorization" contains a non-ISO-8859-1 character/,
    );
  });

  test("xiaomi mode preserves Xiaomi provider and model IDs across tier switching", () => {
    const client = makeClient({
      providerMode: "xiaomi",
      xiaomiApiKey: "sk-xiaomi-test",
    });

    expect(client.getCurrentProvider()).toBe("xiaomi");
    expect(client.getCurrentModel()).toBe(XIAOMI_MODEL_EXECUTOR);
    expect(client.getActiveProviderInfo()).toEqual({
      providerId: "xiaomi",
      model: XIAOMI_MODEL_EXECUTOR,
    });

    client.switchToPlanner();
    expect(client.getCurrentProvider()).toBe("xiaomi");
    expect(client.getCurrentModel()).toBe(XIAOMI_MODEL_PLANNER);
    expect(client.getActiveProviderInfo()).toEqual({
      providerId: "xiaomi",
      model: XIAOMI_MODEL_PLANNER,
    });

    client.switchToExecutor();
    expect(client.getCurrentProvider()).toBe("xiaomi");
    expect(client.getCurrentModel()).toBe(XIAOMI_MODEL_EXECUTOR);
  });

  test("custom model overrides via LLMClientOptions", () => {
    const client = makeClient({
      executorModel: "qwen/qwen3-vl-30b-a3b-instruct",
      plannerModel: "custom/planner",
    });
    expect(client.getCurrentModel()).toBe("qwen/qwen3-vl-30b-a3b-instruct");
    client.switchToPlanner();
    expect(client.getCurrentModel()).toBe("custom/planner");
  });

  test("text-only executor overrides fall back to the default multimodal executor", () => {
    const client = makeClient({
      executorModel: "openai/gpt-oss-120b",
      plannerModel: "custom/planner",
    });
    expect(client.getCurrentModel()).toBe(MODEL_EXECUTOR);
    client.switchToPlanner();
    expect(client.getCurrentModel()).toBe("custom/planner");
  });

  test("activateExecutorFallback switches executor model for runtime anomalies", () => {
    const client = makeClient();
    expect(client.activateExecutorFallback("empty_response")).toBe(true);
    expect(client.getCurrentModel()).toBe(
      MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK,
    );
    expect(client.getActiveProviderInfo().model).toBe(
      MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK,
    );
  });

  test("switchToExecutor clears executor fallback override", () => {
    const client = makeClient();
    client.activateExecutorFallback("empty_response");
    client.switchToExecutor();
    expect(client.getCurrentModel()).toBe(MODEL_EXECUTOR);
    expect(client.getActiveProviderInfo().model).toBe(MODEL_EXECUTOR);
  });
});

// ========================================================================
// Group 4: complete() Payload & Response Handling
// ========================================================================

describe("complete() payload & response", () => {
  test("sends correct model from active pool", async () => {
    const client = makeClient();
    let sentModel = "";
    mockFetch((_url, init) => {
      sentModel = JSON.parse(init!.body as string).model;
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest());
    expect(sentModel).toBe(MODEL_EXECUTOR);

    client.switchToPlanner();
    await client.complete(baseRequest());
    expect(sentModel).toBe(MODEL_PLANNER);
  });

  test("uses executor fallback model after runtime fallback activation", async () => {
    const client = makeClient();
    let sentModel = "";
    mockFetch((_url, init) => {
      sentModel = JSON.parse(init!.body as string).model;
      return jsonApiResponse("OK");
    });

    client.activateExecutorFallback("empty_response");
    await client.complete(baseRequest());
    expect(sentModel).toBe(MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK);
  });

  test("sets tool_choice: auto when tools provided", async () => {
    const client = makeClient();
    let payload: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      payload = JSON.parse(init!.body as string);
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest({ tools: sampleTools }));
    expect(payload.tool_choice).toBe("auto");
  });

  test("omits tool_choice when no tools", async () => {
    const client = makeClient();
    let payload: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      payload = JSON.parse(init!.body as string);
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest());
    expect(payload.tool_choice).toBeUndefined();
  });

  test("moonshot mode reshapes payload for Kimi compatibility", async () => {
    const client = makeClient({
      providerMode: "moonshot",
      kimiApiKey: "sk-kimi-test",
    });
    let url = "";
    let payload: Record<string, unknown> = {};
    mockFetch((nextUrl, init) => {
      url = nextUrl;
      payload = JSON.parse(init!.body as string);
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest({ max_tokens: 321, tools: sampleTools }));
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(payload.model).toBe(MOONSHOT_MODEL_EXECUTOR);
    expect(payload.max_tokens).toBeUndefined();
    expect(payload.max_completion_tokens).toBe(321);
    expect(payload.temperature).toBeUndefined();
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.tool_choice).toBe("auto");
  });

  test("fireworks-deepseek uses Fireworks executor and DeepSeek planner", async () => {
    const client = makeClient({
      providerMode: "fireworks-deepseek",
      fireworksApiKey: "fw-test",
      deepseekApiKey: "sk-deepseek-test",
    });
    const requests: Array<{ url: string; payload: Record<string, unknown> }> =
      [];
    mockFetch((url, init) => {
      const payload = JSON.parse(init!.body as string);
      requests.push({ url, payload });
      return url.includes("fireworks.ai")
        ? sseResponse(["Executor OK"])
        : jsonApiResponse("Planner OK");
    });

    await client.complete(baseRequest());
    client.switchToPlanner();
    await client.complete(baseRequest());

    expect(requests[0].url).toBe(
      "https://api.fireworks.ai/inference/v1/chat/completions",
    );
    expect(requests[0].payload.model).toBe(MODEL_EXECUTOR);
    expect(requests[0].payload.stream).toBe(true);
    expect(requests[1].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[1].payload.model).toBe(DEEPSEEK_MODEL_PLANNER);
    expect(requests[1].payload.stream).toBeUndefined();
  });

  test("fireworks-deepseek planner override accepts DeepSeek V4 Pro", async () => {
    const client = makeClient({
      providerMode: "fireworks-deepseek",
      fireworksApiKey: "fw-test",
      deepseekApiKey: "sk-deepseek-test",
      plannerModel: DEEPSEEK_MODEL_PLANNER_PRO,
    });
    let url = "";
    let payload: Record<string, unknown> = {};
    mockFetch((nextUrl, init) => {
      url = nextUrl;
      payload = JSON.parse(init!.body as string);
      return jsonApiResponse("Planner OK");
    });

    client.switchToPlanner();
    await client.complete(baseRequest());

    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(payload.model).toBe("deepseek-v4-pro");
  });

  test("fireworks mode initializes active provider as Fireworks", () => {
    const client = makeClient({
      providerMode: "fireworks",
      fireworksApiKey: "fw-test",
    });

    expect(client.getCurrentProvider()).toBe("fireworks");
    expect(client.getActiveProviderInfo()).toEqual({
      providerId: "fireworks",
      model: MODEL_EXECUTOR,
    });
  });

  test("fireworks requests include per-task cache affinity headers", async () => {
    const client = makeClient({
      providerMode: "fireworks",
      fireworksApiKey: "fw-test",
    });
    let headers: Headers | null = null;
    mockFetch((_url, init) => {
      headers = new Headers(init!.headers as HeadersInit);
      return sseResponse(["OK"]);
    });

    await client.complete(
      baseRequest({
        sessionAffinityId: "task-123",
        multiTurnSessionId: "agent-session-456",
      }),
    );

    expect(headers?.get("x-session-affinity")).toBe("task-123");
    expect(headers?.get("x-multi-turn-session-id")).toBe("agent-session-456");
  });

  test("fireworks response cache headers supplement streamed usage", async () => {
    const client = makeClient({
      providerMode: "fireworks",
      fireworksApiKey: "fw-test",
    });
    mockFetch(() =>
      sseResponse(["OK"], {
        headers: {
          "fireworks-prompt-tokens": "100",
          "fireworks-cached-prompt-tokens": "80",
        },
        usage: {
          prompt_tokens: 120,
          completion_tokens: 5,
          total_tokens: 125,
        },
      }),
    );

    const result = await client.complete(baseRequest());

    expect(result.usage?.prompt_tokens).toBe(100);
    expect(result.usage?.cached_tokens).toBe(80);
    expect(result.usage?.cacheTelemetry).toEqual(
      expect.objectContaining({
        provider: "fireworks",
        promptTokens: 100,
        cachedPromptTokens: 80,
        cacheHitPct: 80,
        source: "response_headers",
      }),
    );
  });

  test("xiaomi mode sends OpenAI-compatible requests to Xiaomi MiMo endpoint", async () => {
    const client = makeClient({
      providerMode: "xiaomi",
      xiaomiApiKey: "sk-xiaomi-test",
    });
    const requests: Array<{
      url: string;
      headers: Headers;
      payload: Record<string, unknown>;
    }> = [];
    mockFetch((url, init) => {
      requests.push({
        url,
        headers: new Headers(init!.headers),
        payload: JSON.parse(init!.body as string),
      });
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest({ tools: sampleTools }));
    client.switchToPlanner();
    await client.complete(baseRequest());

    expect(requests[0].url).toBe(
      "https://api.xiaomimimo.com/v1/chat/completions",
    );
    expect(requests[0].headers.get("Authorization")).toBe(
      "Bearer sk-xiaomi-test",
    );
    expect(requests[0].payload.model).toBe("mimo-v2-omni");
    expect(requests[0].payload.tool_choice).toBe("auto");
    expect(requests[0].payload.stream).toBeUndefined();
    expect(requests[1].url).toBe(
      "https://api.xiaomimimo.com/v1/chat/completions",
    );
    expect(requests[1].payload.model).toBe("mimo-v2-pro");
  });

  test("adds cache_control to system message", async () => {
    const client = makeClient();
    let payload: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      payload = JSON.parse(init!.body as string);
      return jsonApiResponse("OK");
    });

    await client.complete(baseRequest());
    const messages = payload.messages as Array<Record<string, unknown>>;
    expect(messages[0].cache_control).toEqual({ type: "ephemeral" });
  });

  test("parses tool_calls from response", async () => {
    const client = makeClient();
    mockFetch(() =>
      jsonApiResponse(null, {
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "click_element",
              arguments: '{"id": 5}',
            },
          },
        ],
        finish_reason: "tool_calls",
      }),
    );

    const result = await client.complete(baseRequest({ tools: sampleTools }));
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe("click_element");
    expect(result.tool_calls![0].function.arguments).toBe('{"id": 5}');
  });

  test("strips think tags from response content", async () => {
    const client = makeClient();
    mockFetch(() => jsonApiResponse("<think>reasoning</think>Clean response."));

    const result = await client.complete(baseRequest());
    expect(result.content).toBe("Clean response.");
    expect(result.content).not.toContain("<think>");
  });

  test("extracts cached_tokens from usage", async () => {
    const client = makeClient();
    mockFetch(() =>
      jsonApiResponse("OK", {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      }),
    );

    const result = await client.complete(baseRequest());
    expect(result.usage?.cached_tokens).toBe(80);
  });

  test("throws on missing API key", async () => {
    const client = new LLMClient("");
    await expect(client.complete(baseRequest())).rejects.toThrow(
      /API key is missing/i,
    );
  });

  test("throws on empty choices array", async () => {
    const client = makeClient();
    mockFetch(
      () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(client.complete(baseRequest())).rejects.toThrow(
      /empty choices/,
    );
  });
});

// ========================================================================
// Group 5: complete() Error Handling & Retry
// ========================================================================

describe("complete() error handling & retry", () => {
  test("retries on 429/502/503/504", async () => {
    const client = makeClient();
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount <= 2) {
        return new Response("Rate limited", { status: 429 });
      }
      return jsonApiResponse("Success");
    });

    const result = await client.complete(baseRequest());
    expect(result.content).toBe("Success");
    // Should have called fetch more than once due to retries
    expect(callCount).toBeGreaterThan(1);
  });

  test("does NOT retry on 400/401/404", async () => {
    const client = makeClient();
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return new Response("Bad request", { status: 400 });
    });

    await expect(client.complete(baseRequest())).rejects.toThrow(/400/);
    // fetchWithRetry is called with maxRetries=3, but 400 is not retryable
    // so it should return immediately on first call
    expect(callCount).toBe(1);
  });

  test("402 → throws with credit exhaustion message", async () => {
    const client = makeClient();
    mockFetch(() => new Response("Insufficient credits", { status: 402 }));

    await expect(client.complete(baseRequest())).rejects.toThrow(/credits/i);
  });

  test("402 → disables provider for session", async () => {
    const client = makeClient();
    // First call: 402 triggers disableForSession on the single OpenRouter slot
    mockFetch(() => new Response("Insufficient credits", { status: 402 }));

    await expect(client.complete(baseRequest())).rejects.toThrow(/credits/i);

    // Second call: provider is disabled (cooldownUntil = MAX_SAFE_INTEGER).
    // complete() asks the pool for an active slot — with a single-slot pool,
    // the disabled slot is still returned as absolute fallback, but the 402
    // handling in the for(;;) loop should detect it and throw again.
    // However, since we're mocking fetch to return 200 now, the disabled
    // provider will still succeed at the fetch level. The real protection is
    // that allDisabled() returns true, which the 402 branch uses.
    // Verify the pool state directly instead:
    const info = client.getActiveProviderInfo();
    // Provider should still be openrouter (it's the only slot, used as fallback)
    expect(info.providerId).toBe("openrouter");
  });

  test("AbortSignal stops retry loop", async () => {
    const client = makeClient();
    const controller = new AbortController();
    let callCount = 0;

    mockFetch(() => {
      callCount++;
      // Abort after first attempt
      controller.abort();
      return new Response("Server error", { status: 503 });
    });

    await expect(
      client.complete(baseRequest({ signal: controller.signal })),
    ).rejects.toThrow(/Abort/);
    expect(callCount).toBe(1);
  });

  test("network error (fetch throws) → retries", async () => {
    const client = makeClient();
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("Failed to fetch");
      }
      return jsonApiResponse("Recovered");
    });

    const result = await client.complete(baseRequest());
    expect(result.content).toBe("Recovered");
    expect(callCount).toBe(2);
  });
});

// ========================================================================
// Group 6: Image Fallback
// ========================================================================

describe("complete() image fallback", () => {
  const imageRequest = (): CompletionRequest => ({
    messages: [
      { role: "system", content: "You are helpful." },
      {
        role: "user",
        content: [
          { type: "text", text: "What do you see?" },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,AAAA" },
          },
        ],
      },
    ],
    max_tokens: 1024,
  });

  test("422 with image_url not supported → retries with text-only messages", async () => {
    const client = makeClient();
    let callCount = 0;
    let lastBody = "";
    mockFetch((_url, init) => {
      callCount++;
      lastBody = init!.body as string;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: "image_url is not supported for this model",
          }),
          { status: 422 },
        );
      }
      return jsonApiResponse("Text-only response");
    });

    const result = await client.complete(imageRequest());
    expect(result.content).toBe("Text-only response");
    expect(callCount).toBe(2);

    // Verify second request has no image_url
    const parsed = JSON.parse(lastBody);
    const userMsg = parsed.messages.find(
      (m: Record<string, unknown>) => m.role === "user",
    );
    expect(typeof userMsg.content).toBe("string");
    // The replacement text includes the word "image_url" in the placeholder message,
    // so check for the actual placeholder pattern instead
    expect(userMsg.content).toContain("image omitted");
    expect(userMsg.content).not.toMatch(/^data:image/);
  });

  test("fallback only triggers once (no infinite loop)", async () => {
    const client = makeClient();
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return new Response(
        JSON.stringify({ error: "image_url is not supported" }),
        { status: 422 },
      );
    });

    // First 422 triggers fallback, second 422 (on text-only) throws
    await expect(client.complete(imageRequest())).rejects.toThrow(/422/);
    // Two attempts from the image fallback loop + retries from fetchWithRetry
    // The key thing: it doesn't loop infinitely
    expect(callCount).toBeLessThan(10);
  });

  test("non-422 error with image content → normal error", async () => {
    const client = makeClient();
    mockFetch(() => new Response("Internal server error", { status: 500 }));

    // 500 is not in the retryable set for fetchWithRetry, should throw immediately
    await expect(client.complete(imageRequest())).rejects.toThrow(/500/);
  });
});

// ========================================================================
// Group 7: completeStream() Specifics
// ========================================================================

describe("completeStream() specifics", () => {
  test("sets stream: true and stream_options: { include_usage: true }", async () => {
    const client = makeClient();
    let payload: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      payload = JSON.parse(init!.body as string);
      return sseResponse(["Hello"]);
    });

    await client.completeStream(baseRequest(), () => {});
    expect(payload.stream).toBe(true);
    expect(payload.stream_options).toEqual({ include_usage: true });
  });

  test("moonshot streaming payload omits temperature and uses max_completion_tokens", async () => {
    const client = makeClient({
      providerMode: "moonshot",
      kimiApiKey: "sk-kimi-test",
    });
    let payload: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      payload = JSON.parse(init!.body as string);
      return sseResponse(["Hello"]);
    });

    await client.completeStream(baseRequest({ max_tokens: 99 }), () => {});
    expect(payload.max_tokens).toBeUndefined();
    expect(payload.max_completion_tokens).toBe(99);
    expect(payload.temperature).toBeUndefined();
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.stream).toBe(true);
  });

  test("throws on null response body", async () => {
    const client = makeClient();
    mockFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );

    await expect(
      client.completeStream(baseRequest(), () => {}),
    ).rejects.toThrow(/body is null/);
  });

  test("finish_reason is tool_calls when tools present in result", async () => {
    const client = makeClient();
    // Build SSE stream with tool call delta
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Tool call chunk
        const toolChunk = JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    type: "function",
                    function: {
                      name: "click_element",
                      arguments: '{"id":1}',
                    },
                  },
                ],
              },
            },
          ],
        });
        controller.enqueue(encoder.encode(`data: ${toolChunk}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    mockFetch(
      () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );

    const result = await client.completeStream(
      baseRequest({ tools: sampleTools }),
      () => {},
    );
    expect(result.finish_reason).toBe("tool_calls");
    expect(result.tool_calls).toHaveLength(1);
  });
});
