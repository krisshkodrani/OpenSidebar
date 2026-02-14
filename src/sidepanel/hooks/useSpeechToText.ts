import { useEffect, useRef, useState, useCallback } from "react";

interface SpeechToTextState {
  isRecording: boolean;
  isProcessing: boolean;
  error: string | null;
  toggle: () => void;
  stop: () => void;
  isSupported: boolean;
}

export function useSpeechToText(
  provider: "browser" | "groq",
  groqApiKey: string,
  onTranscript: (text: string, isFinal: boolean) => void,
): SpeechToTextState {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef(false); // Tracks intended state (avoids stale closures)
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const SpeechRecognitionCtor =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;

  const isSupported =
    provider === "browser"
      ? !!SpeechRecognitionCtor
      : typeof MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia;

  // Cleanup helper: stop all active media
  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      recordingRef.current = false;
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  // Stop recording (public, called on send)
  const stop = useCallback(() => {
    if (provider === "browser") {
      recordingRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
    } else {
      // Groq: stopping MediaRecorder triggers onstop → upload
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
    setIsRecording(false);
  }, [provider]);

  // --- Browser Speech API ---
  const startBrowser = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setError("Speech recognition not supported in this browser");
      return;
    }
    setError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognitionRef.current = recognition;
    recordingRef.current = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) onTranscriptRef.current(final, true);
      if (interim) onTranscriptRef.current(interim, false);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" is expected when we call stop/abort
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(`Speech error: ${event.error}`);
      recordingRef.current = false;
      setIsRecording(false);
    };

    recognition.onend = () => {
      // Chrome stops after silence — auto-restart if we're still recording
      if (recordingRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      } else {
        setIsRecording(false);
      }
    };

    recognition.start();
    setIsRecording(true);
  }, [SpeechRecognitionCtor]);

  // --- Groq Whisper ---
  const startGroq = useCallback(async () => {
    if (!groqApiKey) {
      setError("Groq API key required for Whisper");
      return;
    }
    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop mic tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        if (blob.size < 100) {
          // Too short to transcribe
          setIsProcessing(false);
          return;
        }

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("file", blob, "recording.webm");
          formData.append("model", "whisper-large-v3-turbo");

          const resp = await fetch(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${groqApiKey}` },
              body: formData,
            },
          );

          if (!resp.ok) {
            const text = await resp.text().catch(() => resp.statusText);
            throw new Error(`Groq Whisper error ${resp.status}: ${text}`);
          }

          const data = (await resp.json()) as { text: string };
          if (data.text?.trim()) {
            onTranscriptRef.current(data.text.trim(), true);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Microphone access denied",
      );
      cleanup();
    }
  }, [groqApiKey, cleanup]);

  const toggle = useCallback(() => {
    if (isRecording) {
      stop();
    } else {
      if (provider === "browser") {
        startBrowser();
      } else {
        startGroq();
      }
    }
  }, [isRecording, provider, startBrowser, startGroq, stop]);

  // Cleanup on unmount or provider change
  useEffect(() => {
    return () => {
      cleanup();
      setIsRecording(false);
      setIsProcessing(false);
    };
  }, [provider, cleanup]);

  return { isRecording, isProcessing, error, toggle, stop, isSupported };
}
