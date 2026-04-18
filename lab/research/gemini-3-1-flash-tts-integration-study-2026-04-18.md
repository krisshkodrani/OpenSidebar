# Gemini 3.1 Flash TTS Integration Study

**Date:** 2026-04-18  
**Purpose:** Evaluate Gemini 3.1 Flash TTS as an optional voice-output provider for OpenSidebar

---

## Executive Summary

Gemini 3.1 Flash TTS is a credible optional TTS provider for OpenSidebar, but it should be integrated as an opt-in preview provider, not as the new default.

Why it fits:

- OpenSidebar already has a provider-based TTS path with settings, playback, caching, and tests.
- The extension already has outbound host access via `"<all_urls>"`, so Gemini does not require a manifest redesign.
- Gemini 3.1 Flash TTS adds strengths the current stack does not emphasize: 30 voices, 70+ supported languages, strong expressive control through inline audio tags, and native multi-speaker output.

Why it should remain optional first:

- The model is in preview as of April 15, 2026.
- Google documents several preview-specific reliability issues, including occasional `500` failures where text tokens are returned instead of audio tokens.
- The API shape is materially different from OpenAI/Groq: Gemini returns base64 PCM audio inside JSON, not a directly playable `audio/*` response body.

Recommendation: implement Gemini as `ttsProvider: "gemini"` behind a preview label, keep current `auto` behavior unchanged, and add retry/chunking/prompt-wrapping guardrails before enabling broader use.

---

## What Google Shipped

On **April 15, 2026**, Google announced **Gemini 3.1 Flash TTS** as a preview model for the Gemini API, AI Studio, and Vertex AI. The launch positions it as a more expressive and controllable speech model with:

- granular audio tags for style, pacing, accent, and delivery
- support for **70+ languages**
- **single-speaker** and **multi-speaker** generation
- **30 prebuilt voices**
- SynthID watermarking on generated audio

Primary official references:

- Google launch post: <https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-tts/>
- Gemini API TTS docs: <https://ai.google.dev/gemini-api/docs/speech-generation>

Important implementation facts from the docs:

- Model ID: `gemini-3.1-flash-tts-preview`
- Invocation shape: `generateContent` with `responseModalities: ["AUDIO"]`
- Output format in docs/examples: base64 PCM audio data that must be wrapped or converted before playback
- No streaming support
- TTS context window limit: `32k` tokens
- Google explicitly recommends retry logic because some requests randomly fail with `500` when the model returns text tokens instead of audio tokens
- Google also warns that vague prompts can trigger `PROHIBITED_CONTENT` or cause the model to read prompt instructions aloud

Supported voice names include `Kore`, `Puck`, `Charon`, `Zephyr`, `Leda`, `Enceladus`, and 24 others listed in the official TTS guide.

---

## Fit With OpenSidebar Today

Current OpenSidebar TTS is already isolated enough to accept a third provider cleanly.

Relevant current code:

- TTS request layer: `apps/extension/src/background/llm/audio.ts`
- Playback/cache/provider resolution: `apps/extension/src/sidepanel/hooks/useTextToSpeech.ts`
- Voice settings UI: `apps/extension/src/sidepanel/components/SettingsDrawer.tsx`
- Message-level playback trigger: `apps/extension/src/sidepanel/components/MessageBubble.tsx`
- Auto-speak on final response: `apps/extension/src/sidepanel/App.tsx`
- Settings type: `packages/shared-types/src/settings.ts`
- Settings persistence: `apps/extension/src/utils/settings-storage.ts`
- Existing tests: `apps/extension/tests/background/audio.test.ts`, `apps/extension/tests/sidepanel/voice-tts.test.ts`

Current architecture characteristics:

- TTS runs client-side from the extension, not through the backend.
- Provider choice is already separate from the main agent provider stack.
- The UI already exposes provider-specific voices and API keys.
- Audio playback expects a `Blob` that the browser can play through `new Audio(objectUrl)`.

Conclusion: this is a targeted provider extension, not a platform refactor.

---

## Main Integration Gap

The biggest mismatch is not settings or API auth. It is the **audio response format**.

OpenAI/Groq today:

- return a directly playable `Blob` from `/audio/speech`
- current code can pass that blob straight to `Audio`

Gemini 3.1 Flash TTS:

- returns JSON
- audio arrives as `candidates[0].content.parts[0].inlineData.data`
- the payload is base64 PCM at 24 kHz in the official examples

That means Gemini support needs a small conversion layer, for example:

1. decode base64 PCM
2. wrap it in a WAV header
3. return `new Blob([...], { type: "audio/wav" })`

Without that helper, the current playback path will not work.

---

## Recommended Product Shape

### Provider strategy

Add Gemini as an explicit optional provider:

- `ttsProvider: "auto" | "groq" | "openai" | "gemini"`
- keep `auto` behavior unchanged for now
- label Gemini in the UI as `Gemini (Preview)`

Reasoning:

- avoids silently changing existing users' voice behavior
- lets us validate quality and reliability before touching defaults
- keeps the current Groq -> OpenAI fallback behavior intact

### Settings changes

Add a separate Gemini credential:

- `geminiApiKey?: string`

Persist it the same way other secrets are handled now:

- keep it in `chrome.storage.local`
- do not sync it

### Voice UX

Add a Gemini voice list in settings using the official prebuilt names.

Do not attempt style-tag UI in v1. The first version should only support:

- provider selection
- voice selection
- standard message read-aloud

Audio tags can be added later as an advanced option or prompt template layer.

---

## Recommended Technical Plan

### 1. Extend types and settings persistence

Update:

- `packages/shared-types/src/settings.ts`
- `apps/extension/src/utils/settings-storage.ts`

Changes:

- add `geminiApiKey?: string`
- extend `ttsProvider` union with `"gemini"`
- add local storage key for Gemini credentials

### 2. Extend the TTS request layer

Update `apps/extension/src/background/llm/audio.ts`.

Add:

- `type TTSProvider = "openai" | "groq" | "gemini"`
- Gemini endpoint constant:
  - `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent`
- Gemini request builder
- Gemini response parser
- PCM-to-WAV conversion helper

Recommended request pattern:

```ts
const response = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: wrappedPrompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
      model: "gemini-3.1-flash-tts-preview",
    }),
  },
);
```

### 3. Add a Gemini-specific prompt wrapper

OpenSidebar currently strips markdown and truncates text. Gemini needs one more step: wrap the transcript in a stable TTS prompt format so the model does not read instructions aloud.

Recommended wrapper:

```text
Convert the following transcript to speech.
Speak only the transcript.

### TRANSCRIPT
{cleanText}
```

This is directly aligned with Google's prompting guidance and reduces two known failure modes:

- classifier misses on vague prompts
- model reading notes/instructions aloud

### 4. Add retry logic for Gemini only

Google's docs explicitly call out rare `500` failures caused by text tokens being returned instead of audio tokens. Handle this in the provider layer with a narrow retry policy:

- retry on `500`
- retry at most 2 times
- short exponential backoff
- do not retry `401`, `403`, or malformed request errors

### 5. Add chunking guardrails

Current TTS truncates to 4096 characters for OpenAI. Gemini's published hard limit is much larger, but Google warns that quality drifts for audio longer than a few minutes.

Recommended v1 behavior:

- keep a conservative char cap similar to current behavior
- optionally chunk long final messages into sequential clips later
- do not try to synthesize entire long reports in one request

### 6. Extend the settings UI

Update `apps/extension/src/sidepanel/components/SettingsDrawer.tsx`.

Add:

- Gemini API key input in the Models tab
- Gemini option in the Voice tab provider selector
- Gemini voice dropdown values
- helper copy that Gemini is preview-only

### 7. Extend provider resolution in playback

Update `apps/extension/src/sidepanel/hooks/useTextToSpeech.ts`.

Changes:

- accept `geminiApiKey`
- allow explicit `"gemini"` selection
- keep `auto` preference order unchanged
- do not include Gemini in auto until reliability is measured

### 8. Add tests

Update or add tests in:

- `apps/extension/tests/background/audio.test.ts`
- `apps/extension/tests/sidepanel/voice-tts.test.ts`

Minimum new cases:

- Gemini request payload contains `responseModalities: ["AUDIO"]`
- Gemini response base64 PCM is converted into a playable WAV blob
- Gemini provider accepts only official voice names and falls back to a default voice
- Gemini retries on `500`
- explicit Gemini provider selection works
- no regression in Groq/OpenAI fallback logic

---

## Proposed Voice Mapping

For v1, keep voice handling simple:

- expose a curated subset first, not all 30, unless the UI remains readable
- default Gemini voice: `Kore`

Good initial subset:

- `Kore`
- `Puck`
- `Zephyr`
- `Leda`
- `Enceladus`
- `Charon`

Rationale: enough range for users to hear clear differences without overloading the dropdown.

---

## Risks And Constraints

### 1. Preview reliability risk

This is the main blocker to making Gemini default immediately.

Google's own docs call out:

- occasional `500` failures
- prompt-classifier false rejections
- voice inconsistency against prompt instructions
- quality drift on longer outputs

This is manageable for an optional provider. It is not yet strong enough evidence for default-provider status.

### 2. Audio conversion complexity

Gemini is not a drop-in equivalent to the current `/audio/speech` providers. The PCM-to-WAV step is straightforward, but it is extra logic that must be correct and tested.

### 3. Pricing clarity

I did **not** find a model-specific official pricing entry for `gemini-3.1-flash-tts-preview` in the current public Gemini pricing material I checked. That means cost planning should be treated as unresolved until Google publishes a dedicated pricing row or dashboard-visible rate card for this model.

### 4. UX complexity

Adding another key and another TTS provider increases configuration burden. This is acceptable only if the UI keeps Gemini clearly scoped as optional.

---

## Recommendation

Proceed with implementation if the goal is:

- broader language coverage
- more expressive voice output
- experimentation with audio tags and multi-speaker speech later

Do not make Gemini the default TTS provider yet.

Best product decision now:

- ship `Gemini (Preview)` as an opt-in provider
- keep current `auto` behavior as-is
- add retry + prompt wrapper + PCM-to-WAV conversion
- measure real-world failure rate before expanding its role

---

## Suggested Implementation Sequence

1. Add settings/type/storage support for `geminiApiKey` and `ttsProvider: "gemini"`.
2. Implement Gemini request + response conversion in `audio.ts`.
3. Add settings UI and curated Gemini voices.
4. Add retry logic and prompt wrapping.
5. Add unit tests for Gemini provider behavior.
6. Run a small manual quality pass against short assistant responses in English plus one non-English sample.
7. If stable, consider optional support for advanced audio tags.

---

## Sources

- Google launch post, April 15, 2026: <https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-tts/>
- Gemini API TTS guide, last updated April 16, 2026: <https://ai.google.dev/gemini-api/docs/speech-generation>
