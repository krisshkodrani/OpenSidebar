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
  expectedState?: {
    description: string;       // what perception should show after step completion
    urlPattern?: string;       // optional regex for expected URL
    expectedPhrases?: string[];// key content that should appear in perception
  };
}

/** Alignment classification from plan monitor */
export type PlanAlignment = "aligned" | "progressing" | "deviated" | "blocked";

/** Result of a plan monitoring check */
export interface PlanMonitorResult {
  alignment: PlanAlignment;
  reason: string;
  replanFromIndex?: number;
  blocker?: string;
}

/** Result of a selective replan */
export interface ReplanResult {
  newSteps: PlanStep[];
  reason: string;
}

/** Result of done() validation */
export interface DoneValidation {
  approved: boolean;
  reason?: string;
}

const DECOMPOSE_SYSTEM = renderPrompt("planner.decompose.system");
const VALIDATE_SYSTEM = renderPrompt("planner.validate_done.system");
const MONITOR_STEP_SYSTEM = renderPrompt("planner.monitor_step.system");

export class TaskPlanner {
  private llm: LLMClient;
  private openRouterApiKey: string;
  private cerebrasApiKey?: string;
  private fastLlm: LLMClient | null = null;
  private usageCallback:
    | ((usage: TokenUsage, llmMs: number, model: string) => void)
    | null = null;

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.openRouterApiKey = openRouterApiKey;
    this.cerebrasApiKey = cerebrasApiKey;
    this.llm = new LLMClient(openRouterApiKey, undefined, cerebrasApiKey);
    // Planner always uses the smart model tier
    this.llm.switchToSmart();
  }

  /** Lazy-initialized fast-tier LLM client for lightweight monitoring calls */
  private getFastLlm(): LLMClient {
    if (!this.fastLlm) {
      this.fastLlm = new LLMClient(this.openRouterApiKey, undefined, this.cerebrasApiKey);
      // Stay on fast tier — never switchToSmart
    }
    return this.fastLlm;
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
    perception?: string,
  ): Promise<PlanDecomposition | null> {
    try {
      const start = Date.now();
      let userContent = `Page: ${pageTitle} (${pageUrl})`;
      if (perception) {
        userContent += `\nPage state:\n${perception}`;
      }
      userContent += `\n\nTask: ${query}`;
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: DECOMPOSE_SYSTEM },
          {
            role: "user",
            content: userContent,
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

          // Parse optional expectedState
          let expectedState: PlanStep["expectedState"];
          if (
            obj.expectedState &&
            typeof obj.expectedState === "object" &&
            !Array.isArray(obj.expectedState)
          ) {
            const es = obj.expectedState as Record<string, unknown>;
            if (typeof es.description === "string" && es.description.trim().length > 0) {
              expectedState = {
                description: es.description.trim(),
                ...(typeof es.urlPattern === "string" && es.urlPattern.trim().length > 0
                  ? { urlPattern: es.urlPattern.trim() }
                  : {}),
                ...(Array.isArray(es.expectedPhrases)
                  ? {
                      expectedPhrases: (es.expectedPhrases as unknown[])
                        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                        .map((p) => p.trim()),
                    }
                  : {}),
              };
            }
          }

          result.push({
            objective: obj.objective.trim(),
            successCriteria,
            dependencies,
            assumptions,
            ...(verifyAfter ? { verifyAfter } : {}),
            ...(toolProfile ? { toolProfile } : {}),
            ...(expectedState ? { expectedState } : {}),
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
    perception?: string,
  ): Promise<DoneValidation> {
    try {
      const planText = plan
        .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
        .join("\n");

      let userContent = `Original task: ${query}\n\nPlan:\n${planText}\n\nAgent summary: ${doneSummary}\n\nCurrent page: ${pageTitle} (${pageUrl})`;
      if (perception) {
        userContent += `\n\nCurrent page perception:\n${perception}`;
      }

      const start = Date.now();
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: VALIDATE_SYSTEM },
          {
            role: "user",
            content: userContent,
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

  /**
   * Monitor step alignment: compare current perception against expected state.
   * Phase A: heuristic (no LLM). Phase B: fast LLM (only if heuristics inconclusive).
   * Returns null on graceful skip/failure.
   */
  async monitorStep(
    step: PlanStep,
    stepIndex: number,
    perception: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<PlanMonitorResult | null> {
    if (!step.expectedState) return null;

    try {
      // --- Phase A: Heuristic checks (no LLM call) ---

      // Check for BLOCKERS in perception
      const blockerMatch = perception.match(/BLOCKERS:[\s\S]*?(?=\n[A-Z]+:|$)/i);
      if (blockerMatch) {
        const blockerText = blockerMatch[0];
        if (/PREREQ\b/i.test(blockerText)) {
          const prereqMatch = blockerText.match(/PREREQ\s+"?([^"\n]+)"?/i);
          return {
            alignment: "blocked",
            reason: "Prerequisite blocker detected in perception",
            blocker: prereqMatch?.[1] || "Unknown prerequisite",
          };
        }
        if (/RELEVANT\b/i.test(blockerText) && !/None/i.test(blockerText)) {
          const relevantMatch = blockerText.match(/RELEVANT\s+\[\d+\]\s+"?([^"\n]+)"?/i);
          return {
            alignment: "blocked",
            reason: "Relevant blocker detected in perception",
            blocker: relevantMatch?.[1] || "Blocking overlay or dialog",
          };
        }
      }

      const expected = step.expectedState;

      // URL pattern check
      let urlMatches = true;
      if (expected.urlPattern) {
        try {
          urlMatches = new RegExp(expected.urlPattern, "i").test(pageUrl);
        } catch {
          urlMatches = true; // Invalid regex — skip check
        }
      }

      // Phrase matching
      const phrases = expected.expectedPhrases || [];
      const lowerPerception = perception.toLowerCase();
      let matchedPhrases = 0;
      for (const phrase of phrases) {
        if (lowerPerception.includes(phrase.toLowerCase())) {
          matchedPhrases++;
        }
      }

      // Heuristic decisions
      if (urlMatches && phrases.length > 0 && matchedPhrases === phrases.length) {
        return {
          alignment: "aligned",
          reason: `URL matches${expected.urlPattern ? " pattern" : ""} and all ${phrases.length} expected phrases found`,
        };
      }
      if (urlMatches && phrases.length > 0 && matchedPhrases > 0) {
        return {
          alignment: "progressing",
          reason: `URL matches, ${matchedPhrases}/${phrases.length} expected phrases found`,
        };
      }
      if (!urlMatches && expected.urlPattern) {
        // URL doesn't match — likely deviated, but confirm with LLM
      }

      // --- Phase B: Fast LLM (heuristics inconclusive) ---
      const fastLlm = this.getFastLlm();
      const start = Date.now();
      const response = await fastLlm.complete({
        messages: [
          {
            role: "system",
            content: MONITOR_STEP_SYSTEM,
          },
          {
            role: "user",
            content: `Step ${stepIndex + 1}: "${step.objective}"
Expected state: ${expected.description}${expected.urlPattern ? `\nExpected URL pattern: ${expected.urlPattern}` : ""}${phrases.length > 0 ? `\nExpected phrases: ${phrases.join(", ")}` : ""}
Current URL: ${pageUrl}
Current perception:\n${perception.slice(0, 800)}`,
          },
        ],
        max_tokens: 150,
        temperature: 0,
        signal,
        response_format: { type: "json_object" },
      });
      const llmMs = Date.now() - start;
      if (response.usage) {
        this.usageCallback?.(
          response.usage,
          llmMs,
          response.actualModel ?? fastLlm.getCurrentModel(),
        );
      }

      const text = (response.content || "").trim();
      const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        parsed = JSON.parse(match[0]);
      }

      const VALID_ALIGNMENTS = new Set(["aligned", "progressing", "deviated", "blocked"]);
      const alignment: PlanAlignment = VALID_ALIGNMENTS.has(parsed.alignment)
        ? (parsed.alignment as PlanAlignment)
        : "progressing";

      return {
        alignment,
        reason: parsed.reason || "LLM assessment",
        ...(alignment === "deviated" ? { replanFromIndex: stepIndex } : {}),
        ...(alignment === "blocked" ? { blocker: parsed.reason } : {}),
      };
    } catch (err: any) {
      logger.warn("agent", "Plan monitor failed (graceful skip)", {
        stepIndex,
        error: err?.message,
      });
      return null;
    }
  }

  /**
   * Selective replan: replace steps from deviation point onward.
   * Uses smart model for high-quality plan repair.
   */
  async replanFrom(
    originalQuery: string,
    completedSteps: { index: number; objective: string; result?: string }[],
    failedStep: { index: number; objective: string },
    perception: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<ReplanResult | null> {
    try {
      const REPLAN_SYSTEM = renderPrompt("planner.replan.system");

      const completedText = completedSteps.length > 0
        ? completedSteps.map((s) => `${s.index + 1}. [done] ${s.objective}${s.result ? ` → ${s.result.slice(0, 100)}` : ""}`).join("\n")
        : "None completed yet.";

      const start = Date.now();
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: REPLAN_SYSTEM },
          {
            role: "user",
            content: `Original task: ${originalQuery}\n\nCompleted steps:\n${completedText}\n\nDeviated at step ${failedStep.index + 1}: "${failedStep.objective}"\n\nCurrent URL: ${pageUrl}\nCurrent perception:\n${perception.slice(0, 1000)}`,
          },
        ],
        max_tokens: 768,
        temperature: 0,
        signal,
        response_format: { type: "json_object" },
      });
      const llmMs = Date.now() - start;
      if (response.usage) {
        this.usageCallback?.(
          response.usage,
          llmMs,
          response.actualModel ?? this.llm.getCurrentModel(),
        );
      }

      const text = (response.content || "").trim();
      const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error(`No JSON object found in: ${cleaned.slice(0, 100)}`);
        parsed = JSON.parse(match[0]);
      }

      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        return null;
      }

      // Cap at 8 steps
      const rawSteps = parsed.steps.slice(0, 8);
      const newSteps: PlanStep[] = [];
      for (const raw of rawSteps) {
        if (!raw || typeof raw !== "object") continue;
        const obj = raw as Record<string, unknown>;
        if (typeof obj.objective !== "string" || obj.objective.trim().length === 0) continue;

        let expectedState: PlanStep["expectedState"];
        if (obj.expectedState && typeof obj.expectedState === "object" && !Array.isArray(obj.expectedState)) {
          const es = obj.expectedState as Record<string, unknown>;
          if (typeof es.description === "string" && es.description.trim().length > 0) {
            expectedState = {
              description: es.description.trim(),
              ...(typeof es.urlPattern === "string" && es.urlPattern.trim().length > 0
                ? { urlPattern: es.urlPattern.trim() }
                : {}),
              ...(Array.isArray(es.expectedPhrases)
                ? { expectedPhrases: (es.expectedPhrases as unknown[]).filter((p): p is string => typeof p === "string").map((p) => p.trim()) }
                : {}),
            };
          }
        }

        newSteps.push({
          objective: (obj.objective as string).trim(),
          successCriteria: typeof obj.successCriteria === "string" ? obj.successCriteria.trim() : `Step completed.`,
          dependencies: [],
          assumptions: Array.isArray(obj.assumptions)
            ? (obj.assumptions as unknown[]).filter((a): a is string => typeof a === "string").map((a) => a.trim())
            : [],
          ...(expectedState ? { expectedState } : {}),
        });
      }

      if (newSteps.length === 0) return null;

      logger.info("agent", "Planner replanFrom produced new steps", {
        fromIndex: failedStep.index,
        newStepCount: newSteps.length,
        reason: parsed.reason?.slice(0, 200),
      });

      return {
        newSteps,
        reason: parsed.reason || "Plan repaired after deviation",
      };
    } catch (err: any) {
      logger.warn("agent", "Planner replanFrom failed", {
        error: err?.message,
      });
      return null;
    }
  }
}
