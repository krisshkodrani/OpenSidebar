/**
 * useSpeechToText — React hook for microphone recording + Whisper transcription.
 *
 * Flow:
 * 1. Check mic permission → if denied, open request-mic.html in a new tab
 * 2. Record via MediaRecorder (webm/opus)
 * 3. On stop, send blob to Groq or OpenAI Whisper
 * 4. Return transcribed text
 */

import { useState, useRef, useCallback } from "react";
import { transcribeAudio } from "../../background/llm/audio";

export interface SpeechToTextState {
  isRecording: boolean;
  isTranscribing: boolean;
  transcript: string | null;
  error: string | null;
}

export interface SpeechToTextActions {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearTranscript: () => void;
}

export function useSpeechToText(
  keys: { groqApiKey?: string; openaiApiKey?: string },
): SpeechToTextState & SpeechToTextActions {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (result.state === "granted") return true;
      if (result.state === "denied") {
        setError("Microphone access denied. Check Chrome settings.");
        return false;
      }
      // state === "prompt" — need to open request page in a new tab
      // sidePanel can't show the permission prompt
      const micUrl = chrome.runtime.getURL("public/request-mic.html");
      await chrome.tabs.create({ url: micUrl, active: true });
      // Wait for permission to be granted (poll up to 30s)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const check = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (check.state === "granted") return true;
        if (check.state === "denied") {
          setError("Microphone access denied.");
          return false;
        }
      }
      setError("Microphone permission timed out.");
      return false;
    } catch {
      // Fallback: try getUserMedia directly (some browsers don't support permissions.query for mic)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        return true;
      } catch {
        setError("Could not access microphone.");
        return false;
      }
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript(null);

    const hasPermission = await ensureMicPermission();
    if (!hasPermission) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) {
          setError("Recording too short.");
          return;
        }

        setIsTranscribing(true);
        try {
          const result = await transcribeAudio(blob, keys);
          if (result.text) {
            setTranscript(result.text);
          } else {
            setError("No speech detected.");
          }
        } catch (err: any) {
          setError(err.message || "Transcription failed.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err: any) {
      setError(err.message || "Could not start recording.");
    }
  }, [keys, ensureMicPermission]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript(null);
    setError(null);
  }, []);

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopRecording,
    clearTranscript,
  };
}
