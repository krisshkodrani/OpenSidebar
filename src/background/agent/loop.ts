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
import { workspaceManager } from "../workspaces/manager";
import { classifyRisk } from "../security";
import { ContextManager } from "./context";
import { DomSnapshot } from "../../types";
import { startKeepalive, stopKeepalive } from "../keepalive";
import { formatStepLabel } from "./step-labels";

export class AgentLoop {
    private llm: LLMClient;
    private context: ContextManager;
    private isRunning = false;
    private abortController: AbortController | null = null;
    private statusHandler: (status: AgentStatus, detail: string) => void;
    private messageHandler: (text: string, toolCalls: ToolCall[]) => void;
    private stepHandler: (step: AgentStep, update: boolean) => void;
    private maxTurns: number;

    constructor(
        apiKey: string,
        callbacks: {
            onStatusUpdate: (status: AgentStatus, detail: string) => void;
            onMessage: (text: string, toolCalls: ToolCall[]) => void;
            onStep?: (step: AgentStep, update: boolean) => void;
        },
        options?: { maxContextTokens?: number; maxTurns?: number }
    ) {
        this.llm = new LLMClient(apiKey);
        this.context = new ContextManager(options?.maxContextTokens);
        this.statusHandler = callbacks.onStatusUpdate;
        this.messageHandler = callbacks.onMessage;
        this.stepHandler = callbacks.onStep ?? (() => {});
        this.maxTurns = options?.maxTurns ?? 30;
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

        while (this.isRunning && turns < this.maxTurns) {
            turns++;

            // 1. LLM Inference (streamed)
            const messages = this.context.getPrompt();
            const tools = toolRegistry.getDefinitions();

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

            const response = await this.llm.completeStream(
                {
                    messages,
                    tools,
                    stop: ["Observation:"], // ReAct pattern stop token just in case
                },
                (delta) => {
                    chrome.runtime.sendMessage({
                        type: "STREAM_CHUNK",
                        requestId: crypto.randomUUID(),
                        source: MessageSource.BACKGROUND,
                        payload: { delta, done: false },
                    }).catch(() => { }); // Ignore if sidepanel closed
                }
            );

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

                    // WORKSPACE CHECK
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
                        this.stepHandler({
                            ...toolStep,
                            status: "done",
                            durationMs: Date.now() - toolStep.timestamp,
                        }, true);
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

                    // Auto-refresh snapshot after DOM-modifying actions
                    const DOM_MODIFYING_TOOLS: ToolName[] = [
                        ToolName.CLICK_ELEMENT,
                        ToolName.TYPE_TEXT,
                        ToolName.SELECT_OPTION,
                        ToolName.HOVER_ELEMENT,
                    ];

                    let enrichedResult = result;
                    if (DOM_MODIFYING_TOOLS.includes(toolName)) {
                        try {
                            // Brief wait for SPA DOM updates
                            await new Promise((resolve) => setTimeout(resolve, 200));
                            const snapResponse = await chrome.tabs.sendMessage(tabId, {
                                type: "DOM_SNAPSHOT_REQUEST",
                                requestId: crypto.randomUUID(),
                                source: MessageSource.BACKGROUND,
                                payload: { includeText: false, refresh: true },
                            });
                            if (snapResponse?.payload?.snapshot) {
                                this.context.setSnapshot(snapResponse.payload.snapshot);
                                const count = snapResponse.payload.snapshot.elements?.length || 0;
                                enrichedResult += `\n[Updated: ${count} interactive elements]`;
                            }
                        } catch {
                            // Non-critical: snapshot refresh failed, continue with stale data
                        }
                    }

                    // Add Tool Result to History
                    this.context.addMessage({
                        role: "tool",
                        content: enrichedResult,
                        tool_call_id: toolCall.id
                    });
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
                this.statusHandler(AgentStatus.IDLE, "Done");
                break; // Exit loop
            }
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
