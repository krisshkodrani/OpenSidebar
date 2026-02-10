import {
  describe,
  test,
  expect,
  spyOn,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { callKimiSwarm } from "../../src/background/swarm";
import { ActivateSwarmArgs } from "../../src/types";

// Mock chrome.storage
const mockStorage = {
  openRouterApiKey: "test-api-key",
};

global.chrome = {
  storage: {
    sync: {
      get: async (keys: string[]) => mockStorage,
    },
  },
} as any;

describe("Kimi Swarm Client", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = spyOn(global, "fetch");
  });

  test("should call OpenRouter API with correct parameters", async () => {
    // Mock successful response
    fetchSpy.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"Research complete."}}]}\n\n',
              ),
            );
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    const args: ActivateSwarmArgs = {
      task: "Analyze quantum computing trends",
      urls: ["https://example.com"],
    };

    const result = await callKimiSwarm(args);

    expect(result).toBe("Research complete.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe("moonshotai/kimi-k2.5");
    expect(body.mode).toBe("agent_swarm");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain(
      "Research Task: Analyze quantum computing trends",
    );
    expect(body.messages[1].content).toContain("https://example.com");
  });

  test("should handle missing API key", async () => {
    // Temporarily clear API key
    const originalKey = mockStorage.openRouterApiKey;
    mockStorage.openRouterApiKey = "";

    const result = await callKimiSwarm({ task: "test" });
    expect(result).toContain("Error: OpenRouter API key not configured");

    mockStorage.openRouterApiKey = originalKey; // Restore
  });

  test("should handle API errors gracefully", async () => {
    // Mock to return a fresh Response on each call (needed for retry logic)
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      return Promise.resolve(new Response("Rate Limited", { status: 429 }));
    });

    const result = await callKimiSwarm({ task: "test" });
    expect(result).toContain("Swarm Error");
    expect(result).toContain("429");
    // Should have attempted multiple times due to retry logic
    expect(callCount).toBeGreaterThan(1);
  });
});
