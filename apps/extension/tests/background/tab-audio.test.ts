import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { TabAudioCaptureController } from "../../src/background/speech/tab-audio";

function createController(options?: { groqApiKey?: string }) {
  const updateTranscript = vi.fn(() => true);
  const setStatusDetail = vi.fn();
  const controller = new TabAudioCaptureController({
    loadSettings: async () =>
      ({
        groqApiKey: options?.groqApiKey ?? "gsk_test",
      }) as any,
    updateTranscript,
    setStatusDetail,
    now: () => 1000,
  });
  return { controller, updateTranscript, setStatusDetail };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("TabAudioCaptureController", () => {
  let sentMessages: any[];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sentMessages = [];
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(
      async (message: any) => {
        sentMessages.push(message);
      },
    );
    vi.spyOn(chrome.runtime as any, "getContexts").mockResolvedValue([]);
    vi.spyOn(chrome.offscreen, "createDocument").mockResolvedValue(undefined);
    vi.spyOn(chrome.tabCapture, "getMediaStreamId").mockImplementation(
      (_options: any, callback: (streamId?: string) => void) => {
        callback("mock-stream-id");
      },
    );
  });

  test("requires a Groq key before starting tab audio capture", async () => {
    const { controller, setStatusDetail } = createController({ groqApiKey: "" });

    await controller.start({ workspaceId: "ws-1", tabId: 123 });

    expect(setStatusDetail).toHaveBeenCalledWith(
      "ws-1",
      "Add a Groq API key to transcribe audio.",
    );
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(chrome.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
  });

  test("starts an offscreen tab audio recording session", async () => {
    const { controller, setStatusDetail } = createController();

    await controller.start({ workspaceId: "ws-1", tabId: 123 });

    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "src/offscreen/audio.html",
        reasons: ["USER_MEDIA"],
      }),
    );
    expect(chrome.tabCapture.getMediaStreamId).toHaveBeenCalledWith(
      { targetTabId: 123 },
      expect.any(Function),
    );
    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: "TAB_AUDIO_CAPTURE_START",
        target: "offscreen-audio",
        payload: expect.objectContaining({
          streamId: "mock-stream-id",
          workspaceId: "ws-1",
          tabId: 123,
        }),
      }),
    );
    expect(setStatusDetail).toHaveBeenCalledWith(
      "ws-1",
      "Watching page and tab audio.",
    );
  });

  test("transcribes tab audio chunks into the passive transcript window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ text: " meeting summary " }), {
          status: 200,
        });
      }),
    );
    const { controller, updateTranscript } = createController();
    await controller.start({ workspaceId: "ws-1", tabId: 123 });

    controller.handleMessage({
      source: "offscreen-audio",
      type: "TAB_AUDIO_CHUNK",
      payload: {
        workspaceId: "ws-1",
        tabId: 123,
        audioBase64: btoa("audio"),
        mimeType: "audio/webm;codecs=opus",
        startedAt: 500,
        endedAt: 1000,
      },
    });
    await flushAsyncWork();

    expect(updateTranscript).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        source: "tabAudio",
        text: "meeting summary",
        startedAt: 500,
        endedAt: 1000,
        chunkCount: 1,
      }),
    );
  });

  test("clears transcripts on navigation and stops orphaned offscreen capture", async () => {
    const { controller, updateTranscript } = createController();
    await controller.start({ workspaceId: "ws-1", tabId: 123 });

    controller.clearTranscriptsForTab(123);
    controller.handleMessage({
      source: "offscreen-audio",
      type: "TAB_AUDIO_CHUNK",
      payload: {
        workspaceId: "missing-ws",
        tabId: 123,
        audioBase64: btoa("audio"),
        mimeType: "audio/webm",
        startedAt: 500,
        endedAt: 1000,
      },
    });
    await flushAsyncWork();

    expect(updateTranscript).toHaveBeenCalledWith("ws-1", null);
    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: "TAB_AUDIO_CAPTURE_STOP",
        target: "offscreen-audio",
        payload: { workspaceId: "missing-ws" },
      }),
    );
  });
});
