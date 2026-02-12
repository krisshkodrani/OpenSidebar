import { LLMClient, MODEL_SMART } from "../llm";
import { CompletionResponse, TokenUsage } from "../llm/types";
import { SubtaskSummary } from "../../types";
import { logger } from "../../utils";

/** Result of task decomposition */
export interface PlanDecomposition {
    subtasks: string[];
}

/** Result of done() validation */
export interface DoneValidation {
    approved: boolean;
    reason?: string;
}

const DECOMPOSE_SYSTEM = `You are a task planner for a browser automation agent.

Given a user task and page context, decide if it needs multiple steps.
- Simple tasks (one click, one field, one navigation): return {"isMultiStep": false}
- Multi-step tasks: return {"isMultiStep": true, "subtasks": ["step 1", ...]}

Rules:
- 3-15 subtasks. Each must be a concrete, verifiable browser action.
- Group related micro-actions (e.g. "fill name and email" not two separate steps).
- Last subtask should verify the overall goal was achieved.
- Be generic — derive steps from the task description and page context, not assumptions about the site.

Respond with JSON only.`;

const VALIDATE_SYSTEM = `You are a task completion judge for a browser automation agent.

The agent claims it finished. Review the plan and summary. Decide if the ENTIRE task is done.

Rules:
- ALL planned subtasks must be reasonably covered by the summary to approve.
- If only a subset is done, REJECT and state what remains.
- Partial completion is NOT completion. Be strict.
- Judge based on the original task goal, not just the plan steps.

Respond with JSON only:
- {"approved": true}
- {"approved": false, "reason": "You completed X but Y and Z remain. Continue with: ..."}`;

export class PlanGuardian {
    private llm: LLMClient;
    private usageCallback: ((usage: TokenUsage, llmMs: number) => void) | null = null;

    constructor(apiKey: string) {
        this.llm = new LLMClient(apiKey, MODEL_SMART);
    }

    setUsageCallback(cb: ((usage: TokenUsage, llmMs: number) => void) | null) {
        this.usageCallback = cb;
    }

    async decompose(
        query: string,
        pageTitle: string,
        pageUrl: string,
        signal?: AbortSignal,
    ): Promise<PlanDecomposition | null> {
        try {
            const start = Date.now();
            const response = await this.llm.complete({
                messages: [
                    { role: "system", content: DECOMPOSE_SYSTEM },
                    { role: "user", content: `Page: ${pageTitle} (${pageUrl})\nTask: ${query}` },
                ],
                max_tokens: 512,
                temperature: 0,
                signal,
            });
            const llmMs = Date.now() - start;
            if (response.usage) this.usageCallback?.(response.usage, llmMs);

            const text = (response.content || "").trim();
            const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);

            if (!parsed.isMultiStep) return null;
            if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length < 2) return null;

            logger.info("agent", "Guardian decomposed task", {
                subtaskCount: parsed.subtasks.length,
            });
            return { subtasks: parsed.subtasks };
        } catch (err: any) {
            logger.warn("agent", "Guardian decompose failed, treating as simple task", {
                error: err?.message,
            });
            return null;
        }
    }

    async validateDone(
        query: string,
        plan: SubtaskSummary[],
        doneSummary: string,
        pageTitle: string,
        pageUrl: string,
        signal?: AbortSignal,
    ): Promise<DoneValidation> {
        try {
            const planText = plan
                .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
                .join("\n");

            const start = Date.now();
            const response = await this.llm.complete({
                messages: [
                    { role: "system", content: VALIDATE_SYSTEM },
                    {
                        role: "user",
                        content: `Original task: ${query}\n\nPlan:\n${planText}\n\nAgent summary: ${doneSummary}\n\nCurrent page: ${pageTitle} (${pageUrl})`,
                    },
                ],
                max_tokens: 256,
                temperature: 0,
                signal,
            });
            const llmMs = Date.now() - start;
            if (response.usage) this.usageCallback?.(response.usage, llmMs);

            const text = (response.content || "").trim();
            const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);

            logger.info("agent", "Guardian validateDone", {
                approved: parsed.approved,
                reason: parsed.reason?.slice(0, 200),
            });
            return {
                approved: !!parsed.approved,
                reason: parsed.reason,
            };
        } catch (err: any) {
            logger.warn("agent", "Guardian validateDone failed, falling back to structural check", {
                error: err?.message,
            });
            // Fallback: structural check — reject if plan data shows incomplete
            const completedCount = plan.filter(s => s.status === "completed").length;
            if (completedCount < plan.length) {
                return {
                    approved: false,
                    reason: `Guardian unavailable. Structural check: ${completedCount}/${plan.length} subtasks completed. Continue.`,
                };
            }
            return { approved: true };
        }
    }
}
