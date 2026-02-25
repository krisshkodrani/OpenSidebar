import "../setup";
import { describe, test, expect, beforeEach } from "vitest";
import { classifyRoute, type RouteDecision } from "../../src/background/orchestrator/router";
import type { UserSettings } from "../../src/types";

// ----- helpers -----

const baseSettings: UserSettings = {
  openRouterApiKey: "test-or-key",
  groqApiKey: "",
  cerebrasApiKey: "test-cerebras-key",
  maxTurns: 10,
  contextWindowSize: 16000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  showSessionMetrics: false,
  disableScreenshot: false,
  disableNavigation: false,
  bypassApprovals: true,
  speechProvider: "browser",
  orchestratorMaxWorkers: 3,
  teachModeEnabled: false,
  autoSkillReplayEnabled: false,
};

/** Mock fetch that intercepts API calls and passes through log server requests. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.startsWith("http://127.0.0.1:7589/")) {
      return new Response(null, { status: 204 });
    }
    return handler(url, init);
  }) as typeof fetch;
}

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

let savedFetch: typeof globalThis.fetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

function restoreFetch() {
  globalThis.fetch = savedFetch;
}

// ----- Tests -----

describe("classifyRoute", () => {
  test("returns direct for Q&A query", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "direct", "confidence": 0.95, "reason": "Simple page question"}'),
    );
    try {
      const result = await classifyRoute(
        "What color is the submit button?",
        "My Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("direct");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reason).toBe("Simple page question");
    } finally {
      restoreFetch();
    }
  });

  test("returns agent for simple action", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "agent", "confidence": 0.9, "reason": "Single click action"}'),
    );
    try {
      const result = await classifyRoute(
        "Click the login button",
        "Login Page",
        "https://example.com/login",
        baseSettings,
      );
      expect(result.route).toBe("agent");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    } finally {
      restoreFetch();
    }
  });

  test("returns plan for complex query", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "plan", "confidence": 0.85, "reason": "Multi-step workflow"}'),
    );
    try {
      const result = await classifyRoute(
        "Book a flight to NYC under $500",
        "Travel Site",
        "https://travel.example.com",
        baseSettings,
      );
      expect(result.route).toBe("plan");
    } finally {
      restoreFetch();
    }
  });

  test("falls back to agent on fetch error", async () => {
    globalThis.fetch = mockFetch(() => {
      throw new Error("Network error");
    });
    try {
      const result = await classifyRoute(
        "Do something",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("agent");
      expect(result.confidence).toBe(0.5);
      expect(result.reason).toBe("Router fallback");
    } finally {
      restoreFetch();
    }
  });

  test("falls back to agent on invalid JSON response", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse("I'm not sure, maybe agent?"),
    );
    try {
      const result = await classifyRoute(
        "Do something",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("agent");
      expect(result.reason).toBe("Router fallback");
    } finally {
      restoreFetch();
    }
  });

  test("falls back to agent on HTTP error", async () => {
    globalThis.fetch = mockFetch(() =>
      new Response("Rate limited", { status: 429 }),
    );
    try {
      const result = await classifyRoute(
        "Do something",
        "Page",
        "https://example.com",
        { ...baseSettings, cerebrasApiKey: "key-only" , openRouterApiKey: "" },
      );
      expect(result.route).toBe("agent");
      expect(result.reason).toBe("Router fallback");
    } finally {
      restoreFetch();
    }
  });

  test("falls back to agent when no API keys available", async () => {
    const savedOR = (globalThis as any).__OPENROUTER_API_KEY__;
    const savedGroq = (globalThis as any).__GROQ_API_KEY__;
    const savedCerebras = (globalThis as any).__CEREBRAS_API_KEY__;
    (globalThis as any).__OPENROUTER_API_KEY__ = "";
    (globalThis as any).__GROQ_API_KEY__ = "";
    (globalThis as any).__CEREBRAS_API_KEY__ = "";
    try {
      const result = await classifyRoute(
        "What is this?",
        "Page",
        "https://example.com",
        { ...baseSettings, cerebrasApiKey: "", openRouterApiKey: "", groqApiKey: "" },
      );
      expect(result.route).toBe("agent");
      expect(result.reason).toBe("Router fallback");
    } finally {
      (globalThis as any).__OPENROUTER_API_KEY__ = savedOR;
      (globalThis as any).__GROQ_API_KEY__ = savedGroq;
      (globalThis as any).__CEREBRAS_API_KEY__ = savedCerebras;
    }
  });

  test("handles response with think tags", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse(
        '<think>Let me classify this...</think>{"route": "direct", "confidence": 0.9, "reason": "Q&A"}',
      ),
    );
    try {
      const result = await classifyRoute(
        "What does the heading say?",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("direct");
    } finally {
      restoreFetch();
    }
  });

  test("handles response wrapped in code fences", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('```json\n{"route": "agent", "confidence": 0.8, "reason": "Simple action"}\n```'),
    );
    try {
      const result = await classifyRoute(
        "Scroll down",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("agent");
    } finally {
      restoreFetch();
    }
  });

  test("clamps confidence to 0-1 range", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "plan", "confidence": 5.0, "reason": "High"}'),
    );
    try {
      const result = await classifyRoute(
        "Complex task",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.confidence).toBeLessThanOrEqual(1);
    } finally {
      restoreFetch();
    }
  });

  test("defaults confidence when missing", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "direct", "reason": "No confidence field"}'),
    );
    try {
      const result = await classifyRoute(
        "What is this?",
        "Page",
        "https://example.com",
        baseSettings,
      );
      expect(result.route).toBe("direct");
      expect(result.confidence).toBe(0.7);
    } finally {
      restoreFetch();
    }
  });

  test("tries next provider on 429", async () => {
    let callCount = 0;
    globalThis.fetch = mockFetch((url) => {
      callCount++;
      if (url.includes("cerebras")) {
        return new Response("Rate limited", { status: 429 });
      }
      return jsonResponse('{"route": "agent", "confidence": 0.8, "reason": "Fallback provider"}');
    });
    try {
      const result = await classifyRoute(
        "Click something",
        "Page",
        "https://example.com",
        { ...baseSettings, cerebrasApiKey: "key1", openRouterApiKey: "key2" },
      );
      expect(result.route).toBe("agent");
      expect(callCount).toBeGreaterThan(1);
    } finally {
      restoreFetch();
    }
  });

  test("rejects invalid route value", async () => {
    globalThis.fetch = mockFetch(() =>
      jsonResponse('{"route": "banana", "confidence": 0.9, "reason": "Invalid"}'),
    );
    try {
      const result = await classifyRoute(
        "Do something",
        "Page",
        "https://example.com",
        baseSettings,
      );
      // "banana" is not a valid route, should fall back
      expect(result.route).toBe("agent");
      expect(result.reason).toBe("Router fallback");
    } finally {
      restoreFetch();
    }
  });
});
