import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

export type SpeechRecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

interface SpeechTranscriptionResponse {
  ok?: boolean;
  text?: string;
  detail?: string;
  durationMs?: number;
}

function preferredMimeType(): string | undefined {
  const recorder = globalThis.MediaRecorder as
    | {
        isTypeSupported?: (mimeType: string) => boolean;
      }
    | undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => recorder?.isTypeSupported?.(candidate));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useSpeechRecorder(options: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}): {
  state: SpeechRecorderState;
  isActive: boolean;
  toggle: () => Promise<void>;
  cancel: () => void;
} {
  const { disabled, onTranscript } = options;
  const settings = useStore((s) => s.settings);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const setError = useStore((s) => s.setError);
  const [state, setState] = useState<SpeechRecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const transcribingRef = useRef(false);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const finishRecording = useCallback(
    async (mimeType: string) => {
      const chunks = chunksRef.current;
      cleanupStream();
      if (cancelledRef.current) {
        cancelledRef.current = false;
        if (mountedRef.current) setState("idle");
        return;
      }
      if (chunks.length === 0) {
        if (mountedRef.current) {
          setError("No audio was recorded.");
          setState("idle");
        }
        return;
      }

      transcribingRef.current = true;
      if (mountedRef.current) setState("transcribing");
      try {
        const audio = new Blob(chunks, { type: mimeType || "audio/webm" });
        const audioBase64 = await blobToBase64(audio);
        const response =
          await uiRuntime.sendMessage<SpeechTranscriptionResponse>({
            type: "SPEECH_TRANSCRIPTION_REQUEST",
            requestId: crypto.randomUUID(),
            source: uiRuntime.source,
            workspaceId: activeWorkspaceId,
            payload: {
              audioBase64,
              mimeType: audio.type || "audio/webm",
              workspaceId: activeWorkspaceId,
            },
          });
        if (!mountedRef.current) return;
        if (response?.ok && response.text?.trim()) {
          onTranscript(response.text.trim());
        } else {
          setError(response?.detail || "Audio transcription failed.");
        }
      } catch (error: any) {
        logger.warn("ui", "Speech transcription request failed", { error });
        if (mountedRef.current) {
          setError(error?.message ?? "Audio transcription failed.");
        }
      } finally {
        transcribingRef.current = false;
        if (mountedRef.current) setState("idle");
      }
    },
    [activeWorkspaceId, cleanupStream, onTranscript, setError],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanupStream();
      setState("idle");
    }
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (disabled || state !== "idle") return;
    if (!settings.groqApiKey?.trim()) {
      setError("Add a Groq API key in Settings to use speech transcription.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone capture is not available in this browser context.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Audio recording is not available in this browser context.");
      return;
    }

    cancelledRef.current = false;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Audio recording failed.");
        cancel();
      };
      recorder.onstop = () => {
        void finishRecording(recorder.mimeType || mimeType || "audio/webm");
      };
      recorder.start();
      setState("recording");
    } catch (error: any) {
      cleanupStream();
      logger.warn("ui", "Microphone recording failed", { error });
      setError(error?.message ?? "Microphone access was not granted.");
      setState("idle");
    }
  }, [
    cancel,
    cleanupStream,
    disabled,
    finishRecording,
    setError,
    settings.groqApiKey,
    state,
  ]);

  const toggle = useCallback(async () => {
    if (state === "recording" || state === "requesting") {
      stop();
      return;
    }
    if (state === "idle") {
      await start();
    }
  }, [start, state, stop]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    state,
    isActive: state !== "idle" || transcribingRef.current,
    toggle,
    cancel,
  };
}
