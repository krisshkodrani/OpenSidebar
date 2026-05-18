import { describe, expect, test, vi } from "vitest";
import "../setup";
import { transcribeWithGroq } from "../../src/background/speech/groq";

function base64(value: string): string {
  return btoa(value);
}

describe("Groq speech transcription", () => {
  test("requires a Groq API key", async () => {
    await expect(
      transcribeWithGroq({
        apiKey: "",
        audioBase64: base64("audio"),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("Add a Groq API key");
  });

  test("sends multipart transcription request to Groq", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ text: " hello world " }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await transcribeWithGroq({
      apiKey: "gsk_test",
      audioBase64: base64("audio"),
      mimeType: "audio/webm;codecs=opus",
      fetchFn,
      now: () => 100,
    });

    expect(result).toEqual({ text: "hello world", durationMs: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer gsk_test" });
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  test("maps provider errors to user-facing details", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "invalid api key" } }),
        { status: 401 },
      );
    }) as unknown as typeof fetch;

    await expect(
      transcribeWithGroq({
        apiKey: "bad",
        audioBase64: base64("audio"),
        mimeType: "audio/webm",
        fetchFn,
      }),
    ).rejects.toThrow("invalid api key");
  });
});
