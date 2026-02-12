import {
    AgentStatus,
    AgentLoopState,
    AgentStep,
    MessageSource,
    OverlayDescriptor,
    SessionMetrics,
    SubtaskResult,
    SubtaskSummary,
    ToolCall,
    ToolName,
    UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { LLMClient, MODEL_SMART } from "../llm";
import { toolRegistry, setVisionUsageCallback } from "../tools";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";
import { classifyRisk } from "../security";
import { ContextManager } from "./context";
import { ProgressTracker } from "./progress";
import { recoverToolCallsFromText } from "./tool-recovery";
import { DomSnapshot } from "../../types";
import { CompletionResponse, TokenUsage } from "../llm/types";
import { startKeepalive, stopKeepalive } from "../keepalive";
import { formatStepLabel } from "./step-labels";
import { PlanGuardian } from "./guardian";

/** Max times done() can be rejected before the safety valve forces it through */
const MAX_DONE_REJECTIONS = 3;

/** Nudge injected when LLM emits text instead of tool calls. */
const NUDGE_MESSAGE = "You must call at least one tool each turn. If unsure what's on the page, call read_page or take_screenshot. Follow the Think step:\n1. What do I see on the page right now?\n2. What tool call will advance the task?\n3. What do I expect to happen?\nThen call that tool. If the task is fully complete, call done({\"summary\": \"...\"}).";

/** Result of a completed agent loop run */
export interface LoopResult {
    outcome: "completed" | "stopped" | "max_turns" | "error";
    turnCount: number;
    /** Summary from done() tool, or error message */
    summary: string;
    /** Session token/cost/time metrics */
    metrics?: SessionMetrics;
}

export class AgentLoop {
    private llm: LLMClient;
    private context: ContextManager;
    private isRunning = false;
    private abortController: AbortController | null = null;
    private statusHandler: (status: AgentStatus, detail: string) => void;
    private messageHandler: (text: string, toolCalls: ToolCall[]) => void;
    private stepHandler: (step: AgentStep, update: boolean) => void;
    private maxTurns: number;
    private showElementTags: boolean;
    private confirmPlan: boolean;
    private showSessionMetrics: boolean;

    /** Current turn count — exposed via getCurrentTurn() */
    private turnCount = 0;
    /** Original user query that started this loop */
    private originalQuery = "";
    /** Progress tracker — promoted from local to instance for external access */
    private progress = new ProgressTracker();
    /** Pending hint from the user, picked up on the next turn */
    private pendingHint: string | null = null;
    /** Promise-based gate for pause/resume */
    private pauseGate: { promise: Promise<void>; resolve: () => void } | null = null;

    /** Plan guardian — smart model for decomposition and done validation */
    private guardian: PlanGuardian;
    /** Number of times done() has been rejected by the guardian */
    private doneRejections = 0;

    /** Task planning state */
    private taskId: string | null = null;
    private planSubtasks: SubtaskSummary[] = [];
    private taskStartTime = 0;
    private urlHistory: string[] = [];

    /** Accumulated session metrics */
    private metrics: SessionMetrics = AgentLoop.emptyMetrics();
    private sessionStartTime = 0;

    private static emptyMetrics(): SessionMetrics {
        return {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCost: 0,
            totalLlmTimeMs: 0,
            totalSessionTimeMs: 0,
            llmCallCount: 0,
            modelBreakdown: {},
        };
    }

    /** Accumulate usage from an LLM response */
    private recordUsage(response: CompletionResponse, llmMs: number): void {
        if (response.usage) {
            this.metrics.totalPromptTokens += response.usage.prompt_tokens;
            this.metrics.totalCompletionTokens += response.usage.completion_tokens;
            this.metrics.totalTokens += response.usage.total_tokens;
            if (response.usage.cost != null) {
                this.metrics.totalCost += response.usage.cost;
            }
        }
        this.metrics.totalLlmTimeMs += llmMs;
        this.metrics.llmCallCount += 1;

        const model = this.llm.getCurrentModel();
        if (!this.metrics.modelBreakdown[model]) {
            this.metrics.modelBreakdown[model] = { promptTokens: 0, completionTokens: 0, cost: 0, calls: 0 };
        }
        const entry = this.metrics.modelBreakdown[model];
        entry.calls += 1;
        if (response.usage) {
            entry.promptTokens += response.usage.prompt_tokens;
            entry.completionTokens += response.usage.completion_tokens;
            if (response.usage.cost != null) {
                entry.cost += response.usage.cost;
            }
        }
    }

    /** Record usage from a vision API call */
    public recordVisionUsage(usage: TokenUsage, llmMs: number, model: string): void {
        this.metrics.totalPromptTokens += usage.prompt_tokens;
        this.metrics.totalCompletionTokens += usage.completion_tokens;
        this.metrics.totalTokens += usage.total_tokens;
        if (usage.cost != null) {
            this.metrics.totalCost += usage.cost;
        }
        this.metrics.totalLlmTimeMs += llmMs;
        this.metrics.llmCallCount += 1;

        if (!this.metrics.modelBreakdown[model]) {
            this.metrics.modelBreakdown[model] = { promptTokens: 0, completionTokens: 0, cost: 0, calls: 0 };
        }
        const entry = this.metrics.modelBreakdown[model];
        entry.calls += 1;
        entry.promptTokens += usage.prompt_tokens;
        entry.completionTokens += usage.completion_tokens;
        if (usage.cost != null) {
            entry.cost += usage.cost;
        }
    }

    /** Get the current accumulated metrics snapshot */
    public getMetrics(): SessionMetrics {
        return { ...this.metrics, totalSessionTimeMs: Date.now() - this.sessionStartTime };
    }

    /** Broadcast metrics to side panel (throttled) */
    private broadcastMetrics(): void {
        if (!this.showSessionMetrics) return;
        // Throttle: every 3 turns or on turn 1
        if (this.turnCount !== 1 && this.turnCount % 3 !== 0) return;

        this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
        chrome.runtime.sendMessage({
            type: "SESSION_METRICS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: { ...this.metrics },
        }).catch(() => {});
    }

    constructor(
        apiKey: string,
        callbacks: {
            onStatusUpdate: (status: AgentStatus, detail: string) => void;
            onMessage: (text: string, toolCalls: ToolCall[]) => void;
            onStep?: (step: AgentStep, update: boolean) => void;
        },
        options?: { maxContextTokens?: number; maxTurns?: number; showElementTags?: boolean; confirmPlan?: boolean; showSessionMetrics?: boolean }
    ) {
        this.confirmPlan = options?.confirmPlan ?? false;
        this.showSessionMetrics = options?.showSessionMetrics ?? false;
        this.llm = new LLMClient(apiKey);
        this.guardian = new PlanGuardian(apiKey);
        this.context = new ContextManager(options?.maxContextTokens);
        this.statusHandler = callbacks.onStatusUpdate;
        this.messageHandler = callbacks.onMessage;
        this.stepHandler = callbacks.onStep ?? (() => {});
        this.maxTurns = options?.maxTurns ?? 30;
        this.showElementTags = options?.showElementTags ?? false;
    }

    public async start(
        initialUserText: string,
        tabId: number,
        initialSnapshot?: DomSnapshot,
        options?: { clearHistory?: boolean }
    ): Promise<LoopResult> {
        if (this.isRunning) {
            this.stop();
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.turnCount = 0;
        this.originalQuery = initialUserText;
        this.progress.reset();
        this.pendingHint = null;
        this.taskId = null;
        this.planSubtasks = [];
        this.taskStartTime = Date.now();
        this.urlHistory = [];
        this.doneRejections = 0;
        this.metrics = AgentLoop.emptyMetrics();
        this.sessionStartTime = Date.now();

        // Clear or restore context
        if (options?.clearHistory) {
            this.context.clear();
        } else {
            // Restore context from session storage to handle SW restarts
            await this.context.loadState();
        }

        if (initialSnapshot) {
            this.context.setSnapshot(initialSnapshot);
        }

        // 2. Add User Message (with plan prefix when confirmPlan is enabled)
        const userContent = this.confirmPlan
            ? `Before executing, briefly outline your action plan as a numbered list. Then wait for my approval. After I approve, proceed with execution.\n\n${initialUserText}`
            : initialUserText;
        this.context.addMessage({
            role: "user",
            content: userContent
        });

        // --- Guardian: decompose task into plan (task-agnostic) ---
        if (!this.confirmPlan) {
            try {
                this.stepHandler({
                    id: crypto.randomUUID(),
                    type: "thinking",
                    label: "Analyzing task scope...",
                    status: "running",
                    timestamp: Date.now(),
                }, false);

                const decomposition = await this.guardian.decompose(
                    initialUserText,
                    this.context.getSnapshot()?.title || "",
                    this.context.getSnapshot()?.url || "",
                    this.abortController!.signal,
                );

                if (decomposition) {
                    this.taskId = crypto.randomUUID();
                    this.taskStartTime = Date.now();
                    this.planSubtasks = decomposition.subtasks.map((desc, i) => ({
                        description: desc,
                        status: i === 0 ? "running" as const : "pending" as const,
                        turnsUsed: 0,
                        turnBudget: 0,
                    }));

                    this.context.addMessage({
                        role: "user",
                        content: `[Plan Guardian]: This is a multi-step task (${decomposition.subtasks.length} steps). Your plan:\n`
                            + decomposition.subtasks.map((s, i) => `${i + 1}. ${s}`).join("\n")
                            + `\n\nExecute step 1 now. Call update_plan({subtasks, currentIndex, lastResult}) after each step to report progress. `
                            + `Do NOT call done() until ALL ${decomposition.subtasks.length} steps are complete.`,
                    });

                    chrome.runtime.sendMessage({
                        type: "TASK_PROGRESS",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: {
                            taskId: this.taskId,
                            subtasks: this.planSubtasks,
                            currentIndex: 0,
                            totalTurnsUsed: 0,
                        },
                    }).catch(() => {});

                    this.stepHandler({
                        id: crypto.randomUUID(),
                        type: "info",
                        label: `Plan: ${decomposition.subtasks.length} steps`,
                        status: "done",
                        timestamp: Date.now(),
                    }, false);
                }
            } catch (err: any) {
                logger.warn("agent", "Guardian decompose error (non-fatal)", { error: err?.message });
            }
        }

        this.statusHandler(AgentStatus.THINKING, "Analyzing...");

        // Register vision usage callback so screenshot tool can report token usage
        setVisionUsageCallback((usage, durationMs, model) => {
            this.recordVisionUsage(usage, durationMs, model);
        });

        // Register guardian usage callback for metrics tracking
        this.guardian.setUsageCallback((usage, llmMs) => {
            this.recordUsage(
                { role: "assistant", content: null, finish_reason: "stop", usage } as CompletionResponse,
                llmMs,
            );
        });

        // Start keepalive alarm to prevent SW termination
        await startKeepalive();

        let result: LoopResult = { outcome: "completed", turnCount: 0, summary: "", metrics: undefined };
        try {
            result = await this.loop(tabId);
        } catch (error: any) {
            if (error.name === "AbortError") {
                logger.info("agent", "Agent stopped by user");
                this.statusHandler(AgentStatus.IDLE, "Stopped");
                result = { outcome: "stopped", turnCount: this.turnCount, summary: "Stopped by user", metrics: this.getMetrics() };
            } else {
                logger.error("agent", "Loop Error", { error });
                const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: errorMsg, done: false },
                }).catch(() => {});
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: "", done: true },
                }).catch(() => {});
                this.statusHandler(AgentStatus.ERROR, error.message);
                result = { outcome: "error", turnCount: this.turnCount, summary: error.message, metrics: this.getMetrics() };
            }
        } finally {
            setVisionUsageCallback(null);
            await stopKeepalive();
            this.isRunning = false;
        }
        return result;
    }

    public stop() {
        // Resolve pause gate first so the loop can exit cleanly
        if (this.pauseGate) {
            this.pauseGate.resolve();
            this.pauseGate = null;
        }
        this.abortController?.abort();
        this.isRunning = false;
    }

    /** Queue a user hint to be picked up on the next turn */
    public injectHint(text: string): void {
        this.pendingHint = text;
    }

    /** Get the current turn number */
    public getCurrentTurn(): number {
        return this.turnCount;
    }

    /** Get the original user query that started this loop */
    public getOriginalQuery(): string {
        return this.originalQuery;
    }

    /** Get the progress tracker instance (for external queries) */
    public getProgressTracker(): ProgressTracker {
        return this.progress;
    }

    /** Pause the agent loop — blocks at the top of the next iteration */
    public pause(): void {
        if (!this.pauseGate) {
            let resolve: () => void;
            const promise = new Promise<void>(r => { resolve = r; });
            this.pauseGate = { promise, resolve: resolve! };
            this.statusHandler(AgentStatus.PAUSED, "Paused by user");
        }
    }

    /** Resume a paused agent loop */
    public resume(): void {
        if (this.pauseGate) {
            this.pauseGate.resolve();
            this.pauseGate = null;
            this.statusHandler(AgentStatus.THINKING, "Resumed");
        }
    }

    /** Whether the loop is currently paused */
    public isPaused(): boolean {
        return this.pauseGate !== null;
    }

    /**
     * LLM fallback for overlay dismissal — called when heuristics can't remove a
     * viewport-covering overlay. Sends the overlay HTML to a fast vision model
     * to identify which button to click.
     */
    private async dismissOverlayWithLLM(overlay: OverlayDescriptor, tabId: number): Promise<void> {
        try {
            const stored = await chrome.storage.sync.get("userSettings");
            const settings = (stored.userSettings ?? {}) as UserSettings;
            const apiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
            if (!apiKey) return;

            const visionModel = settings.visionModel || "google/gemini-2.0-flash-001";
            const prompt = `You are a browser automation assistant. A modal/overlay is blocking the page.
HTML (truncated):
\`\`\`html
${overlay.html}
\`\`\`
Covers ${overlay.coveragePercent}% of viewport.

Respond with ONE JSON object, no markdown:
{"action":"click","selector":"CSS_SELECTOR"}
or {"action":"hide"}

Prefer "click" if a close/dismiss/accept button exists.`;

            const callStart = Date.now();
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    "HTTP-Referer": "chrome-extension://opensidebar",
                    "X-Title": "OpenSidebar",
                },
                body: JSON.stringify({
                    model: visionModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 150,
                    temperature: 0,
                }),
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) return;

            const json = await response.json();
            const text: string = json.choices?.[0]?.message?.content || "";
            const llmMs = Date.now() - callStart;

            // Record usage for metrics
            if (json.usage) {
                this.recordVisionUsage(
                    {
                        prompt_tokens: json.usage.prompt_tokens ?? 0,
                        completion_tokens: json.usage.completion_tokens ?? 0,
                        total_tokens: json.usage.total_tokens ?? 0,
                        cost: json.usage.cost,
                    },
                    llmMs,
                    visionModel,
                );
            }

            // Parse JSON response (strip markdown fences if present)
            const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned) as { action: string; selector?: string };

            if (parsed.action === "click" && parsed.selector) {
                await chrome.tabs.sendMessage(tabId, {
                    type: "DISMISS_MODALS",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { clickSelector: parsed.selector, overlayTagId: overlay.tagId },
                });
                logger.info("agent", "LLM overlay dismiss: click", { selector: parsed.selector, tagId: overlay.tagId });
            } else {
                // hide action — use TOOL_EXECUTE with hide_element
                await chrome.tabs.sendMessage(tabId, {
                    type: "TOOL_EXECUTE",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { toolName: ToolName.HIDE_ELEMENT, args: { id: overlay.tagId }, toolCallId: crypto.randomUUID() },
                });
                logger.info("agent", "LLM overlay dismiss: hide", { tagId: overlay.tagId });
            }
        } catch (err: any) {
            // Non-critical — agent proceeds normally
            logger.debug("agent", "LLM overlay dismiss failed (non-critical)", { error: err?.message });
        }
    }

    /** Escalate to smart model when stuck. */
    private escalateModel(): void {
        this.llm.switchModel(MODEL_SMART);
        logger.info("agent", "Escalating to smart model", { model: MODEL_SMART });
    }

    /** Refresh DOM snapshot and update context. Returns element count or -1 on failure. */
    private async refreshSnapshot(tabId: number): Promise<number> {
        try {
            const snapResponse = await chrome.tabs.sendMessage(tabId, {
                type: "DOM_SNAPSHOT_REQUEST",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { includeText: true, refresh: true, showTags: this.showElementTags },
            });
            if (snapResponse?.payload?.snapshot) {
                this.context.setSnapshot(snapResponse.payload.snapshot);
                return snapResponse.payload.snapshot.elements.length;
            }
        } catch { /* non-critical */ }
        return -1;
    }

    /** Refresh snapshot with retry — used after model escalation where fresh context is critical. */
    private async refreshSnapshotWithRetry(tabId: number, prevCount: number): Promise<number> {
        let count = await this.refreshSnapshot(tabId);
        if (count >= 0) return count;
        // Retry once after a brief delay
        await new Promise(r => setTimeout(r, 300));
        count = await this.refreshSnapshot(tabId);
        if (count >= 0) return count;
        return prevCount; // Keep existing count if both attempts fail
    }

    private async loop(tabId: number): Promise<LoopResult> {
        let prevElementCount = -1; // Track element count for empty-page retry
        let consecutiveNudges = 0;
        let totalNudges = 0;
        let escalated = false;
        let doneSummary = "";
        let wasStuck = false; // Track stuck state for "resolved" signal

        // Pre-agent modal auto-dismiss (always, before first LLM turn)
        try {
            const dismissResult = await chrome.tabs.sendMessage(tabId, {
                type: "DISMISS_MODALS",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {},
            });
            const dismissed = dismissResult?.payload?.dismissed ?? 0;
            if (dismissed > 0) {
                logger.info("agent", "Auto-dismissed modals", { dismissed });
                await new Promise(r => setTimeout(r, 100));
            }

            // LLM fallback for overlays that resist heuristic dismissal
            const remainingOverlay = dismissResult?.payload?.remainingOverlay ?? null;
            if (remainingOverlay && this.abortController) {
                logger.info("agent", "Heuristics left remaining overlay, trying LLM fallback", {
                    tagId: remainingOverlay.tagId,
                    coverage: remainingOverlay.coveragePercent,
                });
                await this.dismissOverlayWithLLM(remainingOverlay, tabId);
                await new Promise(r => setTimeout(r, 200)); // DOM settle
            }
        } catch { /* non-critical */ }

        while (this.isRunning && this.turnCount < this.maxTurns) {
            // Pause gate — block here if user paused the loop
            if (this.pauseGate) await this.pauseGate.promise;
            if (!this.isRunning) break; // Check again after resume (user may have stopped)

            this.turnCount++;

            // Inject pending hint from user before LLM call
            if (this.pendingHint) {
                this.context.addMessage({ role: "user", content: `[User hint]: ${this.pendingHint}` });
                this.pendingHint = null;
            }

            // Broadcast turn progress to side panel (throttled: every 5 turns)
            if (this.turnCount === 1 || this.turnCount % 5 === 0) {
                chrome.runtime.sendMessage({
                    type: "AGENT_TURN",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { turn: this.turnCount, maxTurns: this.maxTurns },
                }).catch(() => {});
            }

            // 1. LLM Inference (streamed)
            const messages = this.context.getPrompt();
            const tools = toolRegistry.getDefinitions();

            // Log context metrics for telemetry (reuse already-computed prompt)
            const metrics = this.context.getPromptMetricsFrom(messages);
            if (prevElementCount < 0) prevElementCount = metrics.elementCount;
            logger.info("agent", "Context metrics", {
                turn: this.turnCount,
                systemTokens: metrics.systemTokens,
                historyTokens: metrics.historyTokens,
                totalTokens: metrics.totalTokens,
                utilization: Math.round(metrics.utilization * 100) + "%",
                elements: metrics.elementCount,
                compression: metrics.compressionLevel,
                toolCount: tools.length,
            });

            const thinkingStepId = crypto.randomUUID();
            const thinkingStep: AgentStep = {
                id: thinkingStepId,
                type: "thinking",
                label: this.turnCount === 1 ? "Planning approach" : "Thinking...",
                status: "running",
                timestamp: Date.now(),
            };
            this.stepHandler(thinkingStep, false);

            // Always stream deltas to side panel
            const onTextDelta = (delta: string) => {
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta, done: false },
                }).catch(() => { }); // Ignore if sidepanel closed
            };

            const llmStart = Date.now();
            let response: CompletionResponse;
            try {
                response = await this.llm.completeStream(
                    {
                        messages,
                        tools,
                        max_tokens: 4096,
                        stop: ["Observation:"], // ReAct pattern stop token just in case
                        signal: this.abortController!.signal,
                    },
                    onTextDelta
                );
            } catch (llmError: any) {
                if (llmError.name === "AbortError") throw llmError;
                if ((llmError as any).status === 402) {
                    const msg = llmError.message;
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: msg, done: false },
                    }).catch(() => {});
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "", done: true },
                    }).catch(() => {});
                    this.statusHandler(AgentStatus.ERROR, "Insufficient credits");
                    break;
                }
                throw llmError;
            }
            const llmMs = Date.now() - llmStart;

            // Accumulate token usage and broadcast metrics
            this.recordUsage(response, llmMs);
            this.broadcastMetrics();

            // Log LLM response summary for debugging
            const toolSummary = response.tool_calls?.map(tc => {
                let argSnippet = "";
                try { argSnippet = tc.function.arguments.slice(0, 80); } catch { /* */ }
                return `${tc.function.name}(${argSnippet})`;
            }) ?? [];
            logger.info("agent", "LLM response", {
                turn: this.turnCount,
                llmMs,
                url: this.context.getCurrentUrl(),
                text: response.content?.slice(0, 500) || null,
                toolCalls: toolSummary,
                toolCount: toolSummary.length,
            });

            // Full reasoning at DEBUG level (untruncated for performance analysis)
            if (response.content) {
                logger.debug("agent", "LLM reasoning (full)", { turn: this.turnCount, text: response.content });
            }

            // Recover tool calls from text output (models sometimes emit JSON as text)
            if ((!response.tool_calls || response.tool_calls.length === 0) && response.content) {
                const recovered = recoverToolCallsFromText(response.content);
                if (recovered && recovered.length > 0) {
                    logger.info("agent", "Recovered tool calls from text", {
                        turn: this.turnCount,
                        count: recovered.length,
                        tools: recovered.map(tc => tc.function.name),
                    });
                    response.tool_calls = recovered;
                }
            }

            const llmIntention = response.content?.slice(0, 300) || null;

            // 2. Add Assistant Message to History
            this.context.addMessage({
                role: "assistant",
                content: response.content,
                tool_calls: response.tool_calls ? response.tool_calls.map(tc => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                })) : undefined
            });

            // Mark thinking step as done
            this.stepHandler({
                ...thinkingStep,
                status: "done",
                durationMs: Date.now() - thinkingStep.timestamp,
            }, true);

            // 3. Handle Response
            if (response.tool_calls && response.tool_calls.length > 0) {
                // ACTION REQUIRED
                consecutiveNudges = 0;
                const firstToolName = response.tool_calls[0].function.name;
                this.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);

                // Thought text already delivered via STREAM_CHUNK deltas
                // Signal stream end so sidepanel finalizes the message
                if (response.content) {
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "", done: true },
                    }).catch(() => { });
                }

                // Execute Tools
                let doneSignaled = false;
                let domModified = false;

                // Determine if we can parallelize: no sequential tools present
                const hasSequentialTool = response.tool_calls.some(tc =>
                    SEQUENTIAL_TOOLS.has(tc.function.name as ToolName)
                );
                const canParallelize = !hasSequentialTool && response.tool_calls.length > 1;

                if (canParallelize) {
                    // PARALLEL EXECUTION
                    const results = await Promise.all(
                        response.tool_calls.map(async (toolCall) => {
                            const toolName = toolCall.function.name as ToolName;
                            let args: Record<string, unknown> = {};
                            try {
                                args = JSON.parse(toolCall.function.arguments);
                            } catch {
                                // Registry will handle parse error on execute
                            }

                            const riskLevel = classifyRisk(toolName, args);

                            const toolStep: AgentStep = {
                                id: crypto.randomUUID(),
                                type: "tool",
                                label: formatStepLabel(toolName, args),
                                detail: JSON.stringify(args),
                                toolName,
                                status: "running",
                                timestamp: Date.now(),
                            };
                            this.stepHandler(toolStep, false);

                            try {
                                const result = await toolRegistry.execute(toolCall, tabId, this.abortController!.signal);
                                const toolMs = Date.now() - toolStep.timestamp;
                                this.stepHandler({
                                    ...toolStep,
                                    status: "done",
                                    durationMs: toolMs,
                                }, true);
                                logger.info("tools", `${toolName} OK`, {
                                    turn: this.turnCount, tool: toolName, risk: riskLevel,
                                    mode: "parallel",
                                    args: JSON.stringify(args).slice(0, 500),
                                    result: result.slice(0, 1000),
                                    durationMs: toolMs, intention: llmIntention,
                                });

                                if (DOM_MODIFYING_TOOLS.has(toolName) && !result.includes("Click intercepted")) {
                                    domModified = true;
                                }

                                return { toolCall, result, error: null };
                            } catch (toolError: any) {
                                if (toolError.name === "AbortError") throw toolError;
                                const errorMsg = toolError.message || String(toolError);
                                const toolMs = Date.now() - toolStep.timestamp;
                                logger.error("tools", `${toolName} FAIL`, {
                                    turn: this.turnCount, tool: toolName, risk: riskLevel,
                                    mode: "parallel",
                                    args: JSON.stringify(args).slice(0, 500),
                                    error: errorMsg,
                                    durationMs: toolMs, intention: llmIntention,
                                });
                                this.stepHandler({
                                    ...toolStep,
                                    status: "error",
                                    durationMs: Date.now() - toolStep.timestamp,
                                    errorMessage: errorMsg,
                                }, true);
                                return { toolCall, result: null, error: errorMsg };
                            }
                        })
                    );

                    // Add all results to context
                    for (const { toolCall, result, error } of results) {
                        this.context.addMessage({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: error ? `Error: ${error}` : result!,
                        });
                    }
                } else {
                    // SEQUENTIAL EXECUTION (has sequential tools or single tool)
                    for (const toolCall of response.tool_calls) {
                        if (!this.isRunning) break;

                        // Parse args for risk classification and done detection
                        const toolName = toolCall.function.name as ToolName;
                        let args: Record<string, unknown> = {};
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        } catch {
                            // Registry will handle parse error on execute
                        }

                        // Risk classification (informational, non-blocking)
                        const riskLevel = classifyRisk(toolName, args);

                        // DONE tool — guardian-validated exit
                        if (toolName === ToolName.DONE) {
                            const summary = (args.summary as string) || "Task completed.";

                            // Guardian validation: only when a plan exists
                            if (this.taskId && this.planSubtasks.length > 0) {
                                let shouldReject = false;
                                let rejectReason = "";

                                try {
                                    this.stepHandler({
                                        id: crypto.randomUUID(),
                                        type: "thinking",
                                        label: "Verifying completion...",
                                        status: "running",
                                        timestamp: Date.now(),
                                    }, false);

                                    const validation = await this.guardian.validateDone(
                                        this.originalQuery,
                                        this.planSubtasks,
                                        summary,
                                        this.context.getSnapshot()?.title || "",
                                        this.context.getSnapshot()?.url || "",
                                        this.abortController!.signal,
                                    );

                                    if (!validation.approved) {
                                        shouldReject = true;
                                        rejectReason = validation.reason || "Task is not yet complete.";
                                    }
                                } catch (err: any) {
                                    // Guardian call failed — structural fallback
                                    const completedCount = this.planSubtasks.filter(s => s.status === "completed").length;
                                    if (completedCount < this.planSubtasks.length) {
                                        shouldReject = true;
                                        rejectReason = `Guardian unavailable. ${completedCount}/${this.planSubtasks.length} subtasks completed. Continue.`;
                                    }
                                }

                                if (shouldReject) {
                                    this.doneRejections++;
                                    logger.warn("agent", "DONE rejected", {
                                        turn: this.turnCount,
                                        rejections: this.doneRejections,
                                        reason: rejectReason.slice(0, 200),
                                    });

                                    if (this.doneRejections >= MAX_DONE_REJECTIONS) {
                                        logger.warn("agent", "DONE forced after max rejections", {
                                            turn: this.turnCount,
                                            rejections: this.doneRejections,
                                        });
                                        // Fall through to normal done handling
                                    } else {
                                        this.context.addMessage({
                                            role: "tool",
                                            tool_call_id: toolCall.id,
                                            content: `done() REJECTED: ${rejectReason}\n\nContinue working. Do NOT call done() until all steps are complete.`,
                                        });
                                        this.stepHandler({
                                            id: crypto.randomUUID(),
                                            type: "info",
                                            label: `Not done yet (${this.doneRejections}/${MAX_DONE_REJECTIONS})`,
                                            status: "done",
                                            timestamp: Date.now(),
                                        }, false);
                                        continue; // Resume executor loop
                                    }
                                }
                            }

                            // --- Normal done handling ---
                            logger.info("agent", "DONE called", {
                                turn: this.turnCount,
                                url: this.context.getCurrentUrl(),
                                summary: summary.slice(0, 300),
                            });
                            this.context.addMessage({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: summary
                            });
                            this.stepHandler({
                                id: crypto.randomUUID(),
                                type: "info",
                                label: "Task complete",
                                status: "done",
                                timestamp: Date.now(),
                            }, false);
                            this.statusHandler(AgentStatus.IDLE, "Done");
                            this.messageHandler(summary, []);
                            doneSummary = summary;
                            doneSignaled = true;

                            // Broadcast task completion if plan was active
                            if (this.taskId && this.planSubtasks.length > 0) {
                                const subtaskResults: SubtaskResult[] = this.planSubtasks.map((st) => ({
                                    description: st.description,
                                    status: st.status === "failed" ? "failed" as const
                                          : st.status === "skipped" ? "skipped" as const
                                          : "completed" as const,
                                    turnsUsed: st.turnsUsed,
                                    result: st.result || "",
                                }));

                                chrome.runtime.sendMessage({
                                    type: "TASK_COMPLETION",
                                    requestId: crypto.randomUUID(),
                                    source: MessageSource.BACKGROUND,
                                    payload: {
                                        taskId: this.taskId,
                                        status: subtaskResults.every(sr => sr.status === "completed") ? "completed" : "partial",
                                        totalTurnsUsed: this.turnCount,
                                        totalTimeMs: Date.now() - this.taskStartTime,
                                        summary,
                                        subtaskResults,
                                        urlHistory: this.urlHistory,
                                    },
                                }).catch(() => {});
                            }

                            // Broadcast final metrics
                            if (this.showSessionMetrics) {
                                this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
                                chrome.runtime.sendMessage({
                                    type: "SESSION_METRICS",
                                    requestId: crypto.randomUUID(),
                                    source: MessageSource.BACKGROUND,
                                    payload: { ...this.metrics },
                                }).catch(() => {});
                            }

                            break;
                        }

                        // ESCALATE tool — voluntary model upgrade
                        if (toolName === ToolName.ESCALATE) {
                            const reason = (args.reason as string) || "";
                            if (!escalated) {
                                this.escalateModel();
                                escalated = true;
                                prevElementCount = await this.refreshSnapshotWithRetry(tabId, prevElementCount);
                                this.stepHandler({
                                    id: crypto.randomUUID(),
                                    type: "info",
                                    label: reason ? `Escalating: "${reason.slice(0, 60)}"` : "Escalating to smarter model",
                                    status: "done",
                                    timestamp: Date.now(),
                                }, false);
                                this.context.addMessage({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: "Upgraded to smarter model. Re-read the page and continue.",
                                });
                            } else {
                                this.context.addMessage({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: `Already using the most capable model (${this.llm.getCurrentModel()}). Escalation won't help further. Try a fundamentally different approach:\n- Use take_screenshot to see the visual layout\n- Use read_page to list all interactive elements\n- Try a completely different interaction strategy`,
                                });
                            }
                            logger.info("agent", "ESCALATE called", {
                                turn: this.turnCount,
                                reason,
                                wasAlreadyEscalated: escalated && reason === "",
                            });
                            continue;
                        }

                        // UPDATE_PLAN tool — task decomposition and progress tracking
                        if (toolName === ToolName.UPDATE_PLAN) {
                            const subtaskDescs = (args.subtasks as string[]) || [];
                            const currentIndex = (args.currentIndex as number) || 0;
                            const lastResult = args.lastResult as string | undefined;

                            if (!this.taskId) {
                                this.taskId = crypto.randomUUID();
                                this.taskStartTime = Date.now();
                            }

                            this.planSubtasks = subtaskDescs.map((desc, i) => ({
                                description: desc,
                                status: i < currentIndex ? "completed" as const
                                      : i === currentIndex ? "running" as const
                                      : "pending" as const,
                                turnsUsed: 0,
                                turnBudget: 0,
                                result: i === currentIndex - 1 && lastResult ? lastResult : undefined,
                            }));

                            const currentUrl = this.context.getCurrentUrl();
                            if (currentUrl && !this.urlHistory.includes(currentUrl)) {
                                this.urlHistory.push(currentUrl);
                            }

                            chrome.runtime.sendMessage({
                                type: "TASK_PROGRESS",
                                requestId: crypto.randomUUID(),
                                source: MessageSource.BACKGROUND,
                                payload: {
                                    taskId: this.taskId,
                                    subtasks: this.planSubtasks,
                                    currentIndex,
                                    totalTurnsUsed: this.turnCount,
                                },
                            }).catch(() => {});

                            this.stepHandler({
                                id: crypto.randomUUID(),
                                type: "info",
                                label: lastResult
                                    ? `Step ${currentIndex + 1}/${subtaskDescs.length}: "${subtaskDescs[currentIndex]?.slice(0, 40) || "done"}"`
                                    : `Plan: ${subtaskDescs.length} steps`,
                                status: "done",
                                timestamp: Date.now(),
                            }, false);

                            this.context.addMessage({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: `Plan acknowledged. Now executing step ${currentIndex + 1}: "${subtaskDescs[currentIndex] || "done"}"`,
                            });

                            logger.info("agent", "UPDATE_PLAN", {
                                turn: this.turnCount,
                                taskId: this.taskId,
                                subtaskCount: subtaskDescs.length,
                                currentIndex,
                                lastResult: lastResult?.slice(0, 100),
                            });
                            continue;
                        }

                        const toolStepId = crypto.randomUUID();
                        const toolStep: AgentStep = {
                            id: toolStepId,
                            type: "tool",
                            label: formatStepLabel(toolName, args),
                            detail: JSON.stringify(args),
                            toolName,
                            status: "running",
                            timestamp: Date.now(),
                        };
                        this.stepHandler(toolStep, false);

                        let result: string;
                        try {
                            result = await toolRegistry.execute(toolCall, tabId, this.abortController!.signal);
                            const toolMs = Date.now() - toolStep.timestamp;
                            this.stepHandler({
                                ...toolStep,
                                status: "done",
                                durationMs: toolMs,
                            }, true);
                            logger.info("tools", `${toolName} OK`, {
                                turn: this.turnCount, tool: toolName, risk: riskLevel,
                                mode: "sequential",
                                args: JSON.stringify(args).slice(0, 500),
                                result: result.slice(0, 1000),
                                durationMs: toolMs, intention: llmIntention,
                            });
                        } catch (toolError: any) {
                            if (toolError.name === "AbortError") throw toolError;
                            const errorMsg = toolError.message || String(toolError);
                            const toolMs = Date.now() - toolStep.timestamp;
                            logger.error("tools", `${toolName} FAIL`, {
                                turn: this.turnCount, tool: toolName, risk: riskLevel,
                                mode: "sequential",
                                args: JSON.stringify(args).slice(0, 500),
                                error: errorMsg,
                                durationMs: toolMs, intention: llmIntention,
                            });
                            this.stepHandler({
                                ...toolStep,
                                status: "error",
                                durationMs: toolMs,
                                errorMessage: errorMsg,
                            }, true);
                            // Add error to conversation history so the LLM can recover
                            this.context.addMessage({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: `Error: ${errorMsg}`,
                            });
                            continue;
                        }

                        if (DOM_MODIFYING_TOOLS.has(toolName) && !result.includes("Click intercepted")) {
                            domModified = true;
                        }

                        // Add Tool Result to History
                        this.context.addMessage({
                            role: "tool",
                            content: result,
                            tool_call_id: toolCall.id,
                        });
                    }
                }

                // Batch snapshot refresh: ONE refresh after all tools complete
                if (domModified && !doneSignaled) {
                    try {
                        await new Promise((resolve) => setTimeout(resolve, 100)); // SPA wait
                        let snapResponse = await chrome.tabs.sendMessage(tabId, {
                            type: "DOM_SNAPSHOT_REQUEST",
                            requestId: crypto.randomUUID(),
                            source: MessageSource.BACKGROUND,
                            payload: { includeText: true, refresh: true, showTags: this.showElementTags },
                        });
                        let snap = snapResponse?.payload?.snapshot;

                        // Retry if elements dropped to 0 (SPA hasn't rendered yet)
                        if (snap && snap.elements.length === 0 && prevElementCount > 0) {
                            const retryDelays = [300, 500];
                            for (const delay of retryDelays) {
                                logger.info("agent", "Empty snapshot after action, retrying", {
                                    turn: this.turnCount, delay, prevElements: prevElementCount,
                                });
                                await new Promise((resolve) => setTimeout(resolve, delay));
                                snapResponse = await chrome.tabs.sendMessage(tabId, {
                                    type: "DOM_SNAPSHOT_REQUEST",
                                    requestId: crypto.randomUUID(),
                                    source: MessageSource.BACKGROUND,
                                    payload: { includeText: true, refresh: true, showTags: this.showElementTags },
                                });
                                snap = snapResponse?.payload?.snapshot;
                                if (snap && snap.elements.length > 0) break;
                            }
                        }

                        if (snap) {
                            logger.info("agent", "Snapshot refreshed", {
                                turn: this.turnCount,
                                title: snap.title?.slice(0, 60),
                                url: snap.url?.slice(0, 100),
                                elements: snap.elements.length,
                                durationMs: snapResponse.payload.durationMs,
                            });
                            prevElementCount = snap.elements.length;
                            this.context.setSnapshot(snap);

                            // Progress tracking: detect stuck loops
                            const progressSignal = this.progress.onSnapshotRefresh(snap);
                            if (progressSignal) {
                                logger.warn("agent", "Progress stuck detected", {
                                    turn: this.turnCount,
                                    type: progressSignal.type,
                                    staleTurns: progressSignal.staleTurns,
                                    url: snap.url,
                                });
                                this.context.addMessage({ role: "user", content: progressSignal.message });
                                // Broadcast stuck signal to side panel
                                chrome.runtime.sendMessage({
                                    type: "AGENT_STUCK",
                                    requestId: crypto.randomUUID(),
                                    source: MessageSource.BACKGROUND,
                                    payload: {
                                        signal: progressSignal.type as "nudge" | "escalate",
                                        staleTurns: progressSignal.staleTurns,
                                        url: snap.url,
                                        message: progressSignal.message,
                                    },
                                }).catch(() => {});
                                wasStuck = true;
                                if (progressSignal.type === "escalate" && !escalated) {
                                    this.escalateModel();
                                    escalated = true;
                                    this.stepHandler({
                                        id: crypto.randomUUID(),
                                        type: "info",
                                        label: "Stuck — switching to smarter model",
                                        status: "done",
                                        timestamp: Date.now(),
                                    }, false);
                                    // Mandatory snapshot refresh so the new model sees current state
                                    prevElementCount = await this.refreshSnapshotWithRetry(tabId, prevElementCount);
                                }
                            } else if (wasStuck) {
                                // Agent recovered — broadcast resolved signal
                                chrome.runtime.sendMessage({
                                    type: "AGENT_STUCK",
                                    requestId: crypto.randomUUID(),
                                    source: MessageSource.BACKGROUND,
                                    payload: {
                                        signal: "resolved",
                                        staleTurns: 0,
                                        url: snap.url,
                                        message: "Agent is making progress again.",
                                    },
                                }).catch(() => {});
                                wasStuck = false;
                            }
                        }
                    } catch {
                        // Non-critical: snapshot refresh failed, continue with stale data
                    }
                }

                if (doneSignaled) break;

            } else {
                // TEXT RESPONSE — no tool calls

                // Notify user if LLM produced no content
                if (!response.content) {
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "(The agent finished without producing a response.)", done: false },
                    }).catch(() => {});
                }

                // Plan confirmation: on turn 1 with confirmPlan, pause for user approval
                if (this.confirmPlan && this.turnCount === 1 && response.content) {
                    // Finalize stream so the plan text appears as a complete message
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "", done: true },
                    }).catch(() => {});

                    logger.info("agent", "Plan ready — pausing for user approval");
                    this.statusHandler(AgentStatus.PAUSED, "Plan ready — waiting for approval");

                    // Block until user approves (RESUME_AGENT) or injects a hint
                    if (!this.pauseGate) {
                        let resolve: () => void;
                        const promise = new Promise<void>(r => { resolve = r; });
                        this.pauseGate = { promise, resolve: resolve! };
                    }
                    await this.pauseGate.promise;
                    this.pauseGate = null;
                    if (!this.isRunning) break;

                    this.statusHandler(AgentStatus.THINKING, "Executing plan...");
                    continue; // Continue the loop — user approved
                }

                // Unified nudge→escalate→give-up for text-only responses
                consecutiveNudges++;
                totalNudges++;
                logger.warn("agent", "LLM emitted text instead of tools, nudging", {
                    turn: this.turnCount,
                    consecutiveNudges,
                    text: response.content?.slice(0, 80),
                });

                // Escalation gate: after 2 nudges, try upgrading model
                if (consecutiveNudges >= 2 && !escalated) {
                    this.escalateModel();
                    escalated = true;
                    consecutiveNudges = 0;

                    // User-visible feedback
                    this.stepHandler({
                        id: crypto.randomUUID(),
                        type: "info",
                        label: "Switching to smarter model",
                        status: "done",
                        timestamp: Date.now(),
                    }, false);
                    this.statusHandler(AgentStatus.THINKING, "Escalating model...");

                    prevElementCount = await this.refreshSnapshotWithRetry(tabId, prevElementCount);
                    this.context.addMessage({ role: "user", content: NUDGE_MESSAGE });
                    continue;
                }

                // Give-up gate: 3 consecutive nudges (applies whether pre- or post-escalation)
                if (consecutiveNudges >= 3) {
                    logger.warn("agent", "Loop ended: consecutive nudge limit", { turns: this.turnCount, consecutiveNudges, totalNudges, escalated });
                    const stuckMsg = response.content || "The agent appears stuck and cannot continue.";
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: stuckMsg, done: false },
                    }).catch(() => {});
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "", done: true },
                    }).catch(() => {});
                    this.statusHandler(AgentStatus.IDLE, "Stuck — send a follow-up to continue");
                    break;
                }

                // Ratio-based give-up: if >40% of turns are text-only after 10+ turns post-escalation
                if (escalated && this.turnCount >= 10 && totalNudges / this.turnCount > 0.4) {
                    logger.warn("agent", "Loop ended: excessive nudge ratio", {
                        turns: this.turnCount, totalNudges, ratio: (totalNudges / this.turnCount).toFixed(2),
                    });
                    const stuckMsg = "The agent is struggling to make progress. Send a follow-up with more specific instructions.";
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: stuckMsg, done: false },
                    }).catch(() => {});
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "", done: true },
                    }).catch(() => {});
                    this.statusHandler(AgentStatus.IDLE, "Stuck — send a follow-up to continue");
                    break;
                }

                // Regular nudge: refresh snapshot + inject message
                const count = await this.refreshSnapshot(tabId);
                if (count >= 0) prevElementCount = count;
                this.context.addMessage({ role: "user", content: NUDGE_MESSAGE });
                continue;
            }
        }

        if (this.turnCount >= this.maxTurns) {
            logger.warn("agent", "Loop ended: max turns reached", { turns: this.turnCount, maxTurns: this.maxTurns });
            const limitMsg = `Reached turn limit (${this.turnCount}/${this.maxTurns}). You can increase the limit in Settings or send a follow-up message to continue.`;
            chrome.runtime.sendMessage({
                type: "STREAM_CHUNK",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { delta: limitMsg, done: false },
            }).catch(() => {});
            chrome.runtime.sendMessage({
                type: "STREAM_CHUNK",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { delta: "", done: true },
            }).catch(() => {});
            this.statusHandler(AgentStatus.IDLE, `Turn limit (${this.turnCount}/${this.maxTurns})`);
            return { outcome: "max_turns" as const, turnCount: this.turnCount, summary: limitMsg, metrics: this.getMetrics() };
        }

        return { outcome: "completed" as const, turnCount: this.turnCount, summary: doneSummary, metrics: this.getMetrics() };
    }

    /**
     * Resume the agent loop from a saved state (after navigation).
     * Called by the navigation bridge when webNavigation.onCompleted fires.
     */
    public async resumeFromNavigation(savedState: AgentLoopState, newSnapshot?: DomSnapshot) {
        if (this.isRunning) {
            this.stop();
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        // Restore context from saved state
        this.context.restoreFromState(savedState.messages);

        if (newSnapshot) {
            this.context.setSnapshot(newSnapshot);
        }

        this.statusHandler(AgentStatus.THINKING, "Resuming after navigation...");

        // Restart keepalive alarm
        await startKeepalive();

        try {
            await this.loop(savedState.activeTabId);
        } catch (error: any) {
            if (error.name === "AbortError") {
                logger.info("agent", "Agent stopped by user");
                this.statusHandler(AgentStatus.IDLE, "Stopped");
            } else {
                logger.error("agent", "Loop Error", { error });
                const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: errorMsg, done: false },
                }).catch(() => {});
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: "", done: true },
                }).catch(() => {});
                this.statusHandler(AgentStatus.ERROR, error.message);
            }
        } finally {
            await stopKeepalive();
            this.isRunning = false;
        }
    }

    /**
     * Get current loop state for saving before navigation.
     */
    public getState(tabId: number): AgentLoopState {
        // Cast LLMMessage[] to ChatMessage[] - they are compatible at runtime
        const messages = this.context.getMessages() as unknown as import("../../types").ChatMessage[];
        return {
            status: AgentStatus.WAITING_FOR_PAGE_LOAD,
            messages,
            originalQuery: this.originalQuery,
            turnCount: this.turnCount,
            maxTurns: this.maxTurns,
            activeTabId: tabId,
            workspaceId: null,
            lastActivityTs: Date.now(),
            pendingToolCall: null,
        };
    }
}
