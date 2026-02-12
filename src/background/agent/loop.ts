import {
    AgentStatus,
    AgentLoopState,
    AgentStep,
    MessageSource,
    ToolCall,
    ToolName,
} from "../../types";
import { logger } from "../../utils";
import { LLMClient } from "../llm";
import { toolRegistry } from "../tools";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS, SPEED_MODE_EXCLUDED_TOOLS } from "../tools/metadata";
import { workspaceManager } from "../workspaces/manager";
import { classifyRisk } from "../security";
import { ContextManager } from "./context";
import { ProgressTracker } from "./progress";
import { DomSnapshot } from "../../types";
import { startKeepalive, stopKeepalive } from "../keepalive";
import { formatStepLabel } from "./step-labels";

/** Nudge injected when speed-mode LLM emits text instead of tool calls. */
const SPEED_NUDGE_MESSAGE = "You output text instead of tool calls — that is not allowed. ONLY use tool calls. Look at the page elements and text above — continue working through the task. If you are truly finished with the ENTIRE task, call done({\"summary\": \"...\"}). Otherwise, keep going with the next step.";

/** Result of a completed agent loop run */
export interface LoopResult {
    outcome: "completed" | "stopped" | "max_turns" | "error";
    turnCount: number;
    /** Summary from done() tool, or error message */
    summary: string;
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
    private speedMode: boolean;
    private openRouterApiKey?: string;

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

    constructor(
        apiKey: string,
        callbacks: {
            onStatusUpdate: (status: AgentStatus, detail: string) => void;
            onMessage: (text: string, toolCalls: ToolCall[]) => void;
            onStep?: (step: AgentStep, update: boolean) => void;
        },
        options?: { maxContextTokens?: number; maxTurns?: number; showElementTags?: boolean; speedMode?: boolean; openRouterApiKey?: string }
    ) {
        this.speedMode = options?.speedMode ?? false;
        this.openRouterApiKey = options?.openRouterApiKey;
        this.llm = new LLMClient(apiKey);
        this.context = new ContextManager(options?.maxContextTokens, this.speedMode);
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

        // 2. Add User Message
        this.context.addMessage({
            role: "user",
            content: initialUserText
        });

        this.statusHandler(AgentStatus.THINKING, "Analyzing...");

        // Start keepalive alarm to prevent SW termination
        await startKeepalive();

        let result: LoopResult = { outcome: "completed", turnCount: 0, summary: "" };
        try {
            result = await this.loop(tabId);
        } catch (error: any) {
            if (error.name === "AbortError") {
                logger.info("agent", "Agent stopped by user");
                this.statusHandler(AgentStatus.IDLE, "Stopped");
                result = { outcome: "stopped", turnCount: this.turnCount, summary: "Stopped by user" };
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
                result = { outcome: "error", turnCount: this.turnCount, summary: error.message };
            }
        } finally {
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

    /** Escalate to Gemini 3 Flash via OpenRouter when speed mode gets stuck. */
    private escalateModel(): boolean {
        if (!this.openRouterApiKey) {
            logger.warn("agent", "Speed mode escalation skipped: no OpenRouter API key");
            return false;
        }
        this.llm = new LLMClient(this.openRouterApiKey, "openrouter", "google/gemini-3-flash-preview");
        logger.info("agent", "Speed mode: escalating to Gemini 3 Flash");
        return true;
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

    private async loop(tabId: number): Promise<LoopResult> {
        let prevElementCount = -1; // Track element count for empty-page retry
        let consecutiveNudges = 0;
        let escalated = false;
        let doneSummary = "";
        let wasStuck = false; // Track stuck state for "resolved" signal

        // Pre-agent modal auto-dismiss (speed mode only, before first LLM turn)
        if (this.speedMode) {
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
            } catch { /* non-critical */ }
        }

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

            // Broadcast turn progress to side panel (throttled in speed mode)
            if (!this.speedMode || this.turnCount === 1 || this.turnCount % 5 === 0) {
                chrome.runtime.sendMessage({
                    type: "AGENT_TURN",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { turn: this.turnCount, maxTurns: this.maxTurns },
                }).catch(() => {});
            }

            // 1. LLM Inference (streamed)
            const messages = this.context.getPrompt();
            const tools = this.speedMode
                ? toolRegistry.getDefinitions(SPEED_MODE_EXCLUDED_TOOLS)
                : toolRegistry.getDefinitions();

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
                speedMode: this.speedMode,
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

            // In speed mode, use no-op stream callback to eliminate per-token messaging overhead
            const onTextDelta = this.speedMode
                ? () => {}
                : (delta: string) => {
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta, done: false },
                    }).catch(() => { }); // Ignore if sidepanel closed
                };

            const llmStart = Date.now();
            const response = await this.llm.completeStream(
                {
                    messages,
                    tools,
                    max_tokens: this.speedMode ? 2048 : 4096,
                    stop: ["Observation:"], // ReAct pattern stop token just in case
                    signal: this.abortController!.signal,
                },
                onTextDelta
            );
            const llmMs = Date.now() - llmStart;

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
                text: response.content?.slice(0, 120) || null,
                toolCalls: toolSummary,
                toolCount: toolSummary.length,
            });

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

                // Determine if we can parallelize: speed mode + no sequential tools present
                const hasSequentialTool = response.tool_calls.some(tc =>
                    SEQUENTIAL_TOOLS.has(tc.function.name as ToolName)
                );
                const canParallelize = this.speedMode && !hasSequentialTool && response.tool_calls.length > 1;

                if (canParallelize) {
                    // PARALLEL EXECUTION (speed mode)
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
                            logger.debug("tools", `${toolName} [${riskLevel}] (parallel)`, { args });

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
                                const result = await toolRegistry.execute(toolCall, tabId);
                                const toolMs = Date.now() - toolStep.timestamp;
                                this.stepHandler({
                                    ...toolStep,
                                    status: "done",
                                    durationMs: toolMs,
                                }, true);
                                logger.info("tools", `${toolName} OK`, { toolMs, result: result.slice(0, 300) });

                                if (DOM_MODIFYING_TOOLS.has(toolName) && !result.includes("Click intercepted")) {
                                    domModified = true;
                                }

                                return { toolCall, result, error: null };
                            } catch (toolError: any) {
                                const errorMsg = toolError.message || String(toolError);
                                logger.error("tools", `Tool ${toolName} failed`, { error: errorMsg });
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
                    // SEQUENTIAL EXECUTION (normal mode or has sequential tools)
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
                        logger.debug("tools", `${toolName} [${riskLevel}]`, { args });

                        // DONE tool — exit loop with summary
                        if (toolName === ToolName.DONE) {
                            const summary = (args.summary as string) || "Task completed.";
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
                            break;
                        }

                        // WORKSPACE CHECK (skip in speed mode)
                        if (!this.speedMode) {
                            const isAllowed = await workspaceManager.isTabInActiveWorkspace(tabId);
                            if (!isAllowed) {
                                const errorMsg = "Error: The current tab is not in your active workspace. Switch to a tab in the workspace or use 'create_tab' to open inside it.";
                                this.context.addMessage({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: errorMsg
                                });
                                continue;
                            }
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
                            result = await toolRegistry.execute(toolCall, tabId);
                            const toolMs = Date.now() - toolStep.timestamp;
                            this.stepHandler({
                                ...toolStep,
                                status: "done",
                                durationMs: toolMs,
                            }, true);
                            logger.info("tools", `${toolName} OK`, { toolMs, result: result.slice(0, 300) });
                        } catch (toolError: any) {
                            const errorMsg = toolError.message || String(toolError);
                            logger.error("tools", `Tool ${toolName} failed`, { error: errorMsg });
                            this.stepHandler({
                                ...toolStep,
                                status: "error",
                                durationMs: Date.now() - toolStep.timestamp,
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
                        const spaWait = this.speedMode ? 50 : 200;
                        await new Promise((resolve) => setTimeout(resolve, spaWait));
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
                                    if (this.escalateModel()) {
                                        escalated = true;
                                        this.stepHandler({
                                            id: crypto.randomUUID(),
                                            type: "info",
                                            label: "Stuck — switching to smarter model",
                                            status: "done",
                                            timestamp: Date.now(),
                                        }, false);
                                    }
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
                // FINAL ANSWER (or question) — text without tool calls

                // Notify user if LLM produced no content
                if (!response.content) {
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta: "(The agent finished without producing a response.)", done: false },
                    }).catch(() => {});
                }

                // Speed mode: never stop on text — refresh snapshot and inject continuation nudge
                if (this.speedMode) {
                    consecutiveNudges++;
                    logger.warn("agent", "Speed mode: LLM emitted text instead of tools, nudging", {
                        turn: this.turnCount,
                        consecutiveNudges,
                        text: response.content?.slice(0, 80),
                    });

                    // Escalation gate: after 2 nudges, try upgrading model
                    if (consecutiveNudges >= 2 && !escalated) {
                        if (this.escalateModel()) {
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

                            const count = await this.refreshSnapshot(tabId);
                            if (count >= 0) prevElementCount = count;
                            this.context.addMessage({ role: "user", content: SPEED_NUDGE_MESSAGE });
                            continue;
                        }
                    }

                    // Give-up gate: 3 nudges (applies whether pre- or post-escalation)
                    if (consecutiveNudges >= 3) {
                        logger.warn("agent", "Loop ended: consecutive nudge limit", { turns: this.turnCount, consecutiveNudges, escalated });
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

                    // Regular nudge: refresh snapshot + inject message
                    const count = await this.refreshSnapshot(tabId);
                    if (count >= 0) prevElementCount = count;
                    this.context.addMessage({ role: "user", content: SPEED_NUDGE_MESSAGE });
                    continue;
                }

                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: "", done: true },
                }).catch(() => { });
                logger.info("agent", "Loop ended: final answer", { turn: this.turnCount });
                this.statusHandler(AgentStatus.IDLE, "Done");
                break; // Exit loop
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
            return { outcome: "max_turns" as const, turnCount: this.turnCount, summary: limitMsg };
        }

        return { outcome: "completed" as const, turnCount: this.turnCount, summary: doneSummary };
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
