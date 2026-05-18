import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { useSpeechRecorder } from "../../src/sidepanel/hooks/useSpeechRecorder";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

type SpeechRecorder = ReturnType<typeof useSpeechRecorder>;

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(
    _stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: this.mimeType }),
    } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }
}

function HookHarness({
  onReady,
  onTranscript,
}: {
  onReady: (recorder: SpeechRecorder) => void;
  onTranscript: (text: string) => void;
}) {
  const recorder = useSpeechRecorder({ onTranscript });
  onReady(recorder);
  return null;
}

describe("useSpeechRecorder", () => {
  let container: HTMLDivElement;
  let root: Root;
  let recorder: SpeechRecorder;
  let onTranscript: ReturnType<typeof vi.fn>;
  let stopTrack: ReturnType<typeof vi.fn>;
  const originalMediaRecorder = globalThis.MediaRecorder;

  beforeEach(async () => {
    onTranscript = vi.fn();
    stopTrack = vi.fn();
    (globalThis as any).MediaRecorder = FakeMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopTrack }],
        })),
      },
    });
    (chrome.runtime.sendMessage as any) = vi.fn(async () => ({
      ok: true,
      text: "transcribed speech",
    }));
    useStore.setState({
      activeWorkspaceId: "ws-speech",
      settings: { ...DEFAULT_SETTINGS, groqApiKey: "gsk_test" },
      error: null,
      errorPersistent: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <HookHarness
          onReady={(nextRecorder) => {
            recorder = nextRecorder;
          }}
          onTranscript={onTranscript}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).MediaRecorder = originalMediaRecorder;
  });

  test("records audio and inserts returned transcript", async () => {
    await act(async () => {
      await recorder.toggle();
    });
    expect(recorder.state).toBe("recording");

    await act(async () => {
      await recorder.toggle();
    });

    await vi.waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("transcribed speech"),
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SPEECH_TRANSCRIPTION_REQUEST",
        payload: expect.objectContaining({
          mimeType: "audio/webm;codecs=opus",
          workspaceId: "ws-speech",
        }),
      }),
    );
    expect(stopTrack).toHaveBeenCalled();
  });

  test("requires a Groq key before recording", async () => {
    await act(async () => {
      useStore.setState({
        settings: { ...DEFAULT_SETTINGS, groqApiKey: "" },
      });
    });
    await act(async () => {
      await recorder.toggle();
    });

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBe(
      "Add a Groq API key in Settings to use speech transcription.",
    );
  });
});
