/**
 * useTextToSpeech — React hook for OpenAI TTS playback.
 *
 * Module-level singleton ensures only one audio stream plays at a time
 * across all hook instances (e.g. multiple MessageBubbles).
 *
 * Strips markdown before sending to TTS so speech sounds natural.
 */

import { useState, useCallback, useEffect } from "react";
import { synthesizeSpeech, TTSProvider } from "../../background/llm/audio";
import { stripMarkdownForTTS } from "../../utils/strip-markdown";

// ── Global singleton ────────────────────────────────────────────────
// Only one audio element exists at a time, shared across all hook instances.

let globalAudio: HTMLAudioElement | null = null;
let globalUrl: string | null = null;
let speakGeneration = 0; // monotonic counter to cancel stale in-flight requests
const listeners = new Set<() => void>();

// ── TTS audio cache ────────────────────────────────────────────────
// Caches synthesized audio blobs keyed by provider:voice:text.
// Avoids redundant API calls when replaying the same message.
const TTS_CACHE_MAX = 50;
const ttsCache = new Map<string, Blob>();

function ttsCacheKey(provider: string, voice: string, text: string): string {
  return `${provider}:${voice}:${text}`;
}

/** Clear the in-memory TTS audio cache. Called on history/data clear. */
export function clearTTSCache(): void {
  ttsCache.clear();
}

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/** Stop any currently playing TTS audio. Safe to call from anywhere. */
export function stopCurrentTTS() {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.currentTime = 0;
    globalAudio = null;
  }
  if (globalUrl) {
    URL.revokeObjectURL(globalUrl);
    globalUrl = null;
  }
  notifyListeners();
}

/** Is any TTS audio currently playing? */
export function isTTSPlaying(): boolean {
  return globalAudio !== null && !globalAudio.paused;
}

/**
 * Play text through OpenAI TTS. Stops any current playback first.
 * Strips markdown and truncates to 4096 chars (OpenAI limit).
 * Returns a promise that resolves when audio starts playing.
 */
function resolveTTSProvider(
  keys: { groqApiKey?: string; openaiApiKey?: string },
  preferred?: "auto" | TTSProvider,
): { provider: TTSProvider; apiKey: string } | null {
  if (preferred === "openai" && keys.openaiApiKey) {
    return { provider: "openai", apiKey: keys.openaiApiKey };
  }
  if (preferred === "groq" && keys.groqApiKey) {
    return { provider: "groq", apiKey: keys.groqApiKey };
  }
  if (keys.groqApiKey) {
    return { provider: "groq", apiKey: keys.groqApiKey };
  }
  if (keys.openaiApiKey) {
    return { provider: "openai", apiKey: keys.openaiApiKey };
  }
  return null;
}

export async function speakText(
  text: string,
  keys: { groqApiKey?: string; openaiApiKey?: string },
  voice: string,
  preferredProvider?: "auto" | TTSProvider,
): Promise<void> {
  stopCurrentTTS();
  const gen = ++speakGeneration; // claim this generation

  const clean = stripMarkdownForTTS(text);
  if (!clean) return;

  const resolved = resolveTTSProvider(keys, preferredProvider);
  if (!resolved) {
    throw new Error("Groq or OpenAI API key required for text-to-speech.");
  }

  // Map voice to valid options per provider — don't send OpenAI voices to Groq or vice versa
  const GROQ_VOICES = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
  const OPENAI_VOICES = new Set(["nova", "alloy", "echo", "shimmer", "onyx", "fable"]);
  const resolvedVoice = resolved.provider === "groq"
    ? (GROQ_VOICES.has(voice) ? voice : "hannah")
    : (OPENAI_VOICES.has(voice) ? voice : "nova");

  const limit = 4096;
  const truncated = clean.slice(0, limit);
  const wasClipped = clean.length > limit;

  // Check cache before making an API call
  const cacheKey = ttsCacheKey(resolved.provider, resolvedVoice, truncated);
  let blob = ttsCache.get(cacheKey);

  if (!blob) {
    try {
      blob = await synthesizeSpeech({
        text: truncated,
        provider: resolved.provider,
        apiKey: resolved.apiKey,
        voice: resolvedVoice,
      });
    } catch (err: any) {
      // Fallback: if Groq TTS failed and we have an OpenAI key, retry with OpenAI
      if (resolved.provider === "groq" && keys.openaiApiKey) {
        console.warn("[TTS] Groq failed, falling back to OpenAI:", err.message);
        const fallbackVoice = OPENAI_VOICES.has(voice) ? voice : "nova";
        blob = await synthesizeSpeech({
          text: clean.slice(0, 4096),
          provider: "openai",
          apiKey: keys.openaiApiKey,
          voice: fallbackVoice,
        });
      } else {
        throw err;
      }
    }

    // Store in cache, evict oldest if full
    if (ttsCache.size >= TTS_CACHE_MAX) {
      const oldest = ttsCache.keys().next().value!;
      ttsCache.delete(oldest);
    }
    ttsCache.set(cacheKey, blob);
  }

  // Another speakText call arrived while we were fetching — discard this result
  if (gen !== speakGeneration) return;

  const url = URL.createObjectURL(blob);
  globalUrl = url;

  const audio = new Audio(url);
  globalAudio = audio;

  audio.onended = () => {
    stopCurrentTTS();
  };
  audio.onerror = () => {
    stopCurrentTTS();
  };

  notifyListeners();
  await audio.play();

  if (wasClipped) {
    console.warn(
      `[TTS] Text was truncated from ${clean.length} to ${limit} chars for ${resolved.provider}`,
    );
  }
}

// ── React hook ──────────────────────────────────────────────────────

export interface TextToSpeechState {
  isSpeaking: boolean;
  error: string | null;
}

export interface TextToSpeechActions {
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

export function useTextToSpeech(
  keys: { groqApiKey?: string; openaiApiKey?: string },
  provider?: "auto" | TTSProvider,
  voice?: string,
): TextToSpeechState & TextToSpeechActions {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to global audio state changes
  useEffect(() => {
    const sync = () => setIsSpeaking(isTTSPlaying());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const stop = useCallback(() => {
    stopCurrentTTS();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!keys.groqApiKey && !keys.openaiApiKey) {
        setError("Groq or OpenAI API key required for text-to-speech.");
        return;
      }
      if (!text.trim()) return;

      setError(null);

      try {
        await speakText(text, keys, voice || "nova", provider);
        setIsSpeaking(true);
      } catch (err: any) {
        setError(err.message || "Text-to-speech failed.");
        setIsSpeaking(false);
      }
    },
    [keys, provider, voice],
  );

  return { isSpeaking, error, speak, stop };
}
