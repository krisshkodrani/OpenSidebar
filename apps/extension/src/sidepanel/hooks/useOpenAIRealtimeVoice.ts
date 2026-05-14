import { useCallback, useEffect, useRef, useState } from "react";
import { EscalationOptionId } from "../../types";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

const REALTIME_CALL_URL = "http://127.0.0.1:7589/api/backend/realtime/calls";

type VoiceStatus = "idle" | "connecting" | "ready" | "listening" | "error";

type RealtimeServerEvent = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  response?: {
    output?: Array<{
      type?: string;
      name?: string;
      call_id?: string;
      arguments?: string;
    }>;
  };
};

export interface OpenAIRealtimeVoiceActions {
  startTask(text: string): void;
  sendGuidance(text: string): void;
  stopTask(reason?: string): void;
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function latestAssistantResult(): string {
  const messages = useStore.getState().messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const summary = message.completionData?.summary || message.content;
    if (summary?.trim()) return summary.trim();
  }
  return "";
}

function currentHarnessState(): Record<string, unknown> {
  const state = useStore.getState();
  return {
    isAgentRunning: state.isAgentRunning,
    status: state.agentStatus,
    statusDetail: state.statusDetail,
    pendingApproval: state.pendingApproval
      ? {
          context: state.pendingApproval.context,
          toolName: state.pendingApproval.toolName,
        }
      : null,
    pendingClarification: state.pendingClarification
      ? {
          question: state.pendingClarification.question,
          suggestions: state.pendingClarification.suggestions ?? [],
        }
      : null,
    pendingEscalation: state.pendingEscalation
      ? {
          reason: state.pendingEscalation.reason,
          options: state.pendingEscalation.options.map((option) => ({
            id: option.id,
            label: option.label,
            recommended:
              option.id === state.pendingEscalation?.recommendedOption,
          })),
        }
      : null,
    latestResult: latestAssistantResult(),
  };
}

async function sendApprovalDecision(approved: boolean): Promise<Record<string, unknown>> {
  const state = useStore.getState();
  const pending = state.pendingApproval;
  if (!pending) return { ok: false, error: "No approval is pending." };
  await uiRuntime.sendMessage({
    type: "APPROVAL_RESPONSE",
    requestId: crypto.randomUUID(),
    source: uiRuntime.source,
    workspaceId: state.activeWorkspaceId,
    payload: {
      approvalId: pending.approvalId,
      approved,
    },
  });
  state.clearPendingApproval();
  return { ok: true, approved };
}

async function sendClarificationAnswer(text: string): Promise<Record<string, unknown>> {
  const answer = text.trim();
  if (!answer) return { ok: false, error: "Clarification answer is empty." };
  const state = useStore.getState();
  const pending = state.pendingClarification;
  if (!pending) return { ok: false, error: "No clarification is pending." };
  await uiRuntime.sendMessage({
    type: "CLARIFICATION_RESPONSE",
    requestId: crypto.randomUUID(),
    source: uiRuntime.source,
    workspaceId: state.activeWorkspaceId,
    payload: {
      clarificationId: pending.clarificationId,
      answer,
    },
  });
  state.clearPendingClarification();
  return { ok: true, answer };
}

async function sendRecommendedEscalationDecision(): Promise<Record<string, unknown>> {
  const state = useStore.getState();
  const pending = state.pendingEscalation;
  if (!pending) return { ok: false, error: "No escalation decision is pending." };
  const option =
    pending.options.find((item) => item.id === pending.recommendedOption) ??
    pending.options[0];
  if (!option) return { ok: false, error: "No escalation options are available." };
  await uiRuntime.sendMessage({
    type: "ESCALATION_DECISION",
    requestId: crypto.randomUUID(),
    source: uiRuntime.source,
    workspaceId: state.activeWorkspaceId,
    payload: {
      escalationId: pending.escalationId,
      optionId: option.id as EscalationOptionId,
      rerouteObjective: option.rerouteObjective,
    },
  });
  state.clearPendingEscalation();
  return { ok: true, option: option.label };
}

export function useOpenAIRealtimeVoice(actions: OpenAIRealtimeVoiceActions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const actionsRef = useRef(actions);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);

  const speakHarnessUpdate = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const sent = sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `OpenSidebar harness update: ${text.trim()}\nRespond aloud in one short sentence if the user should hear this.`,
            },
          ],
        },
      });
      if (sent) sendEvent({ type: "response.create" });
    },
    [sendEvent],
  );

  const sendToolOutput = useCallback(
    (callId: string | undefined, output: Record<string, unknown>) => {
      if (!callId) return;
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      });
      sendEvent({ type: "response.create" });
    },
    [sendEvent],
  );

  const handleToolCall = useCallback(
    async (name: string | undefined, callId: string | undefined, rawArgs: string | undefined) => {
      if (!name) return;
      const args = parseArguments(rawArgs);
      try {
        if (name === "start_browser_task") {
          const text = String(args.text ?? "").trim();
          if (!text) {
            sendToolOutput(callId, { ok: false, error: "Task text is empty." });
            return;
          }
          const currentActions = actionsRef.current;
          if (useStore.getState().isAgentRunning) currentActions.sendGuidance(text);
          else currentActions.startTask(text);
          sendToolOutput(callId, { ok: true, action: "started_or_guided", text });
          return;
        }
        if (name === "send_agent_guidance") {
          const text = String(args.text ?? "").trim();
          if (!text) {
            sendToolOutput(callId, { ok: false, error: "Guidance text is empty." });
            return;
          }
          const currentActions = actionsRef.current;
          if (useStore.getState().isAgentRunning) currentActions.sendGuidance(text);
          else currentActions.startTask(text);
          sendToolOutput(callId, { ok: true, action: "sent_guidance", text });
          return;
        }
        if (name === "stop_agent") {
          const reason = String(args.reason ?? "").trim();
          actionsRef.current.stopTask(reason || undefined);
          sendToolOutput(callId, { ok: true, action: "stopped", reason });
          return;
        }
        if (name === "approve_pending_action") {
          sendToolOutput(
            callId,
            await sendApprovalDecision(Boolean(args.approved)),
          );
          return;
        }
        if (name === "answer_clarification") {
          sendToolOutput(
            callId,
            await sendClarificationAnswer(String(args.text ?? "")),
          );
          return;
        }
        if (name === "read_current_state") {
          sendToolOutput(callId, { ok: true, state: currentHarnessState() });
          return;
        }
        if (name === "read_latest_result") {
          sendToolOutput(callId, {
            ok: true,
            latestResult: latestAssistantResult(),
          });
          return;
        }
        if (name === "choose_recommended_escalation") {
          sendToolOutput(callId, await sendRecommendedEscalationDecision());
          return;
        }
        sendToolOutput(callId, { ok: false, error: `Unknown tool: ${name}` });
      } catch (err: any) {
        logger.error("ui", "Realtime voice tool call failed", { err, name });
        sendToolOutput(callId, {
          ok: false,
          error: err?.message ?? "Realtime tool call failed.",
        });
      }
    },
    [sendToolOutput],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (event.type === "response.function_call_arguments.done") {
        void handleToolCall(event.name, event.call_id, event.arguments);
        return;
      }
      if (event.type === "response.done") {
        for (const item of event.response?.output ?? []) {
          if (item.type === "function_call") {
            void handleToolCall(item.name, item.call_id, item.arguments);
          }
        }
      }
    },
    [handleToolCall],
  );

  const close = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    audioRef.current?.remove();
    audioRef.current = null;
    setStatus("idle");
  }, []);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    setError(null);
    setStatus("connecting");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const [track] = stream.getAudioTracks();
    if (track) track.enabled = false;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    for (const mediaTrack of stream.getTracks()) pc.addTrack(mediaTrack, stream);

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audioRef.current = audio;
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };

    const channel = pc.createDataChannel("oai-events");
    channelRef.current = channel;
    channel.addEventListener("message", (message) => {
      try {
        handleServerEvent(JSON.parse(message.data));
      } catch (err) {
        logger.warn("ui", "Ignored malformed Realtime event", { err });
      }
    });
    channel.addEventListener("open", () => {
      setStatus((current) => (current === "connecting" ? "ready" : current));
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Initial OpenSidebar harness state: ${JSON.stringify(currentHarnessState())}`,
            },
          ],
        },
      });
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(REALTIME_CALL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp ?? "",
    });
    const answerSdp = await response.text();
    if (!response.ok) {
      throw new Error(answerSdp || `Realtime session failed (${response.status}).`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    setStatus("ready");
  }, [handleServerEvent, sendEvent]);

  const startListening = useCallback(async () => {
    try {
      if (!pcRef.current) await connect();
      const track = streamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = true;
      setStatus("listening");
    } catch (err: any) {
      logger.error("ui", "Failed to start Realtime voice", { err });
      close();
      setError(err?.message ?? "Could not start OpenAI Realtime voice.");
      setStatus("error");
    }
  }, [close, connect]);

  const stopListening = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = false;
    setStatus(pcRef.current ? "ready" : "idle");
    sendEvent({ type: "response.create" });
  }, [sendEvent]);

  const toggleListening = useCallback(() => {
    if (status === "connecting") return;
    if (status === "listening") stopListening();
    else void startListening();
  }, [startListening, status, stopListening]);

  useEffect(() => close, [close]);

  return {
    status,
    error,
    isListening: status === "listening",
    startListening,
    stopListening,
    toggleListening,
    close,
    speakHarnessUpdate,
  };
}
