import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesizeSpeech, transcribeAudio } from "../../src/background/llm/audio";

// --- Helpers ---

function mockFetchResponse(body: any, status = 200) {
  const blob = body instanceof Blob ? body : new Blob([JSON.stringify(body)], { type: "application/json" });
  return new Response(status === 200 && !(body instanceof Blob) ? JSON.stringify(body) : blob, {
    status,
    headers: { "Content-Type": body instanceof Blob ? "audio/wav" : "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════ synthesizeSpeech ═══════════════

describe("synthesizeSpeech", () => {
  it("sends correct request to OpenAI", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("tts-1");
      expect(body.voice).toBe("nova");
      expect(body.input).toBe("Hello world");
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    const blob = await synthesizeSpeech({
      text: "Hello world",
      provider: "openai",
      apiKey: "sk-test",
      voice: "nova",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends correct request to Groq", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(url).toContain("groq.com");
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toBe("hannah");
      expect(body.response_format).toBe("wav");
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await synthesizeSpeech({
      text: "Hello",
      provider: "groq",
      apiKey: "gsk-test",
      voice: "hannah",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends correct request to Gemini and converts PCM to WAV", async () => {
    const pcmBase64 = Buffer.from(Uint8Array.from([0, 0, 255, 127])).toString("base64");
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
      expect(
        body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      ).toBe("Kore");
      expect(body.contents[0].parts[0].text).toContain("[friendly, warm]");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;rate=24000",
                      data: pcmBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const blob = await synthesizeSpeech({
      text: "Hello from Gemini",
      provider: "gemini",
      apiKey: "AIza-test",
      voice: "Kore",
      stylePreset: "friendly",
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBeGreaterThan(44);
  });

  it("retries Gemini on transient 500s", async () => {
    const pcmBase64 = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString("base64");
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("temporary failure", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;rate=24000",
                      data: pcmBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const blob = await synthesizeSpeech({
      text: "Retry me",
      provider: "gemini",
      apiKey: "AIza-test",
      voice: "Kore",
    });

    expect(callCount).toBe(2);
    expect(blob.type).toBe("audio/wav");
  });

  it("sends full text without truncation", async () => {
    const longText = "A".repeat(3000);
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.input).toBe(longText);
      expect(body.input.length).toBe(3000);
      return new Response(new Blob(["audio"]), { status: 200 });
    }) as any;

    await synthesizeSpeech({
      text: longText,
      provider: "groq",
      apiKey: "gsk-test",
      voice: "troy",
    });
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    ) as any;

    await expect(
      synthesizeSpeech({ text: "Hi", provider: "openai", apiKey: "sk-test" }),
    ).rejects.toThrow("400");
  });
});

// ═══════════════ transcribeAudio ═══════════════

describe("transcribeAudio", () => {
  const audioBlob = new Blob(["audio-data"], { type: "audio/webm" });

  it("uses Groq first when both keys are present", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(url).toContain("groq.com");
      return mockFetchResponse({ text: "hello world" });
    }) as any;

    const result = await transcribeAudio(audioBlob, {
      groqApiKey: "gsk-test",
      openaiApiKey: "sk-test",
    });
    expect(result.text).toBe("hello world");
    expect(result.provider).toBe("groq");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to OpenAI when Groq fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (url) => {
      callCount++;
      if ((url as string).includes("groq.com")) {
        return new Response("error", { status: 500 });
      }
      return mockFetchResponse({ text: "transcribed" });
    }) as any;

    const result = await transcribeAudio(audioBlob, {
      groqApiKey: "gsk-test",
      openaiApiKey: "sk-test",
    });
    expect(callCount).toBe(2);
    expect(result.provider).toBe("openai");
    expect(result.text).toBe("transcribed");
  });

  it("uses OpenAI directly when only OpenAI key is present", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(url).toContain("openai.com");
      return mockFetchResponse({ text: "from openai" });
    }) as any;

    const result = await transcribeAudio(audioBlob, { openaiApiKey: "sk-test" });
    expect(result.provider).toBe("openai");
  });

  it("throws when no keys are provided", async () => {
    await expect(transcribeAudio(audioBlob, {})).rejects.toThrow("No API key");
  });

  it("trims whitespace from transcription", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockFetchResponse({ text: "  hello  " }),
    ) as any;

    const result = await transcribeAudio(audioBlob, { groqApiKey: "gsk-test" });
    expect(result.text).toBe("hello");
  });
});
