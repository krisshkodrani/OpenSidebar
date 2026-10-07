import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { LLMClient } from "../../src/background/llm/client";
import {
  OpenRouterQualityRouter,
  rankEligibleEndpoints,
} from "../../src/background/llm/openrouter-quality-routing";

const endpoint = (
  tag = "fast/fp8",
  tps = 90,
  latency = 1,
  output = "0.0000006",
) => ({
  tag,
  status: 0,
  pricing: { completion: output },
  throughput_last_30m: { p50: tps },
  latency_last_30m: { p50: latency * 1_000 },
});
const metadata = (
  endpoints: Parameters<typeof rankEligibleEndpoints>[0] = [endpoint()],
) => new Response(JSON.stringify({ data: { endpoints } }));
const completion = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
    }),
  );
const request = {
  messages: [{ role: "user" as const, content: "Do this task" }],
};
const init = (model = "deepseek/deepseek-v4.1-flash:nitro") => ({
  headers: { Authorization: "Bearer test-key" },
  body: JSON.stringify({ model }),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("strict OpenRouter planner quality routing", () => {
  test("explicit Sol planner uses bounded standard routes and high reasoning without relaxing other models", async () => {
    const sol = { ...endpoint("azure", 0, 0, "0.00001"), pricing: { prompt: "0.000002", completion: "0.00001" }, throughput_last_30m: null, latency_last_30m: null };
    const endpoints = [sol, { ...sol, tag: "openai/flex" }, { ...sol, tag: "offline", status: 1 }, { ...sol, tag: "unknown", pricing: {} }];
    expect(rankEligibleEndpoints(endpoints)).toEqual([]);
    expect(rankEligibleEndpoints(endpoints, "openai/gpt-6.1-sol").map(e => e.tag)).toEqual(["azure"]);
    vi.stubGlobal("fetch", vi.fn(async () => metadata(endpoints)));
    const prepared = await new OpenRouterQualityRouter().prepare({ ...init("openai/gpt-6.1-sol"), body: JSON.stringify({ model: "openai/gpt-6.1-sol", temperature: 0 }) });
    const body = JSON.parse(String(prepared.body));
    expect(body).toMatchObject({ model: "openai/gpt-6.1-sol", reasoning: { effort: "high" }, provider: { only: ["azure"], allow_fallbacks: false, max_price: { prompt: 5, completion: 15 } } });
    expect(body).not.toHaveProperty("temperature");
  });

  test("excludes unknown, unavailable, over-price and boundary performance; ranks eligible endpoints", () => {
    expect(
      rankEligibleEndpoints([
        endpoint("slow", 50),
        endpoint("late", 100, 2),
        endpoint("pricey", 100, 1, "0.00000101"),
        { ...endpoint("unknown"), throughput_last_30m: null },
        { ...endpoint("offline"), status: 1 },
        { ...endpoint("nan"), pricing: { completion: "" } },
        endpoint("a", 80, 1.5),
        endpoint("b", 100, 1.2),
        endpoint("c", 100, 1),
        endpoint("d", 100, 1, "0.0000004"),
        endpoint("at-cap", 60, 1, "0.000001"),
      ]).map((item) => item.tag),
    ).toEqual(["d", "c", "b", "a", "at-cap"]);
  });

  test("base slugs and duplicate tags cannot admit ineligible variants", () => {
    expect(
      rankEligibleEndpoints([
        endpoint("host"),
        endpoint("host/fp4", 10),
        endpoint("other/fp8"),
        endpoint("other/fp8", 50),
        endpoint("exact/fp8"),
        endpoint("exact/fp4", 10),
      ]).map((item) => item.tag),
    ).toEqual(["exact/fp8"]);
  });

  test("fails closed before paid requests when metrics are missing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      metadata([{ ...endpoint(), latency_last_30m: null }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new LLMClient("test-key");
    client.switchToPlanner();
    await expect(client.complete(request)).rejects.toThrow(
      "no verified provider",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/endpoints");
  });

  test.each([false, true])(
    "gates normal and streaming completion (stream=%s), with eligible-only fallback",
    async (stream) => {
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          if (String(url).endsWith("/endpoints"))
            return metadata([
              endpoint("fast/fp8"),
              endpoint("backup/fp8", 60),
              endpoint("slow", 10),
            ]);
          bodies.push(JSON.parse(options.body));
          return stream
            ? new Response(
                'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
                { headers: { "content-type": "text/event-stream" } },
              )
            : completion();
        }),
      );
      const client = new LLMClient("test-key", {
        useNitro: true,
        plannerProviderPin: "slow",
      });
      client.switchToPlanner();
      if (stream) await client.completeStream(request, () => {});
      else await client.complete(request);
      expect(bodies[0]).toMatchObject({
        model: "deepseek/deepseek-v4.1-flash",
        provider: {
          only: ["fast/fp8", "backup/fp8"],
          order: ["fast/fp8", "backup/fp8"],
          allow_fallbacks: false,
          require_parameters: true,
          max_price: { completion: 1 },
        },
      });
    },
  );

  test("eligible preference reorders without expanding the allowlist; cached data expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      metadata([endpoint("fast/fp8"), endpoint("backup/fp8", 60)]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = new OpenRouterQualityRouter();
    const pinned = {
      ...init(),
      body: JSON.stringify({
        model: "deepseek/deepseek-v4.1-flash",
        provider: { order: ["backup"] },
      }),
    };
    expect(
      JSON.parse(String((await router.prepare(pinned)).body)).provider.order,
    ).toEqual(["backup/fp8", "fast/fp8"]);
    await router.prepare(init());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    await router.prepare(init());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("metadata errors do not permit unfiltered requests or stale cached fallback", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValue(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const router = new OpenRouterQualityRouter();
    await router.prepare(init());
    await vi.advanceTimersByTimeAsync(60_001);
    await expect(router.prepare(init())).rejects.toThrow(
      "unable to verify providers",
    );
  });

  test("cancellation prevents lookup and cloud sentinel is never sent upstream", async () => {
    vi.spyOn(chrome.storage.local, "get").mockResolvedValue({
      cloudExtensionSessionV1: {
        accessToken: "cloud-access",
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    const fetchMock = vi.fn(async (_url, options) => {
      expect(new Headers(options.headers).get("Authorization")).toBe(
        "Bearer cloud-access",
      );
      return metadata();
    });
    vi.stubGlobal("fetch", fetchMock);
    const router = new OpenRouterQualityRouter();
    await expect(router.prepare(init(), AbortSignal.abort())).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await router.prepare({
      ...init(),
      headers: { Authorization: "Bearer __opensidebar_cloud__" },
    });
  });

  test("executor, judge and direct planner seats keep their existing routing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => completion());
    vi.stubGlobal("fetch", fetchMock);
    const client = new LLMClient("test-key");
    await client.complete(request);
    await client.runJudge({ systemPrompt: "Check", userPrompt: "Evidence" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls)
      expect(String(url)).not.toContain("/endpoints");
  });
});

describe("planner routing failure boundaries", () => {
  test("malformed entries and numeric metadata cannot become eligible", () => {
    expect(
      rankEligibleEndpoints([
        null,
        12,
        [],
        "host",
        { ...endpoint(), tag: 3 },
        { ...endpoint(), tag: "bad slug" },
        { ...endpoint(), pricing: null },
        endpoint("hex", 90, 1, "0x01"),
        endpoint("negative", 90, -1),
        endpoint("infinite", Infinity),
        { ...endpoint(), latency_last_30m: { p50: "1" } },
        endpoint("good"),
      ]).map((entry) => entry.tag),
    ).toEqual(["good"]);
  });

  test.each([null, {}, { data: null }, { data: { endpoints: {} } }])(
    "rejects malformed envelopes: %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body))),
      );
      await expect(
        new OpenRouterQualityRouter().prepare(init()),
      ).rejects.toThrow("unable to verify");
    },
  );

  test.each(["timeout", "cancel"])(
    "interrupts metadata body reading on %s without caching it",
    async (kind) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let reading!: () => void;
      const started = new Promise<void>((resolve) => {
        reading = resolve;
      });
      const fetchMock = vi.fn(async (_url, options) => ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
            reading();
          }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      const router = new OpenRouterQualityRouter();
      const pending = expect(
        router.prepare(init(), controller.signal),
      ).rejects.toThrow(
        kind === "timeout" ? "unable to verify" : "cancelled lookup",
      );
      await started;
      if (kind === "timeout") await vi.advanceTimersByTimeAsync(5_000);
      else controller.abort(new Error("cancelled lookup"));
      await pending;
      fetchMock.mockImplementation(async () => metadata());
      await router.prepare(init());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  test("cache lifetime begins after the response body is received", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return metadata();
    });
    vi.stubGlobal("fetch", fetchMock);
    const router = new OpenRouterQualityRouter();
    const pending = router.prepare(init());
    await vi.advanceTimersByTimeAsync(4_000);
    await pending;
    await vi.advanceTimersByTimeAsync(59_000);
    await router.prepare(init());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])(
    "custom models retain their identity after routing suffix removal (stream=%s)",
    async (stream) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          if (String(url).endsWith("/endpoints")) {
            expect(String(url)).toContain("custom/planner/endpoints");
            return metadata();
          }
          expect(JSON.parse(options.body).model).toBe("custom/planner");
          return stream
            ? new Response(
                'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
              )
            : completion();
        }),
      );
      const client = new LLMClient("key", {
        plannerModel: "custom/planner",
        useNitro: true,
      });
      client.switchToPlanner();
      const result = stream
        ? await client.completeStream(request, () => {})
        : await client.complete(request);
      expect(result.actualModel).toBe("custom/planner");
    },
  );

  test("a concurrent seat switch cannot change cloud planner attribution", async () => {
    const get = vi.spyOn(chrome.storage.local, "get").mockResolvedValue({
      cloudExtensionSessionV1: {
        accessToken: "cloud-access",
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    const client = new LLMClient("__opensidebar_cloud__");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (String(url).endsWith("/endpoints")) {
          expect(new Headers(options.headers).get("Authorization")).toBe(
            "Bearer cloud-access",
          );
          client.switchToExecutor();
          return metadata();
        }
        const payload = JSON.parse(options.body);
        expect(payload).toMatchObject({
          seat: "planner",
          modelId: "deepseek/deepseek-v4.1-flash",
          providerRouting: { only: ["fast/fp8"] },
        });
        expect(new Headers(options.headers).get("Authorization")).toBe(
          "Bearer cloud-access",
        );
        return completion();
      }),
    );
    try {
      client.switchToPlanner();
      await client.complete(request);
    } finally {
      get.mockRestore();
    }
  });

  test("expired metadata is rechecked before a paid retry", async () => {
    vi.useFakeTimers();
    let lookups = 0;
    let paid = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/endpoints"))
          return ++lookups === 1 ? metadata() : metadata([]);
        paid++;
        vi.setSystemTime(Date.now() + 61_000);
        return new Response("busy", { status: 503 });
      }),
    );
    const client = new LLMClient("key");
    client.switchToPlanner();
    const pending = expect(client.complete(request)).rejects.toThrow(
      "no verified provider",
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(lookups).toBe(2);
    expect(paid).toBe(1);
  });
});

test("rejects an injected direct-provider pool before network access",async()=>{
 const client=new LLMClient("key");
 const pool=(client as unknown as {executorPool: import("../../src/background/llm/client").ProviderPool}).executorPool;
 pool.getActive().provider.baseUrl="https://api.example.invalid/chat/completions";
 const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
 await expect(client.complete(request)).rejects.toThrow(/Only OpenRouter/);
 expect(fetchMock).not.toHaveBeenCalled();
});
