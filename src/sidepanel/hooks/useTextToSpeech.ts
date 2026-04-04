/**
 * useTextToSpeech — React hook for OpenAI TTS playback.
 *
 * Calls OpenAI /audio/speech endpoint, plays the returned audio blob
 * via the Audio() constructor in the side panel.
 */

import { useState, useRef, useCallback } from "react";
import { synthesizeSpeech } from "../../background/llm/audio";

export interface TextToSpeechState {
  isSpeaking: boolean;
  error: string | null;
}

export interface TextToSpeechActions {
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

export function useTextToSpeech(
  apiKey: string | undefined,
  voice?: string,
): TextToSpeechState & TextToSpeechActions {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!apiKey) {
        setError("OpenAI API key required for text-to-speech.");
        return;
      }
      if (!text.trim()) return;

      // Stop any current playback
      stop();
      setError(null);

      try {
        const blob = await synthesizeSpeech({
          text: text.slice(0, 4096), // OpenAI TTS max ~4096 chars
          apiKey,
          voice: voice || "nova",
        });

        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          stop();
        };
        audio.onerror = () => {
          setError("Audio playback failed.");
          stop();
        };

        setIsSpeaking(true);
        await audio.play();
      } catch (err: any) {
        setError(err.message || "Text-to-speech failed.");
        setIsSpeaking(false);
      }
    },
    [apiKey, voice, stop],
  );

  return { isSpeaking, error, speak, stop };
}
