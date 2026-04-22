/**
 * Audio transcription client — calls Groq or OpenAI Whisper API.
 * Both use identical OpenAI-compatible multipart form endpoints.
 */

import type { TTSStylePreset } from "../../types";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_STT_MODEL = "whisper-large-v3-turbo";
const OPENAI_STT_MODEL = "whisper-1";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent";
const OPENAI_TTS_MODEL = "tts-1";
const GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english";
const GEMINI_TTS_SAMPLE_RATE = 24000;

export type TTSProvider = "openai" | "groq" | "gemini";

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
  stylePreset?: TTSStylePreset;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
  }>;
}

const GEMINI_STYLE_TAGS: Record<TTSStylePreset, string | null> = {
  neutral: null,
  friendly: "[friendly, warm]",
  calm: "[calm, steady, reassuring]",
  excited: "[excitedly, upbeat, energetic]",
  serious: "[serious, clear, deliberate]",
};

function buildGeminiTtsPrompt(text: string, stylePreset: TTSStylePreset = "neutral"): string {
  const styleTag = GEMINI_STYLE_TAGS[stylePreset];
  return [
    "Convert the following transcript to speech.",
    "Speak only the transcript.",
    "Do not read the instructions aloud.",
    "Use bracketed tags only as delivery directions.",
    "",
    "### TRANSCRIPT",
    styleTag ? `${styleTag}\n${text}` : text,
  ].join("\n");
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error("No base64 decoder available for Gemini TTS audio.");
}

function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  return header;
}

function extractGeminiSampleRate(mimeType?: string): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : GEMINI_TTS_SAMPLE_RATE;
}

function extractGeminiAudioBlob(data: GeminiGenerateContentResponse): Blob {
  const parts =
    data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const audioPart = parts.find((part) => part.inlineData?.data);
  const base64 = audioPart?.inlineData?.data;
  if (!base64) {
    throw new Error("Gemini TTS returned no audio data.");
  }

  const pcmBytes = decodeBase64(base64);
  const sampleRate = extractGeminiSampleRate(audioPart.inlineData?.mimeType);
  const wavHeader = createWavHeader(pcmBytes.byteLength, sampleRate);
  const pcmBuffer = new ArrayBuffer(pcmBytes.byteLength);
  new Uint8Array(pcmBuffer).set(pcmBytes);
  return new Blob([wavHeader, pcmBuffer], { type: "audio/wav" });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeGeminiSpeech(options: TTSOptions): Promise<Blob> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(GEMINI_TTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildGeminiTtsPrompt(options.text, options.stylePreset) }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: options.voice || "Kore",
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        const error = new Error(`Gemini TTS error ${response.status}: ${errText.slice(0, 200)}`) as Error & {
          retryable?: boolean;
        };
        error.retryable = response.status >= 500 || response.status === 429;
        throw error;
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      return extractGeminiAudioBlob(data);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable =
        Boolean((err as { retryable?: boolean })?.retryable) ||
        /no audio data/i.test(lastError.message);
      if (retryable && attempt < 2) {
        await delay(200 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new Error("Gemini TTS failed.");
}

/**
 * Generate speech audio from text using the selected provider.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Blob> {
  if (options.provider === "gemini") {
    return synthesizeGeminiSpeech(options);
  }

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
