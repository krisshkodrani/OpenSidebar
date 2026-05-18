interface StartTabAudioCaptureMessage {
  type: "TAB_AUDIO_CAPTURE_START";
  target: "offscreen-audio";
  requestId: string;
  payload: {
    streamId: string;
    tabId: number;
    workspaceId: string;
    chunkMs: number;
  };
}

interface StopTabAudioCaptureMessage {
  type: "TAB_AUDIO_CAPTURE_STOP";
  target: "offscreen-audio";
  requestId: string;
  payload?: {
    workspaceId?: string;
  };
}

type OffscreenAudioMessage =
  | StartTabAudioCaptureMessage
  | StopTabAudioCaptureMessage;

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let currentWorkspaceId: string | null = null;
let currentTabId: number | null = null;
let chunkStartedAt = 0;

function stopCapture(): void {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
  recorder = null;
  sourceNode?.disconnect();
  sourceNode = null;
  void audioContext?.close().catch(() => {});
  audioContext = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  currentWorkspaceId = null;
  currentTabId = null;
  chunkStartedAt = 0;
}

function preferredMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function sendStatus(status: "recording" | "stopped" | "error", detail?: string) {
  chrome.runtime.sendMessage({
    source: "offscreen-audio",
    type: "TAB_AUDIO_CAPTURE_STATUS",
    payload: {
      workspaceId: currentWorkspaceId,
      tabId: currentTabId,
      status,
      detail,
      timestamp: Date.now(),
    },
  });
}

async function startCapture(message: StartTabAudioCaptureMessage): Promise<void> {
  stopCapture();
  currentWorkspaceId = message.payload.workspaceId;
  currentTabId = message.payload.tabId;
  const media = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.payload.streamId,
      },
    } as MediaTrackConstraints,
    video: false,
  });
  stream = media;
  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(media);
  sourceNode.connect(audioContext.destination);

  const mimeType = preferredMimeType();
  recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (!event.data.size || !currentWorkspaceId || currentTabId == null) return;
    const startedAt = chunkStartedAt || Date.now();
    const endedAt = Date.now();
    chunkStartedAt = endedAt;
    void blobToBase64(event.data).then((audioBase64) => {
      chrome.runtime.sendMessage({
        source: "offscreen-audio",
        type: "TAB_AUDIO_CHUNK",
        payload: {
          workspaceId: currentWorkspaceId,
          tabId: currentTabId,
          audioBase64,
          mimeType: event.data.type || recorder?.mimeType || "audio/webm",
          startedAt,
          endedAt,
        },
      });
    });
  };
  recorder.onerror = () => {
    sendStatus("error", "Tab audio recording failed.");
    stopCapture();
  };
  chunkStartedAt = Date.now();
  recorder.start(Math.max(10_000, message.payload.chunkMs));
  sendStatus("recording");
}

chrome.runtime.onMessage.addListener((message: OffscreenAudioMessage) => {
  if (message.target !== "offscreen-audio") return false;
  if (message.type === "TAB_AUDIO_CAPTURE_START") {
    void startCapture(message).catch((error: any) => {
      sendStatus(
        "error",
        error?.message ? `Could not read audio: ${error.message}` : undefined,
      );
      stopCapture();
    });
    return true;
  }
  if (message.type === "TAB_AUDIO_CAPTURE_STOP") {
    const workspaceId = currentWorkspaceId;
    const tabId = currentTabId;
    stopCapture();
    chrome.runtime.sendMessage({
      source: "offscreen-audio",
      type: "TAB_AUDIO_CAPTURE_STATUS",
      payload: {
        workspaceId,
        tabId,
        status: "stopped",
        timestamp: Date.now(),
      },
    });
    return true;
  }
  return false;
});
