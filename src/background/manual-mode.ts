/**
 * ManualModeHandler — executes slash commands from the side panel.
 *
 * Routes manual commands to the tool registry, perception layer,
 * content script, or trace recorder as appropriate.
 */

import {
  ToolName,
  ToolCall,
  MessageSource,
  TaggedElement,
  DomSnapshot,
  RiskLevel,
  SessionMetrics,
  ManualToolExecuteMessage,
} from "../types";
import { toolRegistry } from "./tools/registry";
import { DOM_MODIFYING_TOOLS } from "./tools/metadata";
import { perceive, PerceptionInput } from "./perception";
import { TraceRecorder } from "./agent/trace";
import { getHelpText } from "../sidepanel/slash-commands";
import { logger } from "../utils";

export interface ManualCommandResult {
  command: string;
  success: boolean;
  result: string;
  toolName?: ToolName;
  args?: Record<string, unknown>;
  durationMs: number;
  elements?: TaggedElement[];
  interpretation?: string;
  screenshotUrl?: string;
}

export class ManualModeHandler {
  private traceRecorder: TraceRecorder | null = null;
  private turnCount = 0;
  private recordingName = "";
  private recordingStartTime = 0;

  async handleCommand(
    payload: ManualToolExecuteMessage["payload"],
    workspaceId: string,
  ): Promise<ManualCommandResult> {
    const start = Date.now();

    switch (payload.command) {
      case "tool":
        return this.handleTool(payload, workspaceId, start);
      case "perceive":
        return this.handlePerceive(payload, start);
      case "snapshot":
        return this.handleSnapshot(payload, start);
      case "screenshot":
        return this.handleScreenshot(start);
      case "record":
        return this.handleRecord(payload, workspaceId, start);
      case "tags":
        return this.handleTags(start);
      case "dismiss":
        return this.handleDismiss(payload, start);
      case "help":
        return {
          command: "help",
          success: true,
          result: getHelpText(),
          durationMs: Date.now() - start,
        };
    }
  }

  isRecording(): boolean {
    return this.traceRecorder !== null;
  }

  getRecordingInfo(): {
    sessionId: string;
    turnCount: number;
    name: string;
  } | null {
    if (!this.traceRecorder) return null;
    return {
      sessionId: this.traceRecorder.sessionId,
      turnCount: this.turnCount,
      name: this.recordingName,
    };
  }

  /** Cleanup on dispose (finalize any active recording) */
  async dispose(): Promise<void> {
    if (this.traceRecorder) {
      const metrics = this.buildSessionMetrics();
      await this.traceRecorder.finalize(
        "completed",
        "Manual session ended",
        this.turnCount,
        null,
        metrics,
      );
      this.traceRecorder = null;
      this.turnCount = 0;
    }
  }

  /** Build synthetic SessionMetrics so the trace viewer shows a "manual" model badge */
  private buildSessionMetrics(): SessionMetrics {
    const elapsed = Date.now() - this.recordingStartTime;
    return {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLlmTimeMs: 0,
      totalSessionTimeMs: elapsed,
      llmCallCount: 0,
      totalCachedTokens: 0,
      modelBreakdown: {
        manual: {
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          calls: this.turnCount,
        },
      },
    };
  }

  // --- Private Handlers ---

  private async handleTool(
    payload: ManualToolExecuteMessage["payload"],
    workspaceId: string,
    start: number,
  ): Promise<ManualCommandResult> {
    const { toolName, args, tabId } = payload;
    if (!toolName) {
      return {
        command: "tool",
        success: false,
        result: "No tool name specified",
        durationMs: Date.now() - start,
      };
    }

    const toolCall: ToolCall = {
      id: `manual-${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(args ?? {}),
      },
    };

    // If recording, start a new turn
    if (this.traceRecorder) {
      this.turnCount++;
      const snapshot = await this.getSnapshot(tabId);
      this.traceRecorder.startTurn(
        this.turnCount,
        {
          url: snapshot?.url ?? "",
          title: snapshot?.title ?? "",
          elementCount: snapshot?.elements?.length ?? 0,
          visibleContentLength: 0,
          scrollY: snapshot?.scroll?.y ?? 0,
        },
        snapshot?.elements ?? [],
        0,
        1,
        "manual",
        "NONE",
      );
      this.traceRecorder.recordLLMResponse(null, [toolCall], "manual", null, 0);
    }

    let result: string;
    let success = true;
    try {
      result = await toolRegistry.execute(toolCall, tabId);
      if (result.startsWith("Error")) success = false;
    } catch (e: any) {
      result = `Error: ${e.message}`;
      success = false;
    }

    const durationMs = Date.now() - start;

    // Record tool execution in trace
    if (this.traceRecorder) {
      this.traceRecorder.recordToolExecution(
        toolCall.id,
        toolName,
        args ?? {},
        result,
        success,
        durationMs,
        RiskLevel.LOW,
        success ? undefined : result,
      );
      await this.traceRecorder.endTurn();
    }

    // After DOM-modifying tools, auto-refresh snapshot to keep tag IDs current
    if (DOM_MODIFYING_TOOLS.has(toolName)) {
      await this.refreshSnapshot(tabId);
    }

    return {
      command: "tool",
      success,
      result,
      toolName,
      args,
      durationMs,
    };
  }

  private async handlePerceive(
    payload: ManualToolExecuteMessage["payload"],
    start: number,
  ): Promise<ManualCommandResult> {
    const { tabId, objective } = payload;
    try {
      const snapshot = await this.getSnapshot(tabId);
      if (!snapshot) {
        return {
          command: "perceive",
          success: false,
          result: "Failed to get DOM snapshot",
          durationMs: Date.now() - start,
        };
      }

      let screenshotDataUrl: string;
      try {
        screenshotDataUrl = await chrome.tabs.captureVisibleTab({
          format: "jpeg",
          quality: 70,
        });
      } catch {
        return {
          command: "perceive",
          success: false,
          result: "Failed to capture screenshot",
          durationMs: Date.now() - start,
        };
      }

      const input: PerceptionInput = {
        screenshotDataUrl,
        elements: snapshot.elements,
        url: snapshot.url,
        title: snapshot.title,
        scroll: { y: snapshot.scroll.y, maxY: snapshot.scroll.maxY },
        objective,
      };

      const perceptionResult = await perceive(input);

      // Record in trace if active
      if (this.traceRecorder) {
        this.turnCount++;
        this.traceRecorder.startTurn(
          this.turnCount,
          {
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elements.length,
            visibleContentLength: 0,
            scrollY: snapshot.scroll.y,
          },
          snapshot.elements,
          0,
          0,
          "manual",
          "NONE",
        );
        this.traceRecorder.recordLLMResponse(null, [], "manual", null, 0);
        await this.traceRecorder.recordPerception(
          perceptionResult,
          screenshotDataUrl,
        );
        await this.traceRecorder.endTurn();
      }

      return {
        command: "perceive",
        success: true,
        result: perceptionResult.interpretation,
        interpretation: perceptionResult.interpretation,
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      return {
        command: "perceive",
        success: false,
        result: `Perception failed: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleSnapshot(
    payload: ManualToolExecuteMessage["payload"],
    start: number,
  ): Promise<ManualCommandResult> {
    try {
      const snapshot = await this.getSnapshot(payload.tabId);
      if (!snapshot || !snapshot.elements.length) {
        return {
          command: "snapshot",
          success: true,
          result: "No interactive elements found on page",
          elements: [],
          durationMs: Date.now() - start,
        };
      }

      const lines = snapshot.elements.map((el) => {
        const attrs = Object.entries(el.attributes)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        return `[${el.tag}] ${el.tagName}${el.role ? `(${el.role})` : ""} "${el.text}"${attrs ? ` ${attrs}` : ""}`;
      });

      return {
        command: "snapshot",
        success: true,
        result: `${snapshot.elements.length} elements on ${snapshot.url}\n\n${lines.join("\n")}`,
        elements: snapshot.elements,
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      return {
        command: "snapshot",
        success: false,
        result: `Snapshot failed: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleScreenshot(start: number): Promise<ManualCommandResult> {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({
        format: "jpeg",
        quality: 80,
      });
      return {
        command: "screenshot",
        success: true,
        result: "Screenshot captured",
        screenshotUrl: dataUrl,
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      return {
        command: "screenshot",
        success: false,
        result: `Screenshot failed: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleRecord(
    payload: ManualToolExecuteMessage["payload"],
    workspaceId: string,
    start: number,
  ): Promise<ManualCommandResult> {
    if (this.traceRecorder) {
      // Stop recording
      const sessionId = this.traceRecorder.sessionId;
      const turns = this.turnCount;
      const metrics = this.buildSessionMetrics();
      await this.traceRecorder.finalize(
        "completed",
        `Manual recording: ${this.recordingName}`,
        turns,
        null,
        metrics,
      );
      this.traceRecorder = null;
      this.turnCount = 0;
      const name = this.recordingName;
      this.recordingName = "";

      return {
        command: "record",
        success: true,
        result: `Recording stopped. Session "${name}" saved with ${turns} turns. (ID: ${sessionId})`,
        durationMs: Date.now() - start,
      };
    } else {
      // Start recording
      const sessionId = crypto.randomUUID();
      const name = payload.recordName || `manual-${Date.now()}`;
      this.traceRecorder = new TraceRecorder(sessionId);
      this.traceRecorder.setSessionInfo(name, "");
      this.traceRecorder.setWorkspaceId(workspaceId);
      this.turnCount = 0;
      this.recordingStartTime = Date.now();
      this.recordingName = name;

      // Try to get current URL for session info
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.url) {
          this.traceRecorder.setSessionInfo(name, tab.url);
        }
      } catch {
        /* ignore */
      }

      return {
        command: "record",
        success: true,
        result: `Recording started: "${name}" (ID: ${sessionId}). Use /record again to stop.`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleTags(start: number): Promise<ManualCommandResult> {
    try {
      return {
        command: "tags",
        success: true,
        result: "Visual element tags have been removed. Element IDs are always available in the agent's element list.",
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      return {
        command: "tags",
        success: false,
        result: `Failed: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleDismiss(
    payload: ManualToolExecuteMessage["payload"],
    start: number,
  ): Promise<ManualCommandResult> {
    try {
      const response = await chrome.tabs.sendMessage(payload.tabId, {
        type: "DISMISS_MODALS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {},
      });

      const dismissed = response?.payload?.dismissed ?? 0;
      return {
        command: "dismiss",
        success: true,
        result:
          dismissed > 0
            ? `Dismissed ${dismissed} modal(s)/overlay(s)`
            : "No modals or overlays found to dismiss",
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      return {
        command: "dismiss",
        success: false,
        result: `Dismiss failed: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // --- Helpers ---

  private async getSnapshot(tabId: number): Promise<DomSnapshot | null> {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {},
      });
      return response?.snapshot ?? null;
    } catch (e: any) {
      logger.warn("manual", "Failed to get snapshot", { error: e.message });
      return null;
    }
  }

  private async refreshSnapshot(tabId: number): Promise<void> {
    // Fire-and-forget snapshot request to keep tags fresh
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {},
      });
    } catch {
      /* ignore */
    }
  }
}
