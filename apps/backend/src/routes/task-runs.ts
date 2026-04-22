import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import type {
  PendingInteractionRecordInput,
  SideEffectRecordInput,
  TaskRunInput,
  TaskRunNodeInput,
  TaskRunProgressInput,
  TaskRunStatus,
} from "../types.js";
import {
  appendTaskRunSideEffects,
  deleteTaskRunProgress,
  getTaskRunDetail,
  getTaskRun,
  getTaskRunResume,
  InvalidTaskRunProgressError,
  listTaskRuns,
  patchTaskRun,
  requestTaskRunResume,
  requestTaskRunStop,
  setTaskRunPendingInteraction,
  updateTaskRunCheckpoint,
  upsertTaskRun,
  upsertTaskRunNode,
  upsertTaskRunProgress,
} from "../services/task-runs.js";

const VALID_RUN_STATUSES: TaskRunStatus[] = [
  "planning",
  "running",
  "completed",
  "failed",
  "stopped",
];

export async function handleTaskRunRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const {
    pathname,
    searchParams,
    method,
    parseJsonBody,
    sendJson,
    sendEmpty,
    sendError,
  } = ctx;

  if (pathname === "/task-runs" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<TaskRunInput>;
    if (!body.id || !body.workspaceId || !body.query || !body.status) {
      sendError(res, "Missing required fields: id, workspaceId, query, status");
      return;
    }
    if (!VALID_RUN_STATUSES.includes(body.status)) {
      sendError(
        res,
        `Invalid status. Must be one of: ${VALID_RUN_STATUSES.join(", ")}`,
      );
      return;
    }
    const run = upsertTaskRun(body as TaskRunInput);
    sendJson(res, run, 201);
    return;
  }

  if (pathname === "/task-runs" && method === "GET") {
    const status = searchParams.get("status") as TaskRunStatus | null;
    const workspaceId = searchParams.get("workspace_id") ?? undefined;
    const limit = Number(searchParams.get("limit")) || 50;
    const includeCompleted = searchParams.get("include_completed") === "true";
    const includeProgressSummary =
      searchParams.get("include_progress_summary") === "true";
    const controlRequested = searchParams.get("control_requested") === "true";
    if (status && !VALID_RUN_STATUSES.includes(status)) {
      sendError(
        res,
        `Invalid status. Must be one of: ${VALID_RUN_STATUSES.join(", ")}`,
      );
      return;
    }
    sendJson(res, {
      runs: listTaskRuns({
        workspaceId,
        status: status ?? undefined,
        limit,
        includeCompleted,
        includeProgressSummary,
        controlRequested,
      }),
    });
    return;
  }

  const controlResumeMatch = pathname.match(/^\/task-runs\/([^/]+)\/resume$/);
  if (controlResumeMatch && method === "POST") {
    const body = (await parseJsonBody(req)) as { reason?: string | null };
    const run = requestTaskRunResume(
      decodeURIComponent(controlResumeMatch[1]),
      body.reason ?? null,
    );
    if (!run) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, run);
    return;
  }

  const controlStopMatch = pathname.match(/^\/task-runs\/([^/]+)\/stop$/);
  if (controlStopMatch && method === "POST") {
    const body = (await parseJsonBody(req)) as { reason?: string | null };
    const run = requestTaskRunStop(
      decodeURIComponent(controlStopMatch[1]),
      body.reason ?? null,
    );
    if (!run) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, run);
    return;
  }

  const resumeMatch = pathname.match(/^\/task-runs\/([^/]+)\/resume$/);
  if (resumeMatch && method === "GET") {
    const payload = getTaskRunResume(decodeURIComponent(resumeMatch[1]));
    if (!payload) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, payload);
    return;
  }

  const checkpointMatch = pathname.match(/^\/task-runs\/([^/]+)\/checkpoint$/);
  if (checkpointMatch && method === "PUT") {
    const body = (await parseJsonBody(req)) as {
      checkpointSummary?: TaskRunInput["checkpointSummary"];
    };
    const updated = updateTaskRunCheckpoint(
      decodeURIComponent(checkpointMatch[1]),
      body.checkpointSummary ?? null,
    );
    if (!updated) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, updated);
    return;
  }

  const nodeMatch = pathname.match(/^\/task-runs\/([^/]+)\/nodes\/([^/]+)$/);
  if (nodeMatch && method === "PUT") {
    const runId = decodeURIComponent(nodeMatch[1]);
    if (!getTaskRun(runId)) {
      sendError(res, "Task run not found", 404);
      return;
    }
    const body = (await parseJsonBody(req)) as Partial<TaskRunNodeInput>;
    if (!body.description || !body.successCriteria || !body.status) {
      sendError(
        res,
        "Missing required fields: description, successCriteria, status",
      );
      return;
    }
    const node = upsertTaskRunNode(runId, {
      nodeId: decodeURIComponent(nodeMatch[2]),
      description: body.description,
      successCriteria: body.successCriteria,
      selectedSkillId: body.selectedSkillId ?? null,
      selectedSkillReason: body.selectedSkillReason ?? null,
      allowedTools: body.allowedTools ?? [],
      dependencies: body.dependencies ?? [],
      assumptions: body.assumptions ?? [],
      verificationGate: body.verificationGate ?? null,
      handoffArtifacts: body.handoffArtifacts ?? [],
      reflexionLog: body.reflexionLog ?? [],
      handoffDepth: body.handoffDepth ?? 0,
      handoffFromNodeId: body.handoffFromNodeId ?? null,
      trajectory: body.trajectory ?? null,
      status: body.status,
      retries: body.retries ?? 0,
      result: body.result ?? null,
      error: body.error ?? null,
    });
    sendJson(res, node);
    return;
  }

  const progressDeleteMatch = pathname.match(
    /^\/task-runs\/([^/]+)\/progress\/([^/]+)$/,
  );
  if (progressDeleteMatch && method === "DELETE") {
    const deleted = deleteTaskRunProgress(
      decodeURIComponent(progressDeleteMatch[1]),
      decodeURIComponent(progressDeleteMatch[2]),
    );
    if (!deleted) {
      sendError(res, "Progress entry not found", 404);
      return;
    }
    sendEmpty(res);
    return;
  }

  const progressMatch = pathname.match(/^\/task-runs\/([^/]+)\/progress$/);
  if (progressMatch && method === "PUT") {
    const runId = decodeURIComponent(progressMatch[1]);
    if (!getTaskRun(runId)) {
      sendError(res, "Task run not found", 404);
      return;
    }
    const body = (await parseJsonBody(req)) as Partial<TaskRunProgressInput>;
    if (!body.key || !body.kind || !("payload" in (body as object))) {
      sendError(res, "Missing required fields: key, kind, payload");
      return;
    }
    let progress;
    try {
      progress = upsertTaskRunProgress(runId, body as TaskRunProgressInput);
    } catch (error) {
      if (error instanceof InvalidTaskRunProgressError) {
        sendError(res, error.message, 400);
        return;
      }
      throw error;
    }
    sendJson(res, progress);
    return;
  }

  const interactionMatch = pathname.match(
    /^\/task-runs\/([^/]+)\/pending-interaction$/,
  );
  if (interactionMatch && method === "PUT") {
    const runId = decodeURIComponent(interactionMatch[1]);
    if (!getTaskRun(runId)) {
      sendError(res, "Task run not found", 404);
      return;
    }
    const body = (await parseJsonBody(req)) as {
      interaction?: PendingInteractionRecordInput | null;
    };
    const interaction = setTaskRunPendingInteraction(
      runId,
      body.interaction ?? null,
    );
    sendJson(res, { interaction });
    return;
  }

  const sideEffectsMatch = pathname.match(/^\/task-runs\/([^/]+)\/side-effects$/);
  if (sideEffectsMatch && method === "POST") {
    const runId = decodeURIComponent(sideEffectsMatch[1]);
    if (!getTaskRun(runId)) {
      sendError(res, "Task run not found", 404);
      return;
    }
    const body = (await parseJsonBody(req)) as {
      entries?: SideEffectRecordInput[];
    };
    if (!Array.isArray(body.entries)) {
      sendError(res, "Missing required field: entries");
      return;
    }
    const entries = appendTaskRunSideEffects(runId, body.entries);
    sendJson(res, { entries }, 201);
    return;
  }

  const idMatch = pathname.match(/^\/task-runs\/([^/]+)$/);
  if (idMatch && method === "GET") {
    const run = getTaskRunDetail(decodeURIComponent(idMatch[1]));
    if (!run) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, run);
    return;
  }

  if (idMatch && method === "PATCH") {
    const body = (await parseJsonBody(req)) as Partial<TaskRunInput>;
    if (body.status && !VALID_RUN_STATUSES.includes(body.status)) {
      sendError(
        res,
        `Invalid status. Must be one of: ${VALID_RUN_STATUSES.join(", ")}`,
      );
      return;
    }
    const run = patchTaskRun(decodeURIComponent(idMatch[1]), body);
    if (!run) {
      sendError(res, "Task run not found", 404);
      return;
    }
    sendJson(res, run);
    return;
  }

  sendError(res, "Not found", 404);
}
