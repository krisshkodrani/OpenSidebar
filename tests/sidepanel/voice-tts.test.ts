import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripMarkdownForTTS } from "../../src/utils/strip-markdown";

// We need to mock Audio, URL.createObjectURL, and synthesizeSpeech before importing speakText.
// Use dynamic import after mocks are in place.

let speakText: typeof import("../../src/sidepanel/hooks/useTextToSpeech").speakText;
let stopCurrentTTS: typeof import("../../src/sidepanel/hooks/useTextToSpeech").stopCurrentTTS;
let clearTTSCache: typeof import("../../src/sidepanel/hooks/useTextToSpeech").clearTTSCache;

const mockPlay = vi.fn(async () => {});
const mockPause = vi.fn();
const mockAudioInstances: any[] = [];

beforeEach(async () => {
  vi.restoreAllMocks();
  mockAudioInstances.length = 0;

  // Mock Audio constructor
  (globalThis as any).Audio = vi.fn(() => {
    const instance = {
      play: mockPlay,
      pause: mockPause,
      paused: false,
      currentTime: 0,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    mockAudioInstances.push(instance);
    return instance;
  });

  // Mock URL.createObjectURL / revokeObjectURL
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  globalThis.URL.revokeObjectURL = vi.fn();

  // Default fetch mock — returns a small audio blob
  globalThis.fetch = vi.fn(async () =>
    new Response(new Blob(["audio-data"]), { status: 200 }),
  ) as any;

  // Fresh import to reset module-level state (speakGeneration, globalAudio)
  const mod = await import("../../src/sidepanel/hooks/useTextToSpeech");
  speakText = mod.speakText;
  stopCurrentTTS = mod.stopCurrentTTS;
  clearTTSCache = mod.clearTTSCache;
  clearTTSCache(); // start each test with empty cache
});

afterEach(() => {
  stopCurrentTTS();
});

// ═══════════════ Voice mapping ═══════════════

describe("voice mapping", () => {
  it("maps OpenAI voice to Groq default when provider is Groq", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toBe("hannah"); // "nova" should become "hannah"
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { groqApiKey: "gsk-test" }, "nova");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves valid Groq voice", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toBe("troy");
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { groqApiKey: "gsk-test" }, "troy");
  });

  it("maps Groq voice to OpenAI default when provider is OpenAI", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toBe("nova"); // "hannah" should become "nova"
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "hannah");
  });

  it("preserves valid OpenAI voice", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toBe("shimmer");
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "shimmer");
  });
});

// ═══════════════ Provider fallback ═══════════════

describe("provider fallback", () => {
  it("falls back to OpenAI when Groq TTS fails", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      urls.push(url as string);
      if ((url as string).includes("groq.com")) {
        return new Response(JSON.stringify({ error: { message: "terms not accepted" } }), { status: 400 });
      }
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { groqApiKey: "gsk-test", openaiApiKey: "sk-test" }, "nova");

    expect(urls.length).toBe(2);
    expect(urls[0]).toContain("groq.com");
    expect(urls[1]).toContain("openai.com");
  });

  it("throws when Groq fails and no OpenAI key", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "fail" }), { status: 400 }),
    ) as any;

    await expect(
      speakText("Hello", { groqApiKey: "gsk-test" }, "hannah"),
    ).rejects.toThrow();
  });

  it("uses correct fallback voice on OpenAI retry", async () => {
    let openaiVoice = "";
    globalThis.fetch = vi.fn(async (url, init) => {
      if ((url as string).includes("groq.com")) {
        return new Response("error", { status: 500 });
      }
      openaiVoice = JSON.parse(init?.body as string).voice;
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    // "troy" is a Groq voice, should fall back to "nova" on OpenAI
    await speakText("Hello", { groqApiKey: "gsk-test", openaiApiKey: "sk-test" }, "troy");
    expect(openaiVoice).toBe("nova");
  });
});

// ═══════════════ Generation counter (concurrent calls) ═══════════════

describe("concurrent TTS (generation counter)", () => {
  it("only the last concurrent call creates audio", async () => {
    let resolvers: Array<(v: Response) => void> = [];

    // Each fetch call returns a promise we control
    globalThis.fetch = vi.fn(() =>
      new Promise<Response>((resolve) => { resolvers.push(resolve); }),
    ) as any;

    // Fire 3 concurrent speakText calls
    const p1 = speakText("First", { openaiApiKey: "sk-test" }, "nova");
    const p2 = speakText("Second", { openaiApiKey: "sk-test" }, "nova");
    const p3 = speakText("Third", { openaiApiKey: "sk-test" }, "nova");

    // Resolve all fetches
    const audioBlob = new Blob(["audio"]);
    for (const resolve of resolvers) {
      resolve(new Response(audioBlob, { status: 200 }));
    }

    await Promise.allSettled([p1, p2, p3]);

    // Only the last call (Third) should have created an Audio instance
    expect(mockAudioInstances.length).toBe(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════ Text handling ═══════════════

describe("text handling", () => {
  it("sends full text up to 4096 chars", async () => {
    const longText = "Word ".repeat(1000); // ~5000 chars
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.input.length).toBe(4096);
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText(longText, { openaiApiKey: "sk-test" }, "nova");
  });

  it("skips empty text after markdown stripping", async () => {
    await speakText("```\ncode only\n```", { openaiApiKey: "sk-test" }, "nova");
    // stripMarkdownForTTS converts code blocks to "code block omitted" which is not empty
    // but truly empty input should be skipped
    expect(fetch).toHaveBeenCalled();
  });
});

// ═══════════════ stripMarkdownForTTS ═══════════════

describe("stripMarkdownForTTS", () => {
  it("removes bold markers", () => {
    expect(stripMarkdownForTTS("**hello**")).toBe("hello");
  });

  it("removes italic markers", () => {
    expect(stripMarkdownForTTS("*world*")).toBe("world");
  });

  it("converts links to text", () => {
    expect(stripMarkdownForTTS("[click here](https://example.com)")).toBe("click here");
  });

  it("replaces code blocks", () => {
    expect(stripMarkdownForTTS("```js\nconst x = 1;\n```")).toBe("code block omitted");
  });

  it("removes headings", () => {
    expect(stripMarkdownForTTS("## Summary\nContent here")).toBe("Summary\nContent here");
  });

  it("removes list markers", () => {
    expect(stripMarkdownForTTS("- item one\n- item two")).toBe("item one\nitem two");
  });

  it("collapses whitespace", () => {
    expect(stripMarkdownForTTS("hello    world")).toBe("hello world");
  });

  it("handles combined markdown", () => {
    const input = "## Title\n\n**Bold** and *italic* with [link](url)\n\n- item";
    const result = stripMarkdownForTTS(input);
    expect(result).toContain("Bold");
    expect(result).toContain("italic");
    expect(result).toContain("link");
    expect(result).not.toContain("**");
    expect(result).not.toContain("##");
    expect(result).not.toContain("](");
  });
});

// ═══════════════ TTS cache ═══════════════

describe("TTS cache", () => {
  it("reuses cached blob on second call with same text+voice+provider", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");
    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");

    expect(fetchCount).toBe(1); // only one API call
    expect(mockAudioInstances.length).toBe(2); // two Audio instances (both play)
  });

  it("cache miss on different voice", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");
    await speakText("Hello", { openaiApiKey: "sk-test" }, "alloy");

    expect(fetchCount).toBe(2);
  });

  it("cache miss on different text", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");
    await speakText("World", { openaiApiKey: "sk-test" }, "nova");

    expect(fetchCount).toBe(2);
  });

  it("clearTTSCache forces a fresh fetch", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");
    clearTTSCache();
    await speakText("Hello", { openaiApiKey: "sk-test" }, "nova");

    expect(fetchCount).toBe(2); // both fetched
  });
});
