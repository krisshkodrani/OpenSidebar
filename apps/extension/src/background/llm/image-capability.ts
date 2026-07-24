/**
 * Image-capability helpers for outbound LLM requests.
 *
 * Extracted from client.ts (2026-07-21) when the vision-aware escalation work
 * grew the matcher's documentation past the decomposition ratchet's budget.
 * They belong together anyway: all three answer "can this model take the
 * images this request is carrying, and what do we send if not?"
 *
 * Only the EXECUTOR role is required to be multimodal (EXECUTOR_ELIGIBLE_MODELS
 * and VL_CAPABLE_MODELS are the same set). Planner, writer and judge are
 * text-only by design, so stripping images for them is a contract rather than
 * a failure; the reactive retry below is the safety net either way.
 */

import { LLMMessage } from "./types";

export function hasImageUrlContent(messages: LLMMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}

export function toTextOnlyMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const text = message.content
      .map((part) =>
        part.type === "text"
          ? part.text
          : "[image omitted: model does not support image_url]",
      )
      .join("\n");
    return {
      ...message,
      content: text,
    };
  });
}

/**
 * Does this error mean "the model cannot accept images", as opposed to any
 * other bad request? Providers disagree on both the status and the wording:
 *
 *   OpenRouter/Groq  422 + "image_url ... not supported"
 *   Fireworks        400 + "This model does not support image inputs"
 *
 * The original 422-and-"image_url"-only form matched the first and silently
 * missed the second, so the text-only retry was dead code on Fireworks --
 * verified against the live API on 2026-07-21 with glm-5p2. Both the status set
 * and the phrase set are widened; the "not/does not support" conjunct keeps an
 * unrelated 400 from being misread as an image problem.
 */
export function isImageUrlUnsupported(
  status: number,
  errorText: string,
): boolean {
  if (status !== 400 && status !== 422) return false;
  const normalized = errorText.toLowerCase();
  const mentionsImages =
    normalized.includes("image_url") || normalized.includes("image input");
  return (
    mentionsImages &&
    (normalized.includes("not supported") ||
      normalized.includes("does not support") ||
      normalized.includes("only 'text' content type") ||
      normalized.includes("wrong_api_format"))
  );
}
