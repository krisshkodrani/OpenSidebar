const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface GroqSpeechTranscriptionInput {
  apiKey: string | undefined;
  audioBase64: string;
  mimeType: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface GroqSpeechTranscriptionResult {
  text: string;
  durationMs: number;
}

function normalizeApiKey(apiKey: string | undefined): string {
  return apiKey?.trim() ?? "";
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("m4a")) return "m4a";
  return "webm";
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(",");
  return value.startsWith("data:") && commaIndex !== -1
    ? value.slice(commaIndex + 1)
    : value;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = stripDataUrlPrefix(base64).replace(/\s+/g, "");
  if (!clean) return new Uint8Array();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function responseDetail(status: number, bodyText: string): string {
  const parsed = (() => {
    try {
      const json = JSON.parse(bodyText) as {
        error?: { message?: unknown };
      };
      return typeof json.error?.message === "string"
        ? json.error.message.trim()
        : "";
    } catch {
      return "";
    }
  })();
  if (parsed) return parsed.slice(0, 180);
  if (status === 401 || status === 403) {
    return "Groq rejected the API key.";
  }
  if (status === 413) return "The audio clip is too large to transcribe.";
  return "Groq could not transcribe the audio.";
}

export async function transcribeWithGroq(
  input: GroqSpeechTranscriptionInput,
): Promise<GroqSpeechTranscriptionResult> {
  const apiKey = normalizeApiKey(input.apiKey);
  if (!apiKey) throw new Error("Add a Groq API key to transcribe audio.");

  const mimeType = input.mimeType.trim() || "audio/webm";
  const bytes = base64ToBytes(input.audioBase64);
  if (bytes.byteLength === 0) throw new Error("No audio was recorded.");
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("The audio clip is too large to transcribe.");
  }

  const startedAt = input.now?.() ?? Date.now();
  const form = new FormData();
  const filename = `opensidebar-audio.${extensionForMimeType(mimeType)}`;
  const audioBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
  form.append("model", DEFAULT_GROQ_STT_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  const language = input.language?.trim();
  if (language) form.append("language", language);
  const prompt = input.prompt?.trim();
  if (prompt) form.append("prompt", prompt.slice(0, 900));

  const fetchImpl = input.fetchFn ?? fetch;
  const response = await fetchImpl(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: input.signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(responseDetail(response.status, bodyText));
  }

  let text = "";
  try {
    const json = JSON.parse(bodyText) as { text?: unknown };
    text = typeof json.text === "string" ? json.text : "";
  } catch {
    text = bodyText;
  }

  return {
    text: text.replace(/\s+/g, " ").trim(),
    durationMs: Math.max(0, (input.now?.() ?? Date.now()) - startedAt),
  };
}
