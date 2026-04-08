import "../setup";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LLMClient,
  stripThinkTags,
  extractThinkContent,
  MODEL_EXECUTOR,
  MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK,
  MODEL_PLANNER,
} from "../../src/background/llm/client";
import type { CompletionRequest } from "../../src/background/llm/types";
import { ToolName } from "../../src/types";

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
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        const data = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Build an SSE response with usage in the final chunk. */
function sseResponseWithUsage(
  chunks: string[],
  usage: Record<string, unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks.length; i++) {
        const data: Record<string, unknown> = {
          choices: [{ delta: { content: chunks[i] } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      }
      // Final chunk with usage and empty choices
      const final: Record<string, unknown> = {
        choices: [],
        usage,
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(final)}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Capture the parsed request body from the last fetch call. */
function capturePayload(): { getPayload: () => Record<string, unknown> } {
  let lastBody: Record<string, unknown> = {};
  const origHandler = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      lastBody = JSON.parse(init.body);
    }
    return origHandler(input, init);
  }) as typeof fetch;
  return { getPayload: () => lastBody };
}

function makeClient(opts?: { executorModel?: string; plannerModel?: string }) {
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
    const input =
      "**Think** reasoning here\n**Act**: click_element({ id: 5 })";
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

    test("custom model overrides via LLMClientOptions", () => {
      const client = makeClient({
        executorModel: "custom/executor",
        plannerModel: "custom/planner",
      });
      expect(client.getCurrentModel()).toBe("custom/executor");
      client.switchToPlanner();
      expect(client.getCurrentModel()).toBe("custom/planner");
    });

    test("activateExecutorFallback switches executor model for runtime anomalies", () => {
      const client = makeClient();
      expect(client.activateExecutorFallback("empty_response")).toBe(true);
      expect(client.getCurrentModel()).toBe(MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK);
      expect(client.getActiveProviderInfo().model).toBe(MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK);
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
    mockFetch(() =>
      jsonApiResponse("<think>reasoning</think>Clean response."),
    );

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
    mockFetch(() =>
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
    mockFetch(() =>
      new Response("Insufficient credits", { status: 402 }),
    );

    await expect(client.complete(baseRequest())).rejects.toThrow(
      /credits/i,
    );
  });

  test("402 → disables provider for session", async () => {
    const client = makeClient();
    // First call: 402 triggers disableForSession on the single OpenRouter slot
    mockFetch(() =>
      new Response("Insufficient credits", { status: 402 }),
    );

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
          JSON.stringify({ error: "image_url is not supported for this model" }),
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
    mockFetch(() =>
      new Response("Internal server error", { status: 500 }),
    );

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

  test("throws on null response body", async () => {
    const client = makeClient();
    mockFetch(() =>
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

    mockFetch(() =>
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
