import type { PassiveAudioTranscriptWindow } from "../passive-monitor";
import type { UserSettings } from "../../types";
import { logger } from "../../utils";
import { transcribeWithGroq } from "./groq";

const OFFSCREEN_AUDIO_PATH = "src/offscreen/audio.html";
const TAB_AUDIO_CHUNK_MS = 15_000;
const MAX_TRANSCRIPT_CHARS = 4_000;

export interface TabAudioChunkMessage {
  source: "offscreen-audio";
  type: "TAB_AUDIO_CHUNK";
  payload: {
    workspaceId: string;
    tabId: number;
    audioBase64: string;
    mimeType: string;
    startedAt: number;
    endedAt: number;
  };
}

export interface TabAudioStatusMessage {
  source: "offscreen-audio";
  type: "TAB_AUDIO_CAPTURE_STATUS";
  payload: {
    workspaceId: string | null;
    tabId: number | null;
    status: "recording" | "stopped" | "error";
    detail?: string;
    timestamp: number;
  };
}

export type TabAudioOffscreenMessage =
  | TabAudioChunkMessage
  | TabAudioStatusMessage;

interface TabAudioSession {
  workspaceId: string;
  tabId: number;
  streamId: string;
  transcript: PassiveAudioTranscriptWindow | null;
  queue: Promise<void>;
}

export interface TabAudioCaptureControllerDeps {
  loadSettings: () => Promise<UserSettings | null>;
  updateTranscript: (
    workspaceId: string,
    transcript: PassiveAudioTranscriptWindow | null,
  ) => boolean;
  setStatusDetail?: (workspaceId: string, detail: string) => void;
  now?: () => number;
}

function compactTranscript(existing: string, next: string): string {
  const combined = [existing, next].filter(Boolean).join(" ").replace(/\s+/g, " ");
  return combined.length > MAX_TRANSCRIPT_CHARS
    ? combined.slice(combined.length - MAX_TRANSCRIPT_CHARS).trim()
    : combined.trim();
}

function isTabAudioMessage(message: unknown): message is TabAudioOffscreenMessage {
  if (!message || typeof message !== "object") return false;
  const record = message as { source?: unknown; type?: unknown };
  return (
    record.source === "offscreen-audio" &&
    (record.type === "TAB_AUDIO_CHUNK" ||
      record.type === "TAB_AUDIO_CAPTURE_STATUS")
  );
}

export class TabAudioCaptureController {
  private readonly sessions = new Map<string, TabAudioSession>();
  private readonly loadSettings: () => Promise<UserSettings | null>;
  private readonly updateTranscript: (
    workspaceId: string,
    transcript: PassiveAudioTranscriptWindow | null,
  ) => boolean;
  private readonly setStatusDetail: (workspaceId: string, detail: string) => void;
  private readonly now: () => number;

  constructor(deps: TabAudioCaptureControllerDeps) {
    this.loadSettings = deps.loadSettings;
    this.updateTranscript = deps.updateTranscript;
    this.setStatusDetail = deps.setStatusDetail ?? (() => {});
    this.now = deps.now ?? (() => Date.now());
  }

  isOffscreenMessage(message: unknown): message is TabAudioOffscreenMessage {
    return isTabAudioMessage(message);
  }

  async start(input: { workspaceId: string; tabId: number }): Promise<void> {
    const settings = await this.loadSettings();
    if (!settings?.groqApiKey?.trim()) {
      this.setStatusDetail(
        input.workspaceId,
        "Add a Groq API key to transcribe audio.",
      );
      return;
    }
    await this.stop(input.workspaceId);
    await this.ensureOffscreenDocument();
    const streamId = await this.getTabAudioStreamId(input.tabId);
    const session: TabAudioSession = {
      workspaceId: input.workspaceId,
      tabId: input.tabId,
      streamId,
      transcript: null,
      queue: Promise.resolve(),
    };
    this.sessions.set(input.workspaceId, session);
    try {
      await chrome.runtime.sendMessage({
        type: "TAB_AUDIO_CAPTURE_START",
        target: "offscreen-audio",
        requestId: crypto.randomUUID(),
        payload: {
          streamId,
          tabId: input.tabId,
          workspaceId: input.workspaceId,
          chunkMs: TAB_AUDIO_CHUNK_MS,
        },
      });
    } catch (error) {
      this.sessions.delete(input.workspaceId);
      this.updateTranscript(input.workspaceId, null);
      throw error;
    }
    this.setStatusDetail(input.workspaceId, "Watching page and tab audio.");
  }

  async stop(workspaceId: string | null | undefined): Promise<void> {
    const key = workspaceId?.trim();
    if (!key) return;
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    this.updateTranscript(key, null);
    if (!session) return;
    await this.sendStop(key);
  }

  stopSessionsForTab(tabId: number): void {
    for (const session of [...this.sessions.values()]) {
      if (session.tabId === tabId) {
        void this.stop(session.workspaceId);
      }
    }
  }

  clearTranscriptsForTab(tabId: number): void {
    for (const session of this.sessions.values()) {
      if (session.tabId === tabId) {
        session.transcript = null;
        this.updateTranscript(session.workspaceId, null);
      }
    }
  }

  handleMessage(message: TabAudioOffscreenMessage): boolean {
    if (message.type === "TAB_AUDIO_CAPTURE_STATUS") {
      const workspaceId = message.payload.workspaceId;
      if (!workspaceId) return true;
      const session = this.sessions.get(workspaceId);
      if (message.payload.status === "recording" && !session) {
        void this.sendStop(workspaceId);
        return true;
      }
      if (message.payload.status === "error") {
        this.sessions.delete(workspaceId);
        this.updateTranscript(workspaceId, null);
        this.setStatusDetail(
          workspaceId,
          message.payload.detail || "Audio transcription failed.",
        );
      }
      if (message.payload.status === "stopped") {
        this.sessions.delete(workspaceId);
        this.updateTranscript(workspaceId, null);
      }
      return true;
    }

    const session = this.sessions.get(message.payload.workspaceId);
    if (!session || session.tabId !== message.payload.tabId) {
      void this.sendStop(message.payload.workspaceId);
      return true;
    }
    session.queue = session.queue
      .then(() => this.transcribeChunk(session, message))
      .catch((error) => {
        logger.warn("recording", "Tab audio transcription failed", {
          workspaceId: session.workspaceId,
          error: error?.message ?? String(error),
        });
        this.setStatusDetail(session.workspaceId, "Audio transcription failed.");
      });
    return true;
  }

  private async transcribeChunk(
    session: TabAudioSession,
    message: TabAudioChunkMessage,
  ): Promise<void> {
    const settings = await this.loadSettings();
    const result = await transcribeWithGroq({
      apiKey: settings?.groqApiKey,
      audioBase64: message.payload.audioBase64,
      mimeType: message.payload.mimeType,
      now: this.now,
    });
    if (!result.text) return;
    const prior = session.transcript;
    const transcript: PassiveAudioTranscriptWindow = {
      source: "tabAudio",
      text: compactTranscript(prior?.text ?? "", result.text),
      startedAt: prior?.startedAt ?? message.payload.startedAt,
      endedAt: message.payload.endedAt,
      chunkCount: (prior?.chunkCount ?? 0) + 1,
      stale: false,
    };
    session.transcript = transcript;
    this.updateTranscript(session.workspaceId, transcript);
  }

  private async getTabAudioStreamId(tabId: number): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        const detail = chrome.runtime.lastError?.message;
        if (detail || !streamId) {
          reject(new Error(detail || "Could not start tab audio capture."));
          return;
        }
        resolve(streamId);
      });
    });
  }

  private async sendStop(workspaceId: string): Promise<void> {
    await chrome.runtime
      .sendMessage({
        type: "TAB_AUDIO_CAPTURE_STOP",
        target: "offscreen-audio",
        requestId: crypto.randomUUID(),
        payload: { workspaceId },
      })
      .catch(() => {});
  }

  private async ensureOffscreenDocument(): Promise<void> {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_AUDIO_PATH);
    const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
      getContexts?: (filter: {
        contextTypes: string[];
        documentUrls?: string[];
      }) => Promise<Array<{ documentUrl?: string }>>;
    };
    if (runtimeWithContexts.getContexts) {
      const contexts = await runtimeWithContexts.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length > 0) return;
    }
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_AUDIO_PATH,
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Transcribe audio playing in the active tab for Watch Mode.",
    });
  }
}
