import { LLMClient } from "../llm";
import { TokenUsage } from "../llm/types";
import { SubtaskSummary } from "../../types";
import { logger } from "../../utils";
import type { Difficulty, RuntimeLimits } from "./constants";

/** Result of task decomposition */
export interface PlanDecomposition {
  subtasks: string[];
  steps?: PlanStep[];
  difficulty: Difficulty;
  limitOverrides?: Partial<RuntimeLimits> | null;
}

export interface PlanStep {
  objective: string;
  successCriteria: string;
  dependencies: number[];
  assumptions: string[];
}

/** Result of done() validation */
export interface DoneValidation {
  approved: boolean;
  reason?: string;
}

const DECOMPOSE_SYSTEM = `You are a task planner for a browser automation agent.

Given a user task and page context, decide if it needs multiple steps.

Criteria for Multi-Step:
- Complexity: Task requires distinct phases (e.g. "Search -> Scrape Results -> Aggregate").
- Length: more than 2-3 distinct interactions required.

Criteria for Simple (Single-Step):
- Navigation + 1-2 interactions (e.g. "Go to X and click Y").
- Direct questions (e.g. "What is on this page?").
- Single form fills.

Response Rules:
- Simple tasks: return {"isMultiStep": false}
- Multi-step tasks: return {"isMultiStep": true, "subtasks": ["step 1", ...]}
- Prefer structured plans when possible:
{
  "isMultiStep": true,
  "steps": [
    {
      "objective": "concrete step objective",
      "successCriteria": "observable completion condition",
      "dependencies": [0],
      "assumptions": ["short assumption about page state"]
    }
  ]
}
- 3-8 subtasks maximum.
- Group related actions into single steps.
- Last subtask should verify the overall goal was achieved.
- Dependencies must reference earlier step indexes only.
- SUBTASK INDEPENDENCE: Each subtask description must be self-contained.
  - A subtask should be completable using the DOM state and its own description.
  - Do NOT write subtasks that reference "the result from step N" or "the value found above."
  - Instead, inline the expected context: e.g., instead of "Click the link found in step 2",
    write "Click the 'Settings' link in the navigation menu."
  - If a subtask truly depends on a prior subtask's runtime output,
    note this explicitly as: [DEPENDS: step N output].

DIFFICULTY ASSESSMENT (required):
Always include a "difficulty" field in your response. Assess the task as one of:
- "simple": 1-2 interactions, single page, obvious target element
- "moderate": 3-5 steps, may navigate, clear success criteria
- "complex": 6-10 steps, multi-page, needs verification
- "extreme": 10+ steps, multi-site, or ambiguous success criteria
This controls how patient the execution engine is with retries and failures.

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
  private usageCallback:
    | ((usage: TokenUsage, llmMs: number, model: string) => void)
    | null = null;

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.llm = new LLMClient(openRouterApiKey, undefined, cerebrasApiKey);
    // Guardian always uses the smart model tier
    this.llm.switchToSmart();
  }

  setUsageCallback(
    cb: ((usage: TokenUsage, llmMs: number, model: string) => void) | null,
  ) {
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
          {
            role: "user",
            content: `Page: ${pageTitle} (${pageUrl})\nTask: ${query}`,
          },
        ],
        max_tokens: 512,
        temperature: 0,
        signal,
      });
      const llmMs = Date.now() - start;
      if (response.usage)
        this.usageCallback?.(
          response.usage,
          llmMs,
          response.actualModel ?? this.llm.getCurrentModel(),
        );

      const text = (response.content || "").trim();
      const cleaned = text
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Fallback: extract first {...} block from text
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match)
          throw new Error(`No JSON object found in: ${cleaned.slice(0, 100)}`);
        parsed = JSON.parse(match[0]);
      }

      // Extract difficulty assessment (defaults to "moderate" if missing)
      const VALID_DIFFICULTIES = new Set<Difficulty>([
        "simple",
        "moderate",
        "complex",
        "extreme",
      ]);
      const difficulty: Difficulty =
        typeof parsed.difficulty === "string" &&
        VALID_DIFFICULTIES.has(parsed.difficulty as Difficulty)
          ? (parsed.difficulty as Difficulty)
          : "moderate";

      // Extract optional limit overrides
      let limitOverrides: Partial<RuntimeLimits> | null = null;
      if (
        parsed.limit_overrides &&
        typeof parsed.limit_overrides === "object" &&
        !Array.isArray(parsed.limit_overrides)
      ) {
        const overrides: Partial<RuntimeLimits> = {};
        for (const [key, val] of Object.entries(
          parsed.limit_overrides as Record<string, unknown>,
        )) {
          if (typeof val === "number" && Number.isFinite(val)) {
            (overrides as Record<string, number>)[key] = val;
          }
        }
        if (Object.keys(overrides).length > 0) {
          limitOverrides = overrides;
        }
      }

      if (!parsed.isMultiStep) {
        // Simple task — still return difficulty assessment
        return { subtasks: [], difficulty, limitOverrides };
      }

      const parseSteps = (value: unknown): PlanStep[] | null => {
        if (!Array.isArray(value) || value.length < 2) return null;
        const result: PlanStep[] = [];
        for (let i = 0; i < value.length; i++) {
          const raw = value[i];
          if (!raw || typeof raw !== "object") return null;
          const obj = raw as Record<string, unknown>;
          if (
            typeof obj.objective !== "string" ||
            obj.objective.trim().length === 0
          ) {
            return null;
          }
          const successCriteria =
            typeof obj.successCriteria === "string" &&
            obj.successCriteria.trim().length > 0
              ? obj.successCriteria.trim()
              : `Step "${obj.objective.trim()}" is completed and verified.`;

          const dependencies: number[] = [];
          if (Array.isArray(obj.dependencies)) {
            for (const dep of obj.dependencies) {
              if (!Number.isInteger(dep)) continue;
              const idx = dep as number;
              if (idx >= 0 && idx < i && !dependencies.includes(idx)) {
                dependencies.push(idx);
              }
            }
          }
          const assumptions: string[] = [];
          if (Array.isArray(obj.assumptions)) {
            for (const assumption of obj.assumptions) {
              if (typeof assumption !== "string") continue;
              const trimmed = assumption.trim();
              if (trimmed.length > 0 && !assumptions.includes(trimmed)) {
                assumptions.push(trimmed);
              }
            }
          }
          result.push({
            objective: obj.objective.trim(),
            successCriteria,
            dependencies,
            assumptions,
          });
        }
        return result;
      };

      const steps = parseSteps(parsed.steps);
      const legacySubtasks = Array.isArray(parsed.subtasks)
        ? parsed.subtasks
            .filter((step: unknown): step is string => typeof step === "string")
            .map((step) => step.trim())
            .filter((step) => step.length > 0)
        : [];
      const subtasks =
        steps?.map((step) => step.objective) ||
        (legacySubtasks.length >= 2 ? legacySubtasks : []);
      if (subtasks.length < 2) {
        // Simple task — return difficulty but no plan
        return { subtasks: [], difficulty, limitOverrides };
      }

      // Hard cap: truncate to 8 subtasks max
      if (subtasks.length > 8) {
        logger.warn(
          "agent",
          "Guardian decomposition exceeded 8 subtasks, truncating",
          {
            original: subtasks.length,
          },
        );
        if (steps) {
          const cappedSteps = steps.slice(0, 8);
          for (const step of cappedSteps) {
            step.dependencies = step.dependencies.filter(
              (dep) => dep < cappedSteps.length,
            );
          }
          logger.info("agent", "Guardian produced structured plan", {
            subtaskCount: cappedSteps.length,
            difficulty,
          });
          return {
            subtasks: cappedSteps.map((step) => step.objective),
            steps: cappedSteps,
            difficulty,
            limitOverrides,
          };
        }
        return { subtasks: subtasks.slice(0, 8), difficulty, limitOverrides };
      }

      if (steps) {
        logger.info("agent", "Guardian produced structured plan", {
          subtaskCount: steps.length,
          difficulty,
        });
        return {
          subtasks: steps.map((step) => step.objective),
          steps,
          difficulty,
          limitOverrides,
        };
      }

      logger.info("agent", "Guardian decomposed task", {
        subtaskCount: subtasks.length,
        difficulty,
      });
      return { subtasks, difficulty, limitOverrides };
    } catch (err: any) {
      logger.warn(
        "agent",
        "Guardian decompose failed, treating as simple task",
        {
          error: err?.message,
        },
      );
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
      if (response.usage)
        this.usageCallback?.(
          response.usage,
          llmMs,
          response.actualModel ?? this.llm.getCurrentModel(),
        );

      const text = (response.content || "").trim();
      const cleaned = text
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Fallback: extract first {...} block from text
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match)
          throw new Error(`No JSON object found in: ${cleaned.slice(0, 100)}`);
        parsed = JSON.parse(match[0]);
      }

      logger.info("agent", "Guardian validateDone", {
        approved: parsed.approved,
        reason: parsed.reason?.slice(0, 200),
      });
      return {
        approved: !!parsed.approved,
        reason: parsed.reason,
      };
    } catch (err: any) {
      logger.warn(
        "agent",
        "Guardian validateDone failed, falling back to structural check",
        {
          error: err?.message,
        },
      );
      // Fallback: structural check — reject if plan data shows incomplete
      const completedCount = plan.filter(
        (s) => s.status === "completed",
      ).length;
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
