import { providerRoutingOptions } from "../llm/provider-routing-policy";
import type { AgentLoop } from "../agent";
import type { TurnCheckpoint } from "../agent/checkpoint-types";
import type { AgentStep } from "../../types";
import { logger } from "../../utils";
import { buildRoleExecutionContract } from "./contracts";
import { getNodeToolProfile, synthesizePlanStateFromSingleNode } from "./plan-state";
import { HANDOFF_APPROVAL_TIMEOUT_MS } from "./pending-interaction";
import { sendMessage } from "./task-messaging";
import type { CreateAgentLoopInput } from "./lane-types";
import type { OrchestratorStartInput, OrchestratorTask, TaskNode } from "./types";

export function createWorkerAgentLoop(input: {
  task: OrchestratorTask;
  node: TaskNode;
  startInput: OrchestratorStartInput;
  tabId: number;
  workerId: string;
  taskStateBrief: string;
  verificationTurnMode: boolean;
  validatedTurnCheckpoint: TurnCheckpoint | null;
  recordStaleSignal: () => number;
  sendStepLabel: (label: string, status: AgentStep["status"]) => void;
  createAgentLoop: (input: CreateAgentLoopInput) => AgentLoop;
}): AgentLoop {
  const {
    task, node, startInput, tabId, workerId, taskStateBrief,
    verificationTurnMode, validatedTurnCheckpoint, recordStaleSignal,
    sendStepLabel, createAgentLoop,
  } = input;
  const executorContract = buildRoleExecutionContract(
    "executor",
    startInput.settings,
    node, startInput.executionToolProfile,
  );
  logger.debug("policy", "Role execution contract resolved", {
    role: executorContract.role,
    taskId: task.id,
    nodeId: node.id,
    modelTier: executorContract.modelTier,
    allowedToolCount: executorContract.allowedTools.length,
    disabledToolCount: executorContract.disabledTools.size,
    taskStateContextChars: taskStateBrief.length,
  });
  const nodeToolProfile = getNodeToolProfile(node);

  return createAgentLoop({
    openRouterApiKey: startInput.openRouterApiKey,
    callbacks: {
      onStatusUpdate: (_status, _detail) => {
        // Task-level status is emitted by orchestrator.
      },
      onMessage: () => {
        // Worker-level summaries are aggregated by orchestrator.
      },
      onStep: (step, update) => {
        const lowerLabel = (step.label || "").toLowerCase();
        const lowerDetail = (step.detail || "").toLowerCase();
        if (
          lowerLabel.includes("stuck") ||
          lowerDetail.includes("stuck") ||
          lowerLabel.includes("nudge") ||
          lowerDetail.includes("nudge") ||
          lowerLabel.includes("escalat") ||
          lowerDetail.includes("escalat")
        ) {
          const staleSignalCount = recordStaleSignal();
          logger.warn(
            "orchestrator",
            "Worker emitted stale-progress signal",
            {
              taskId: task.id,
              nodeId: node.id,
              staleSignalCount,
              stepLabel: step.label,
              stepDetail: step.detail,
            },
          );
        }
        const isSingleNode = task.planClassification?.isSingleNode === true;
        const resolvedLabel = isSingleNode
          ? step.label
          : `Executor: ${step.label}`;
        sendMessage({
          type: "AGENT_STEP",
          workspaceId: task.workspaceId,
          payload: {
            step: { ...step, label: resolvedLabel },
            update,
          },
        });
        // Forward step label to content script for the floating overlay
        if (tabId && step.label) {
          sendStepLabel(resolvedLabel, step.status);
        }
      },
    },
    options: {
      maxContextTokens: 128000,
      maxTurns: startInput.settings.maxTurns || 30,
      showSessionMetrics: false,
      preferredModelTier: executorContract.modelTier,
      executionContract: {
        role: executorContract.role,
        modelTier: executorContract.modelTier,
        allowedTools: executorContract.allowedTools,
      },
      disabledTools: executorContract.disabledTools,
      workspaceId: task.workspaceId,
      workerId,
      taskId: task.id,
      nodeId: node.id,
      runId: task.runId || task.id,
      correlationId: task.runId || task.id,
      selectedSkillId: node.selectedSkillId,
      enabledSkillPackIds: task.enabledSkillPackIds,
      suppressUiBroadcast: true,
      // For single-node tasks, forward clean content to the side panel.
      // Suppresses intermediate text deltas (raw reasoning/JSON) — the user
      // sees step progress during execution and the final summary via replaceContent.
      onStreamChunk: task.planClassification?.isSingleNode
        ? (
            delta: string,
            done: boolean,
            replaceContent?: string,
            thinking?: string,
          ) => {
            // Only forward replaceContent, done, and thinking — skip raw text deltas
            const shouldForwardReplaceContent =
              replaceContent !== undefined && !done;
            if (shouldForwardReplaceContent || done || thinking) {
              sendMessage({
                type: "STREAM_CHUNK",
                workspaceId: task.workspaceId,
                payload: {
                  delta: "",
                  done,
                  ...(shouldForwardReplaceContent
                    ? { replaceContent }
                    : {}),
                  ...(thinking ? { thinking } : {}),
                },
              });
            }
            // Track whether real content was streamed (for dedup in finalization)
            if (replaceContent !== undefined) {
              task._streamHasContent = replaceContent.length > 0;
            }
          }
        : undefined,
      // Single-node tasks: synthesize plan state from the node description
      // so the loop's done() guards (plan completeness, validateDone) activate.
      // Multi-node tasks: pass a single-subtask plan state representing the
      // current node. This activates done() validation (the planner verifies
      // the node objective was actually met) without exposing sibling nodes.
      initialPlanState: task.planClassification?.isSingleNode
        ? (synthesizePlanStateFromSingleNode(node) ?? undefined)
        : {
            currentIndex: 0,
            subtasks: [
              {
                description: node.description,
                ...(node.displayLabel ? { label: node.displayLabel } : {}),
                successCriteria: node.successCriteria,
                status: "running" as const,
                ...(nodeToolProfile
                  ? { toolProfile: nodeToolProfile }
                  : {}),
              },
            ],
          },
      verificationTurnMode,
      disableInternalPlanning: executorContract.disableInternalPlanning,
      bypassApprovals: !(startInput.settings.requireApprovals ?? true),
      // Bridge-forwarded approvals round-trip through pi + a human, so the
      // 30s default is far too short (pi-backend Phase 4). Non-bridge
      // tasks keep the loop's own default.
      approvalTimeoutMs:
        task.interactionDelivery === "handoff"
          ? HANDOFF_APPROVAL_TIMEOUT_MS
          : undefined,
      executorModel: startInput.settings.executorModel,
      plannerModel: startInput.settings.plannerModel,
      judgeModel: startInput.settings.judgeModel,
      ...providerRoutingOptions(startInput.settings),
      writerModel: startInput.settings.writerModel,
      useNitro: startInput.settings.useNitro,
      providerMode: startInput.settings.providerMode,
      provider: startInput.settings.provider,
      openaiApiKey: startInput.settings.openaiApiKey,
      groqApiKey: startInput.settings.groqApiKey,
      fireworksApiKey: startInput.settings.fireworksApiKey,
      deepseekApiKey: startInput.settings.deepseekApiKey,
      kimiApiKey: startInput.settings.kimiApiKey,
      xiaomiApiKey: startInput.settings.xiaomiApiKey,
      cerebrasApiKey: startInput.settings.cerebrasApiKey,
      temperature: startInput.settings.temperature,
      perceptionMode: startInput.settings.perceptionMode,
      maxImagePromptTokenEstimate:
        startInput.settings.maxImagePromptTokenEstimate,
      // Durable turn checkpoint: injected by orchestrator on SW restart recovery
      turnCheckpoint: validatedTurnCheckpoint,
      // Resumable approval/clarification state: injected after user response.
      resumeInteraction:
        task.pendingInteraction?.nodeId === node.id
          ? task.pendingInteraction
          : null,
    },
  });
}
