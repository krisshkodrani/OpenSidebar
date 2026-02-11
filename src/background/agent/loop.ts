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
import { toolRegistry, SPEED_MODE_EXCLUDED_TOOLS } from "../tools";
import { workspaceManager } from "../workspaces/manager";
import { classifyRisk } from "../security";
import { ContextManager } from "./context";
import { DomSnapshot } from "../../types";
import { startKeepalive, stopKeepalive } from "../keepalive";
import { formatStepLabel } from "./step-labels";

/** Tools that modify the DOM and require a snapshot refresh */
const DOM_MODIFYING_TOOLS: Set<ToolName> = new Set([
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.SELECT_OPTION,
    ToolName.HOVER_ELEMENT,
    ToolName.DRAG_AND_DROP,
]);

/** Tools that must execute sequentially (affect navigation or control flow) */
const SEQUENTIAL_TOOLS: Set<ToolName> = new Set([
    ToolName.NAVIGATE,
    ToolName.DONE,
]);

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

    constructor(
        apiKey: string,
        callbacks: {
            onStatusUpdate: (status: AgentStatus, detail: string) => void;
            onMessage: (text: string, toolCalls: ToolCall[]) => void;
            onStep?: (step: AgentStep, update: boolean) => void;
        },
        options?: { maxContextTokens?: number; maxTurns?: number; showElementTags?: boolean; speedMode?: boolean }
    ) {
        this.speedMode = options?.speedMode ?? false;
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
        initialSnapshot?: DomSnapshot
    ) {
        if (this.isRunning) {
            this.stop();
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        // Restore context from session storage to handle SW restarts
        await this.context.loadState();

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

        try {
            await this.loop(tabId);
        } catch (error: any) {
            if (error.name === "AbortError") {
                logger.info("agent", "Agent stopped by user");
                this.statusHandler(AgentStatus.IDLE, "Stopped");
            } else {
                logger.error("agent", "Loop Error", { error });
                this.statusHandler(AgentStatus.ERROR, error.message);
            }
        } finally {
            await stopKeepalive();
            this.isRunning = false;
        }
    }

    public stop() {
        this.abortController?.abort();
        this.isRunning = false;
    }

    private async loop(tabId: number) {
        let turns = 0;

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

        while (this.isRunning && turns < this.maxTurns) {
            turns++;

            // 1. LLM Inference (streamed)
            const messages = this.context.getPrompt();
            const tools = this.speedMode
                ? toolRegistry.getDefinitions(SPEED_MODE_EXCLUDED_TOOLS)
                : toolRegistry.getDefinitions();

            // Log context metrics for telemetry
            const metrics = this.context.getPromptMetrics();
            logger.info("agent", "Context metrics", {
                turn: turns,
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
                label: turns === 1 ? "Planning approach" : "Thinking...",
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
                    stop: ["Observation:"], // ReAct pattern stop token just in case
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
                turn: turns,
                llmMs,
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
                                logger.info("tools", `${toolName} OK`, { toolMs, result: result.slice(0, 120) });

                                if (DOM_MODIFYING_TOOLS.has(toolName)) {
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
                            logger.info("tools", `${toolName} OK`, { toolMs, result: result.slice(0, 120) });
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

                        if (DOM_MODIFYING_TOOLS.has(toolName)) {
                            domModified = true;
                        }

                        // Add Tool Result to History
                        this.context.addMessage({
                            role: "tool",
                            content: result,
                            tool_call_id: toolCall.id
                        });
                    }
                }

                // Batch snapshot refresh: ONE refresh after all tools complete
                if (domModified && !doneSignaled) {
                    try {
                        const spaWait = this.speedMode ? 50 : 200;
                        await new Promise((resolve) => setTimeout(resolve, spaWait));
                        const snapResponse = await chrome.tabs.sendMessage(tabId, {
                            type: "DOM_SNAPSHOT_REQUEST",
                            requestId: crypto.randomUUID(),
                            source: MessageSource.BACKGROUND,
                            payload: { includeText: !this.speedMode, refresh: true, showTags: this.showElementTags },
                        });
                        if (snapResponse?.payload?.snapshot) {
                            const snap = snapResponse.payload.snapshot;
                            logger.info("agent", "Snapshot refreshed", {
                                turn: turns,
                                title: snap.title?.slice(0, 60),
                                url: snap.url?.slice(0, 100),
                                elements: snap.elements.length,
                                durationMs: snapResponse.payload.durationMs,
                            });
                            this.context.setSnapshot(snap);
                        }
                    } catch {
                        // Non-critical: snapshot refresh failed, continue with stale data
                    }
                }

                if (doneSignaled) break;

            } else {
                // FINAL ANSWER (or question) — text already streamed via deltas
                chrome.runtime.sendMessage({
                    type: "STREAM_CHUNK",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: { delta: "", done: true },
                }).catch(() => { });
                logger.info("agent", "Loop ended: final answer", { turn: turns });
                this.statusHandler(AgentStatus.IDLE, "Done");
                break; // Exit loop
            }
        }

        if (turns >= this.maxTurns) {
            logger.warn("agent", "Loop ended: max turns reached", { turns, maxTurns: this.maxTurns });
        }
    }

    /**
     * Resume the agent loop from a saved state (after navigation).
     * Called by the navigation bridge when webNavigation.onCompleted fires.
     */
    public async resume(savedState: AgentLoopState, newSnapshot?: DomSnapshot) {
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
            originalQuery: "", // Could be enhanced to track this
            turnCount: 0,
            maxTurns: this.maxTurns,
            activeTabId: tabId,
            workspaceId: null,
            lastActivityTs: Date.now(),
            pendingToolCall: null,
        };
    }
}
