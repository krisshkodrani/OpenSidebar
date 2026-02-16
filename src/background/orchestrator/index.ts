import { AgentLoop } from "../agent";
import { LLMClient } from "../llm";
import {
  AgentStatus,
  MessageSource,
  SubtaskResult,
  SubtaskSummary,
  ToolName,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { workspaceManager } from "../workspaces/manager";
import { waitForContentScriptReady } from "../tab-ready";
import { OrchestratorPlanner } from "./planner";
import {
  BufferedMemory,
  OrchestratorCheckpoint,
  OrchestratorStartInput,
  OrchestratorTask,
  TaskNode,
  WorkerInstance,
} from "./types";
import { MemoryBuffer } from "./memory-buffer";

const NODE_MAX_RETRIES = 1;
const DEFAULT_MAX_WORKERS = 3;
const CHECKPOINTS_STORAGE_KEY = "opensidebar:orchestrator:checkpoints";
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isTaskNodeStatus(value: unknown): value is TaskNode["status"] {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  );
}

function isTaskStatus(value: unknown): value is OrchestratorTask["status"] {
  return (
    value === "planning" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  );
}

function sanitizeTaskNode(raw: unknown): TaskNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.description !== "string" || raw.description.length === 0) return null;
  if (!isTaskNodeStatus(raw.status)) return null;
  if (!isNonNegativeInteger(raw.retries)) return null;

  const node: TaskNode = {
    id: raw.id,
    description: raw.description,
    status: raw.status,
    retries: raw.retries,
  };
  if (typeof raw.result === "string") node.result = raw.result;
  if (typeof raw.error === "string") node.error = raw.error;
  return node;
}

function sanitizeTask(raw: unknown): OrchestratorTask | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0) return null;
  if (!isNonNegativeInteger(raw.rootTabId)) return null;
  if (typeof raw.query !== "string") return null;
  if (!isTaskStatus(raw.status)) return null;
  if (!isNonNegativeInteger(raw.createdAt)) return null;
  if (!Array.isArray(raw.nodes)) return null;
  if (!isNonNegativeInteger(raw.maxWorkers) || raw.maxWorkers < 1 || raw.maxWorkers > 8) {
    return null;
  }
  if (!isNonNegativeInteger(raw.currentIndex)) return null;

  const nodes = raw.nodes.map(sanitizeTaskNode);
  if (nodes.some((node) => node === null)) return null;

  const task: OrchestratorTask = {
    id: raw.id,
    workspaceId: raw.workspaceId,
    rootTabId: raw.rootTabId,
    query: raw.query,
    status: raw.status,
    createdAt: raw.createdAt,
    nodes: nodes as TaskNode[],
    maxWorkers: raw.maxWorkers,
    currentIndex: raw.currentIndex,
  };

  if (raw.startedAt !== undefined) {
    if (!isNonNegativeInteger(raw.startedAt)) return null;
    task.startedAt = raw.startedAt;
  }
  if (raw.finishedAt !== undefined) {
    if (!isNonNegativeInteger(raw.finishedAt)) return null;
    task.finishedAt = raw.finishedAt;
  }

  return task;
}

function sanitizeCheckpoint(raw: unknown): OrchestratorCheckpoint | null {
  if (!isRecord(raw)) return null;
  if (!isNonNegativeInteger(raw.version)) return null;
  if (!isNonNegativeInteger(raw.savedAt)) return null;
  const task = sanitizeTask(raw.task);
  if (!task) return null;
  if (raw.version !== CHECKPOINT_VERSION) {
    // Keep version check in prune flow for central logging path.
    return {
      version: raw.version as OrchestratorCheckpoint["version"],
      savedAt: raw.savedAt,
      task,
    };
  }
  return {
    version: CHECKPOINT_VERSION,
    savedAt: raw.savedAt,
    task,
  };
}

function buildDisabledTools(settings: UserSettings): Set<ToolName> {
  const disabled = new Set<ToolName>();
  if (settings.disableScreenshot) disabled.add(ToolName.TAKE_SCREENSHOT);
  if (settings.disableNavigation) disabled.add(ToolName.NAVIGATE);
  return disabled;
}

function toSubtasks(nodes: TaskNode[]): SubtaskSummary[] {
  return nodes.map((node) => ({
    description: node.description,
    status:
      node.status === "completed"
        ? "completed"
        : node.status === "failed"
          ? "failed"
          : node.status === "running"
            ? "running"
            : "pending",
    turnsUsed: 0,
    turnBudget: 0,
    result: node.result,
  }));
}

function currentIndex(nodes: TaskNode[]): number {
  const running = nodes.findIndex((n) => n.status === "running");
  if (running >= 0) return running;
  const pending = nodes.findIndex((n) => n.status === "pending");
  if (pending >= 0) return pending;
  return nodes.length;
}

export class Orchestrator {
  private tasksByWorkspace = new Map<string, OrchestratorTask>();
  private workersByWorkspace = new Map<string, Map<string, WorkerInstance>>();
  private memoryBuffer = new MemoryBuffer();

  private async loadCheckpoints(): Promise<Record<string, OrchestratorCheckpoint>> {
    try {
      const stored = await chrome.storage.local.get(CHECKPOINTS_STORAGE_KEY);
      const raw = stored[CHECKPOINTS_STORAGE_KEY];
      if (!isRecord(raw)) return {};

      const parsed: Record<string, OrchestratorCheckpoint> = {};
      for (const [workspaceId, value] of Object.entries(raw)) {
        if (typeof workspaceId !== "string" || workspaceId.length === 0) continue;
        const cp = sanitizeCheckpoint(value);
        if (!cp) {
          logger.warn("orchestrator", "Dropping malformed checkpoint", { workspaceId });
          continue;
        }
        if (cp.task.workspaceId !== workspaceId) {
          logger.warn("orchestrator", "Dropping checkpoint with mismatched workspace", {
            keyWorkspaceId: workspaceId,
            taskWorkspaceId: cp.task.workspaceId,
          });
          continue;
        }
        parsed[workspaceId] = cp;
      }
      return parsed;
    } catch (error) {
      logger.warn("orchestrator", "Failed to load checkpoints", { error });
      return {};
    }
  }

  private isCheckpointFresh(checkpoint: OrchestratorCheckpoint): boolean {
    return Date.now() - checkpoint.savedAt <= CHECKPOINT_TTL_MS;
  }

  private isCheckpointCompatible(checkpoint: OrchestratorCheckpoint): boolean {
    return checkpoint.version === CHECKPOINT_VERSION;
  }

  private async pruneCheckpoints(
    checkpoints: Record<string, OrchestratorCheckpoint>,
  ): Promise<Record<string, OrchestratorCheckpoint>> {
    let mutated = false;
    const kept: Record<string, OrchestratorCheckpoint> = {};

    for (const [workspaceId, cp] of Object.entries(checkpoints)) {
      if (!this.isCheckpointCompatible(cp)) {
        mutated = true;
        logger.warn("orchestrator", "Dropping incompatible checkpoint version", {
          workspaceId,
          foundVersion: cp.version,
          expectedVersion: CHECKPOINT_VERSION,
        });
        continue;
      }
      if (!this.isCheckpointFresh(cp)) {
        mutated = true;
        logger.info("orchestrator", "Dropping stale checkpoint", {
          workspaceId,
          ageMs: Date.now() - cp.savedAt,
          ttlMs: CHECKPOINT_TTL_MS,
        });
        continue;
      }
      kept[workspaceId] = cp;
    }

    if (mutated) {
      await this.saveCheckpoints(kept);
    }
    return kept;
  }

  private async saveCheckpoints(
    checkpoints: Record<string, OrchestratorCheckpoint>,
  ): Promise<void> {
    try {
      await chrome.storage.local.set({ [CHECKPOINTS_STORAGE_KEY]: checkpoints });
    } catch (error) {
      logger.warn("orchestrator", "Failed to save checkpoints", { error });
    }
  }

  private async persistTaskCheckpoint(task: OrchestratorTask): Promise<void> {
    const checkpoints = await this.loadCheckpoints();
    checkpoints[task.workspaceId] = {
      version: CHECKPOINT_VERSION,
      savedAt: Date.now(),
      task: {
        ...task,
        nodes: task.nodes.map((n) => ({ ...n })),
      },
    };
    await this.saveCheckpoints(checkpoints);
  }

  private async clearTaskCheckpoint(workspaceId: string): Promise<void> {
    const checkpoints = await this.loadCheckpoints();
    if (!checkpoints[workspaceId]) return;
    delete checkpoints[workspaceId];
    await this.saveCheckpoints(checkpoints);
  }

  private async resolveResumeTabId(
    workspaceId: string,
    preferredTabId: number,
  ): Promise<number | null> {
    // Prefer the originally bound tab if it still exists.
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id) return tab.id;
    } catch {
      // fall through
    }

    // Otherwise pick any live tab from the workspace.
    const ws = await workspaceManager.getWorkspaceById(workspaceId);
    for (const tabId of ws?.tabIds ?? []) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) return tab.id;
      } catch {
        // skip stale tab IDs
      }
    }

    return null;
  }

  private async buildResumeInput(
    task: OrchestratorTask,
    resumeTabId: number,
  ): Promise<OrchestratorStartInput | null> {
    const stored = await chrome.storage.sync.get("userSettings");
    const settings = (stored.userSettings ?? {}) as UserSettings;

    const openRouterApiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
    if (!openRouterApiKey) {
      logger.warn("orchestrator", "Cannot resume task without OpenRouter API key", {
        workspaceId: task.workspaceId,
      });
      return null;
    }

    return {
      query: task.query,
      tabId: resumeTabId,
      workspaceId: task.workspaceId,
      settings,
      openRouterApiKey,
      groqApiKey: settings.groqApiKey || __GROQ_API_KEY__ || undefined,
      cerebrasApiKey: settings.cerebrasApiKey || __CEREBRAS_API_KEY__ || undefined,
    };
  }

  public async restoreFromCheckpoints(): Promise<void> {
    const checkpoints = await this.pruneCheckpoints(await this.loadCheckpoints());
    const entries = Object.values(checkpoints);
    if (entries.length === 0) return;

    logger.info("orchestrator", "Found orchestrator checkpoints", {
      count: entries.length,
    });

    for (const cp of entries) {
      const task = cp.task;
      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "stopped"
      ) {
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      const resumeTabId = await this.resolveResumeTabId(
        task.workspaceId,
        task.rootTabId,
      );
      if (!resumeTabId) {
        logger.warn("orchestrator", "Cannot resume checkpoint, no live workspace tab", {
          workspaceId: task.workspaceId,
          taskId: task.id,
        });
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      const resumeInput = await this.buildResumeInput(task, resumeTabId);
      if (!resumeInput) {
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      // "running" is transient; restart these nodes as pending and continue.
      task.nodes = task.nodes.map((node) =>
        node.status === "running" ? { ...node, status: "pending" } : node,
      );
      task.status = "running";
      task.currentIndex = currentIndex(task.nodes);
      this.tasksByWorkspace.set(task.workspaceId, task);
      this.workersByWorkspace.set(task.workspaceId, new Map());
      await this.persistTaskCheckpoint(task);

      const completedSubtasks = task.nodes.filter(
        (n) => n.status === "completed",
      ).length;
      const pendingSubtasks = task.nodes.filter(
        (n) => n.status === "pending",
      ).length;
      this.sendMessage({
        type: "TASK_RECOVERY",
        workspaceId: task.workspaceId,
        payload: {
          taskId: task.id,
          totalSubtasks: task.nodes.length,
          completedSubtasks,
          pendingSubtasks,
        },
      });
      this.sendStatus(task.workspaceId, AgentStatus.ACTING, "Recovered task, resuming...");
      this.sendProgress(task);

      // Fire-and-forget: each task resumes independently.
      this.runTask(task, resumeInput).catch(async (error) => {
        logger.error("orchestrator", "Recovered task failed", {
          workspaceId: task.workspaceId,
          taskId: task.id,
          error,
        });
        task.status = "failed";
        task.finishedAt = Date.now();
        await this.clearTaskCheckpoint(task.workspaceId);
        this.tasksByWorkspace.delete(task.workspaceId);
        this.workersByWorkspace.delete(task.workspaceId);
        this.sendStatus(task.workspaceId, AgentStatus.ERROR, "Recovered task failed");
      });
    }
  }

  hasActiveTasks(): boolean {
    return this.tasksByWorkspace.size > 0;
  }

  async startTask(input: OrchestratorStartInput): Promise<void> {
    const existing = this.tasksByWorkspace.get(input.workspaceId);
    if (existing) {
      await this.stopTask(input.workspaceId);
    }

    const taskId = crypto.randomUUID();
    const task: OrchestratorTask = {
      id: taskId,
      workspaceId: input.workspaceId,
      rootTabId: input.tabId,
      query: input.query,
      status: "planning",
      createdAt: Date.now(),
      nodes: [],
      maxWorkers: Math.max(
        1,
        Math.min(8, input.settings.orchestratorMaxWorkers || DEFAULT_MAX_WORKERS),
      ),
      currentIndex: 0,
    };
    this.tasksByWorkspace.set(input.workspaceId, task);
    this.workersByWorkspace.set(input.workspaceId, new Map());
    await this.persistTaskCheckpoint(task);

    this.sendStatus(input.workspaceId, AgentStatus.THINKING, "Planning task...");

    let nodes: TaskNode[] = [];
    try {
      const planner = new OrchestratorPlanner(
        input.openRouterApiKey,
        input.cerebrasApiKey,
      );
      const tab = await chrome.tabs.get(input.tabId);
      nodes = await planner.buildNodes(
        input.query,
        tab.title || "Untitled",
        tab.url || "",
      );
    } catch (error: any) {
      logger.warn("orchestrator", "Planner failed, using single node", {
        error: error?.message,
      });
      nodes = [
        {
          id: crypto.randomUUID(),
          description: input.query,
          status: "pending",
          retries: 0,
        },
      ];
    }

    if (task.status === "stopped") {
      task.finishedAt = Date.now();
      this.tasksByWorkspace.delete(task.workspaceId);
      this.workersByWorkspace.delete(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      return;
    }

    task.nodes = nodes;
    task.status = "running";
    task.startedAt = Date.now();
    await this.persistTaskCheckpoint(task);

    this.sendProgress(task);
    this.sendStatus(input.workspaceId, AgentStatus.ACTING, "Executing subtasks...");

    await this.runTask(task, input);
  }

  private async runTask(
    task: OrchestratorTask,
    input: OrchestratorStartInput,
  ): Promise<void> {
    const queue = [...task.nodes];
    const running = new Set<Promise<void>>();
    let initialTabConsumed = false;
    let initialTabUrl = "about:blank";
    try {
      initialTabUrl = (await chrome.tabs.get(input.tabId)).url || "about:blank";
    } catch {
      // If the tab disappears between restore/start and execution, worker tabs still boot safely.
    }

    const launchWorker = async (node: TaskNode): Promise<void> => {
      if (task.status !== "running") return;

      node.status = "running";
      task.currentIndex = currentIndex(task.nodes);
      this.sendProgress(task);
      await this.persistTaskCheckpoint(task);

      const workerId = crypto.randomUUID();
      const tabId = initialTabConsumed
        ? await this.createWorkerTab(initialTabUrl, task.workspaceId)
        : input.tabId;
      initialTabConsumed = true;

      const snapshot = await this.getSnapshot(tabId, input.settings.showElementTags ?? false);

      const loop = new AgentLoop(
        input.openRouterApiKey,
        input.groqApiKey,
        input.cerebrasApiKey,
        {
          onStatusUpdate: (_status, _detail) => {
            // Task-level status is emitted by orchestrator.
          },
          onMessage: () => {
            // Worker-level summaries are aggregated by orchestrator.
          },
          onStep: (step, update) => {
            this.sendMessage({
              type: "AGENT_STEP",
              workspaceId: task.workspaceId,
              payload: { step, update },
            });
          },
        },
        {
          maxContextTokens: input.settings.contextWindowSize || 32000,
          maxTurns: input.settings.maxTurns || 30,
          showElementTags: input.settings.showElementTags ?? false,
          showSessionMetrics: false,
          disabledTools: buildDisabledTools(input.settings),
          workspaceId: task.workspaceId,
          workerId,
          taskId: task.id,
          nodeId: node.id,
          suppressUiBroadcast: true,
          disableInternalPlanning: true,
          bypassApprovals: input.settings.bypassApprovals ?? false,
          onMemoryAdd: (item: BufferedMemory) => {
            this.memoryBuffer.add(workerId, item);
          },
        },
      );

      const wsWorkers = this.workersByWorkspace.get(task.workspaceId)!;
      wsWorkers.set(workerId, { workerId, nodeId: node.id, tabId, loop });

      try {
        const result = await loop.start(node.description, tabId, snapshot, {
          clearHistory: true,
        });
        if (result.outcome === "completed") {
          node.status = "completed";
          node.result = result.summary;
          await this.memoryBuffer.commitWorker(workerId);
        } else if (node.retries < NODE_MAX_RETRIES && task.status === "running") {
          node.status = "pending";
          node.retries += 1;
          queue.push(node);
        } else {
          node.status = "failed";
          node.error = result.summary;
          this.memoryBuffer.discardWorker(workerId);
        }
      } catch (error: any) {
        if (node.retries < NODE_MAX_RETRIES && task.status === "running") {
          node.status = "pending";
          node.retries += 1;
          queue.push(node);
        } else {
          node.status = "failed";
          node.error = error?.message || String(error);
          this.memoryBuffer.discardWorker(workerId);
        }
      } finally {
        wsWorkers.delete(workerId);
        task.currentIndex = currentIndex(task.nodes);
        this.sendProgress(task);
        await this.persistTaskCheckpoint(task);
      }
    };

    while (queue.length > 0 || running.size > 0) {
      while (
        task.status === "running" &&
        queue.length > 0 &&
        running.size < task.maxWorkers
      ) {
        const node = queue.shift()!;
        const tracked = launchWorker(node);
        running.add(tracked);
        tracked.finally(() => running.delete(tracked));
      }
      if (running.size > 0) {
        await Promise.race(running);
      }
      if (task.status !== "running") break;
    }

    if (task.status === "stopped") {
      task.finishedAt = Date.now();
      this.tasksByWorkspace.delete(task.workspaceId);
      this.workersByWorkspace.delete(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      return;
    }

    const completed = task.nodes.filter((n) => n.status === "completed").length;
    const failed = task.nodes.filter((n) => n.status === "failed").length;
    task.finishedAt = Date.now();
    task.status = failed > 0 ? "failed" : "completed";

    const summary = await this.summarizeTask(task, input.openRouterApiKey);
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: summary, done: false },
    });
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

    const subtaskResults: SubtaskResult[] = task.nodes.map((node) => ({
      description: node.description,
      status: node.status === "completed" ? "completed" : "failed",
      turnsUsed: 0,
      result: node.result || node.error || "",
    }));

    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: {
        taskId: task.id,
        status: failed > 0 ? (completed > 0 ? "partial" : "failed") : "completed",
        totalTurnsUsed: 0,
        totalTimeMs: task.finishedAt - (task.startedAt || task.createdAt),
        summary,
        subtaskResults,
        urlHistory: [],
      },
    });

    this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Task complete");
    this.tasksByWorkspace.delete(task.workspaceId);
    this.workersByWorkspace.delete(task.workspaceId);
    await this.clearTaskCheckpoint(task.workspaceId);
  }

  async stopTask(workspaceId?: string): Promise<void> {
    if (workspaceId) {
      this.stopWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.tasksByWorkspace.keys()) {
      this.stopWorkspace(wsId);
    }
  }

  pauseTask(workspaceId?: string): void {
    if (workspaceId) {
      this.pauseWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.workersByWorkspace.keys()) {
      this.pauseWorkspace(wsId);
    }
  }

  resumeTask(workspaceId?: string): void {
    if (workspaceId) {
      this.resumeWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.workersByWorkspace.keys()) {
      this.resumeWorkspace(wsId);
    }
  }

  injectHint(workspaceId: string, text: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    if (!workers) return;
    for (const worker of workers.values()) {
      worker.loop.injectHint(text);
      if (worker.loop.isPaused()) worker.loop.resume();
    }
  }

  private stopWorkspace(workspaceId: string): void {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (!task) return;
    task.status = "stopped";
    void this.persistTaskCheckpoint(task);
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.stop();
      this.memoryBuffer.discardWorker(worker.workerId);
    }
    workers?.clear();
  }

  private pauseWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.pause();
    }
  }

  private resumeWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.resume();
    }
  }

  private async createWorkerTab(url: string, workspaceId: string): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("Failed to create worker tab");
    await workspaceManager.addTabToWorkspace(tab.id, workspaceId);
    return tab.id;
  }

  private async getSnapshot(tabId: number, showTags: boolean): Promise<any | undefined> {
    try {
      try {
        const manifest = chrome.runtime.getManifest();
        const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0];
        if (contentScriptPath) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [contentScriptPath],
          });
        }
      } catch {
        // no-op
      }
      await waitForContentScriptReady(tabId, 2000);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { includeText: true, refresh: true, showTags },
      });
      return response.payload.snapshot;
    } catch {
      return undefined;
    }
  }

  private async summarizeTask(
    task: OrchestratorTask,
    openRouterApiKey: string,
  ): Promise<string> {
    const deterministic = task.nodes
      .map((n, i) => {
        const status = n.status === "completed" ? "done" : "failed";
        const detail = n.result || n.error || "No detail";
        return `${i + 1}. [${status}] ${n.description} - ${detail}`;
      })
      .join("\n");

    try {
      const llm = new LLMClient(openRouterApiKey, undefined, undefined);
      llm.switchToSmart();
      const response = await llm.complete({
        messages: [
          {
            role: "system",
            content:
              "Summarize task execution faithfully. Do not invent missing work. Mention failures explicitly.",
          },
          {
            role: "user",
            content: `Task: ${task.query}\n\nExecution log:\n${deterministic}\n\nWrite a concise completion summary.`,
          },
        ],
        max_tokens: 300,
        temperature: 0,
      });
      const content = (response.content || "").trim();
      if (content.length > 0) return content;
      return deterministic;
    } catch {
      return deterministic;
    }
  }

  private sendProgress(task: OrchestratorTask): void {
    this.sendMessage({
      type: "TASK_PROGRESS",
      workspaceId: task.workspaceId,
      payload: {
        taskId: task.id,
        subtasks: toSubtasks(task.nodes),
        currentIndex: task.currentIndex,
        totalTurnsUsed: 0,
      },
    });
  }

  private sendStatus(
    workspaceId: string,
    status: AgentStatus,
    detail: string,
  ): void {
    this.sendMessage({
      type: "AGENT_STATUS",
      workspaceId,
      payload: { status, detail },
    });
  }

  private sendMessage(
    message: {
      type: string;
      payload: any;
      workspaceId?: string | null;
    },
  ): void {
    chrome.runtime
      .sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
      } as any)
      .catch((error) => {
        logger.debug("orchestrator", "Failed to send runtime message", { error });
      });
  }
}

export const orchestrator = new Orchestrator();
