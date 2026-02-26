import { useEffect, useRef, useState, useCallback } from "react";

interface SpeechToTextState {
  isRecording: boolean;
  isProcessing: boolean;
  error: string | null;
  toggle: () => void;
  stop: () => void;
  isSupported: boolean;
}

/**
 * Chrome extension side panels cannot show permission prompts — they get
 * auto-dismissed. This helper checks the current microphone permission state
 * and, if not yet granted, opens a dedicated extension page in a new tab
 * where the user can grant access. Returns true when permission is available.
 */
async function ensureMicPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (status.state === "granted") return true;

    // Permission not yet granted — open the permission page in a tab.
    // The page calls getUserMedia() which CAN show the prompt from a tab context.
    const url = chrome.runtime.getURL("src/permissions/microphone.html");
    const tab = await chrome.tabs.create({ url, active: true });

    // Wait for either the tab to close or a MIC_PERMISSION_GRANTED message
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (granted: boolean) => {
        if (resolved) return;
        resolved = true;
        chrome.runtime.onMessage.removeListener(msgListener);
        chrome.tabs.onRemoved.removeListener(tabListener);
        resolve(granted);
      };

      const msgListener = (msg: { type?: string }) => {
        if (msg.type === "MIC_PERMISSION_GRANTED") done(true);
      };

      const tabListener = (closedTabId: number) => {
        if (closedTabId === tab.id) {
          // Tab closed — check if permission was granted before closing
          navigator.permissions
            .query({ name: "microphone" as PermissionName })
            .then((s) => done(s.state === "granted"))
            .catch(() => done(false));
        }
      };

      chrome.runtime.onMessage.addListener(msgListener);
      chrome.tabs.onRemoved.addListener(tabListener);
    });
  } catch {
    // Permissions API not available — try getUserMedia directly
    return true;
  }
}

/**
 * Groq Whisper speech-to-text hook.
 * Visible only when a Groq API key is configured.
 */
export function useSpeechToText(
  groqApiKey: string,
  onTranscript: (text: string, isFinal: boolean) => void,
): SpeechToTextState {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const isSupported =
    !!groqApiKey &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  // Cleanup helper: stop all active media
  const cleanup = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
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
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const startGroq = useCallback(async () => {
    if (!groqApiKey) {
      setError("Groq API key required for Whisper");
      return;
    }
    setError(null);
    chunksRef.current = [];

    // Ensure mic permission is granted (side panel can't show prompts)
    const permitted = await ensureMicPermission();
    if (!permitted) {
      setError("Microphone permission required for voice input");
      return;
    }

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
      setError(err instanceof Error ? err.message : "Microphone access denied");
      cleanup();
    }
  }, [groqApiKey, cleanup]);

  const toggle = useCallback(() => {
    if (isRecording) {
      stop();
    } else {
      startGroq();
    }
  }, [isRecording, startGroq, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      setIsRecording(false);
      setIsProcessing(false);
    };
  }, [cleanup]);

  return { isRecording, isProcessing, error, toggle, stop, isSupported };
}
