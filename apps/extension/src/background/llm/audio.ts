/**
 * Audio transcription client — calls Groq or OpenAI Whisper API.
 * Both use identical OpenAI-compatible multipart form endpoints.
 */

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_STT_MODEL = "whisper-large-v3-turbo";
const OPENAI_STT_MODEL = "whisper-1";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const OPENAI_TTS_MODEL = "tts-1";
const GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english";

export type TTSProvider = "openai" | "groq";

export interface TranscriptionResult {
  text: string;
  provider: "groq" | "openai";
  durationMs: number;
}

/**
 * Transcribe an audio blob using the best available provider.
 * Priority: Groq Whisper (cheaper, faster) → OpenAI Whisper (fallback).
 */
export async function transcribeAudio(
  audioBlob: Blob,
  keys: { groqApiKey?: string; openaiApiKey?: string },
  language?: string,
): Promise<TranscriptionResult> {
  const providers: Array<{
    url: string;
    apiKey: string;
    model: string;
    provider: "groq" | "openai";
  }> = [];

  if (keys.groqApiKey) {
    providers.push({
      url: GROQ_STT_URL,
      apiKey: keys.groqApiKey,
      model: GROQ_STT_MODEL,
      provider: "groq",
    });
  }
  if (keys.openaiApiKey) {
    providers.push({
      url: OPENAI_STT_URL,
      apiKey: keys.openaiApiKey,
      model: OPENAI_STT_MODEL,
      provider: "openai",
    });
  }

  if (providers.length === 0) {
    throw new Error("No API key available for speech-to-text (need Groq or OpenAI key)");
  }

  let lastError: Error | null = null;

  for (const p of providers) {
    const start = Date.now();
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");
      formData.append("model", p.model);
      if (language) formData.append("language", language);
      formData.append("response_format", "json");

      const response = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${p.provider} STT error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = (await response.json()) as { text: string };
      return {
        text: data.text.trim(),
        provider: p.provider,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      lastError = err;
      // Try next provider
    }
  }

  throw lastError!;
}

export interface TTSOptions {
  text: string;
  provider: TTSProvider;
  apiKey: string;
  voice?: string;
  model?: string;
  speed?: number;
}

/**
 * Generate speech audio from text using the selected provider.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Blob> {
  const isGroq = options.provider === "groq";
  const response = await fetch(isGroq ? GROQ_TTS_URL : OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || (isGroq ? GROQ_TTS_MODEL : OPENAI_TTS_MODEL),
      input: options.text,
      voice: options.voice || (isGroq ? "hannah" : "nova"),
      response_format: isGroq ? "wav" : "mp3",
      ...(isGroq ? {} : { speed: options.speed ?? 1.0 }),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const label = isGroq ? "Groq" : "OpenAI";
    throw new Error(`${label} TTS error ${response.status}: ${errText.slice(0, 200)}`);
  }

  return response.blob();
}
