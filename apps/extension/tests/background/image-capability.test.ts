import { describe, expect, test } from "vitest";
import {
  hasImageUrlContent,
  isImageUrlUnsupported,
  toTextOnlyMessages,
} from "../../src/background/llm/image-capability";
import type { LLMMessage } from "../../src/background/llm/types";

describe("isImageUrlUnsupported", () => {
  test("matches Fireworks' actual rejection: 400 + 'image inputs'", () => {
    // Verified against the live API 2026-07-21 (glm-5p2) — the original
    // 422-and-"image_url"-only form made the text-only retry dead code here.
    expect(
      isImageUrlUnsupported(
        400,
        '{"error":{"message":"This model does not support image inputs"}}',
      ),
    ).toBe(true);
  });

  test("still matches the OpenRouter/Groq form: 422 + image_url not supported", () => {
    expect(
      isImageUrlUnsupported(422, "image_url content is not supported"),
    ).toBe(true);
  });

  test("an unrelated 400 is not misread as an image problem", () => {
    expect(isImageUrlUnsupported(400, "missing required field: model")).toBe(
      false,
    );
    expect(
      isImageUrlUnsupported(400, "image input exceeds the size limit"),
    ).toBe(false); // mentions images but is not a capability rejection
  });

  test("other statuses never match", () => {
    expect(
      isImageUrlUnsupported(500, "this model does not support image inputs"),
    ).toBe(false);
  });
});

describe("text-only fallback messages", () => {
  const messages: LLMMessage[] = [
    { role: "user", content: "plain" },
    {
      role: "user",
      content: [
        { type: "text", text: "look at this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
      ],
    },
  ];

  test("hasImageUrlContent detects multipart image messages", () => {
    expect(hasImageUrlContent(messages)).toBe(true);
    expect(hasImageUrlContent([messages[0]])).toBe(false);
  });

  test("toTextOnlyMessages flattens parts and marks omitted images", () => {
    const flattened = toTextOnlyMessages(messages);
    expect(flattened[0].content).toBe("plain");
    expect(flattened[1].content).toBe(
      "look at this\n[image omitted: model does not support image_url]",
    );
  });
});
