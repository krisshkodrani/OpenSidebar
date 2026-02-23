import { LLMClient } from "../llm";
import { TokenUsage } from "../llm/types";
import { SubtaskSummary } from "../../types";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";
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
  verifyAfter?: { trigger: string; action: "call_done" | "advance_step"; pattern?: string };
  toolProfile?: "full" | "read_only" | "form_fill" | "navigate";
}

/** Result of done() validation */
export interface DoneValidation {
  approved: boolean;
  reason?: string;
}

const DECOMPOSE_SYSTEM = renderPrompt("planner.decompose.system");
const VALIDATE_SYSTEM = renderPrompt("planner.validate_done.system");

export class TaskPlanner {
  private llm: LLMClient;
  private usageCallback:
    | ((usage: TokenUsage, llmMs: number, model: string) => void)
    | null = null;

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.llm = new LLMClient(openRouterApiKey, undefined, cerebrasApiKey);
    // Planner always uses the smart model tier
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
        max_tokens: 768,
        temperature: 0,
        signal,
        response_format: { type: "json_object" },
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
          // Parse optional verification gate
          let verifyAfter: PlanStep["verifyAfter"] | undefined;
          if (
            obj.verifyAfter &&
            typeof obj.verifyAfter === "object" &&
            !Array.isArray(obj.verifyAfter)
          ) {
            const va = obj.verifyAfter as Record<string, unknown>;
            if (typeof va.trigger === "string" && va.trigger.trim().length > 0) {
              verifyAfter = {
                trigger: va.trigger.trim(),
                action:
                  va.action === "call_done" ? "call_done" : "advance_step",
                ...(typeof va.pattern === "string" && va.pattern.trim().length > 0
                  ? { pattern: va.pattern.trim() }
                  : {}),
              };
            }
          }

          // Parse optional tool profile
          const VALID_PROFILES = new Set(["full", "read_only", "form_fill", "navigate"]);
          let toolProfile: PlanStep["toolProfile"];
          if (typeof obj.toolProfile === "string" && VALID_PROFILES.has(obj.toolProfile)) {
            toolProfile = obj.toolProfile as PlanStep["toolProfile"];
          }

          result.push({
            objective: obj.objective.trim(),
            successCriteria,
            dependencies,
            assumptions,
            ...(verifyAfter ? { verifyAfter } : {}),
            ...(toolProfile ? { toolProfile } : {}),
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
          "Planner decomposition exceeded 8 subtasks, truncating",
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
          logger.info("agent", "Planner produced structured plan", {
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
        logger.info("agent", "Planner produced structured plan", {
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

      logger.info("agent", "Planner decomposed task", {
        subtaskCount: subtasks.length,
        difficulty,
      });
      return { subtasks, difficulty, limitOverrides };
    } catch (err: any) {
      logger.warn(
        "agent",
        "Planner decompose failed, treating as simple task",
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
        response_format: { type: "json_object" },
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

      logger.info("agent", "Planner validateDone", {
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
        "Planner validateDone failed, falling back to structural check",
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
          reason: `Planner unavailable. Structural check: ${completedCount}/${plan.length} subtasks completed. Continue.`,
        };
      }
      return { approved: true };
    }
  }
}
