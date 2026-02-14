import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";

// Define build-time variable that Vite normally provides
(globalThis as any).__OPENROUTER_API_KEY__ = "";

import { describeScreenshot } from "../../src/background/vision";

const mockSettings = {
  openRouterApiKey: "test-vision-key",
};

global.chrome = {
  storage: {
    sync: {
      get: async () => ({ userSettings: mockSettings }),
    },
  },
} as any;

const FAKE_DATA_URL = "data:image/jpeg;base64,/9j/fakedata";

describe("Vision Bridge", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockSettings.openRouterApiKey = "test-vision-key";
    fetchSpy = spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("successful description returns [Screenshot Description] prefix", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "A login page with a form and two buttons." } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.001 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await describeScreenshot(FAKE_DATA_URL);

    expect(result.description).toStartWith("[Screenshot Description]");
    expect(result.description).toContain("A login page with a form and two buttons.");
    expect(result.usage).toBeDefined();
    expect(result.usage!.prompt_tokens).toBe(100);
    expect(result.usage!.completion_tokens).toBe(50);
    expect(result.usage!.cost).toBe(0.001);
    expect(result.model).toBe("qwen/qwen3-vl-235b-a22b-instruct");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetchSpy).toHaveBeenCalled();

    // Check the last call (ours) since other test files may spy on fetch globally
    const calls = (fetchSpy as any).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(lastCall[1].body);
    expect(body.model).toBe("qwen/qwen3-vl-235b-a22b-instruct");
  });

  test("missing API key returns graceful fallback", async () => {
    mockSettings.openRouterApiKey = "";

    const result = await describeScreenshot(FAKE_DATA_URL);
    expect(result.description).toContain("no OpenRouter API key");
    expect(result.usage).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("429 triggers retry then returns error fallback", async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      return Promise.resolve(new Response("Rate Limited", { status: 429 }));
    });

    const result = await describeScreenshot(FAKE_DATA_URL);
    expect(result.description).toContain("vision analysis failed");
    expect(result.description).toContain("429");
    // Should have retried (initial + 2 retries = 3 total)
    expect(callCount).toBe(3);
  });

  test("400 does NOT retry (non-retryable)", async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      return Promise.resolve(new Response("Bad Request", { status: 400 }));
    });

    const result = await describeScreenshot(FAKE_DATA_URL);
    expect(result.description).toContain("vision analysis failed");
    expect(result.description).toContain("400");
    // Should NOT retry on 400
    expect(callCount).toBe(1);
  });
});
