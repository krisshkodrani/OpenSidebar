/**
 * Audio transcription and speech client.
 * STT uses Groq/OpenAI Whisper first, then Gemini audio understanding.
 */

import type { TTSStylePreset } from "../../types";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const GEMINI_STT_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";
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
type STTProvider = "groq" | "openai" | "gemini";

export interface TranscriptionResult {
  text: string;
  provider: STTProvider;
  durationMs: number;
}

type OpenAICompatibleSTTProvider = {
  kind: "openai-compatible";
  url: string;
  apiKey: string;
  model: string;
  provider: "groq" | "openai";
};

type GeminiSTTProvider = {
  kind: "gemini";
  apiKey: string;
  provider: "gemini";
};

type STTProviderConfig = OpenAICompatibleSTTProvider | GeminiSTTProvider;

/**
 * Transcribe an audio blob using the best available provider.
 * Priority: Groq Whisper (cheaper, faster) -> OpenAI Whisper -> Gemini.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  keys: { groqApiKey?: string; openaiApiKey?: string; geminiApiKey?: string },
  language?: string,
): Promise<TranscriptionResult> {
  const providers: STTProviderConfig[] = [];

  if (keys.groqApiKey) {
    providers.push({
      kind: "openai-compatible",
      url: GROQ_STT_URL,
      apiKey: keys.groqApiKey,
      model: GROQ_STT_MODEL,
      provider: "groq",
    });
  }
  if (keys.openaiApiKey) {
    providers.push({
      kind: "openai-compatible",
      url: OPENAI_STT_URL,
      apiKey: keys.openaiApiKey,
      model: OPENAI_STT_MODEL,
      provider: "openai",
    });
  }
  if (keys.geminiApiKey) {
    providers.push({
      kind: "gemini",
      apiKey: keys.geminiApiKey,
      provider: "gemini",
    });
  }

  if (providers.length === 0) {
    throw new Error("No API key available for speech-to-text (need Groq, OpenAI, or Gemini key)");
  }

  let lastError: Error | null = null;

  for (const p of providers) {
    const start = Date.now();
    try {
      if (p.kind === "gemini") {
        const text = await transcribeGeminiAudio(audioBlob, p.apiKey, language);
        return {
          text: text.trim(),
          provider: p.provider,
          durationMs: Date.now() - start,
        };
      }

      const formData = new FormData();
      formData.append("file", audioBlob, getAudioFilename(audioBlob));
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

const GEMINI_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

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

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") {
    throw new Error("No base64 encoder available for Gemini audio.");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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

function normalizeAudioMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase();
  if (base === "audio/mpeg" || base === "audio/x-mp3") return "audio/mp3";
  if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
  return base || "application/octet-stream";
}

function getAudioFilename(audioBlob: Blob): string {
  const mimeType = normalizeAudioMimeType(audioBlob.type);
  if (mimeType === "audio/wav") return "recording.wav";
  if (mimeType === "audio/mp3") return "recording.mp3";
  if (mimeType === "audio/aiff") return "recording.aiff";
  if (mimeType === "audio/aac") return "recording.aac";
  if (mimeType === "audio/ogg") return "recording.ogg";
  if (mimeType === "audio/flac") return "recording.flac";
  return "recording.webm";
}

function createMonoWavFromAudioBuffer(audioBuffer: AudioBuffer): Blob {
  const { length, numberOfChannels, sampleRate } = audioBuffer;
  const dataLength = length * 2;
  const header = createWavHeader(dataLength, sampleRate, 1, 16);
  const pcm = new ArrayBuffer(dataLength);
  const view = new DataView(pcm);
  const channels = Array.from({ length: numberOfChannels }, (_, index) =>
    audioBuffer.getChannelData(index),
  );

  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (const channel of channels) {
      sample += channel[i] ?? 0;
    }
    sample = Math.max(-1, Math.min(1, sample / Math.max(1, numberOfChannels)));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([header, pcm], { type: "audio/wav" });
}

async function convertAudioBlobToWav(audioBlob: Blob): Promise<Blob> {
  const AudioContextCtor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error(
      "Gemini STT needs WAV/MP3/AIFF/AAC/OGG/FLAC audio or browser audio decoding support.",
    );
  }

  const audioContext = new AudioContextCtor();
  try {
    const decoded = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
    return createMonoWavFromAudioBuffer(decoded);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

async function toGeminiInlineAudio(audioBlob: Blob): Promise<{ data: string; mimeType: string }> {
  const originalMimeType = normalizeAudioMimeType(audioBlob.type);
  const blobForGemini = GEMINI_SUPPORTED_AUDIO_MIME_TYPES.has(originalMimeType)
    ? audioBlob
    : await convertAudioBlobToWav(audioBlob);
  const mimeType = normalizeAudioMimeType(blobForGemini.type);
  const bytes = new Uint8Array(await blobForGemini.arrayBuffer());
  return { data: encodeBase64(bytes), mimeType };
}

function buildGeminiSttPrompt(language?: string): string {
  return [
    "Generate a transcript of the speech in this audio.",
    language
      ? `The spoken language hint is ${language}.`
      : "Detect the spoken language automatically.",
    "Return only the words spoken, with no commentary, labels, timestamps, or markdown.",
    "If there is no intelligible speech, return an empty string.",
  ].join("\n");
}

function extractGeminiText(data: GeminiGenerateContentResponse): string {
  const parts =
    data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  if (parts.length === 0) {
    throw new Error("Gemini STT returned no transcript.");
  }
  const text = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return text;
}

async function transcribeGeminiAudio(
  audioBlob: Blob,
  apiKey: string,
  language?: string,
): Promise<string> {
  const audio = await toGeminiInlineAudio(audioBlob);
  const response = await fetch(GEMINI_STT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildGeminiSttPrompt(language) },
            {
              inlineData: {
                mimeType: audio.mimeType,
                data: audio.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini STT error ${response.status}: ${errText.slice(0, 200)}`);
  }

  return extractGeminiText((await response.json()) as GeminiGenerateContentResponse);
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
