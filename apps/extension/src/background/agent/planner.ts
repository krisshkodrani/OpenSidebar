import { LLMClient, LLMClientOptions } from "../llm";
import { TokenUsage } from "../llm/types";
import { SubtaskSummary } from "../../types";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";
import type { Difficulty, RuntimeLimits } from "./constants";
import type { ToolProfile } from "../tools/metadata";
import { tokenizeStepText } from "./loop-helpers";
import {
  buildTaskContract,
  repairPlanCoverage,
  synthesizeBatchedExhaustivePlan,
  synthesizePlanFromTaskContract,
} from "./task-contract";

/** Generic criteria patterns that have no DOM-observable tokens */
const GENERIC_CRITERIA = [
  /^the user goal is/i,
  /^the subtask outcome for/i,
  /^step .* is completed/i,
  /^step completed/i,
  /^completed and verified/i,
  /^task (is )?(completed|done|finished)/i,
];

/**
 * Ensure successCriteria contains DOM-observable tokens.
 * If the planner provides generic criteria, derive better ones from the objective.
 */
function ensureObservableCriteria(criteria: string, objective: string): string {
  const isGeneric = GENERIC_CRITERIA.some((p) => p.test(criteria));
  if (!isGeneric) return criteria;

  // Derive from objective: extract meaningful tokens and rebuild
  const tokens = tokenizeStepText(objective);
  if (tokens.length === 0) return criteria; // can't improve, keep original
  return `Page shows: ${tokens.slice(0, 6).join(", ")}`;
}

/** Result of task decomposition */
export interface PlanDecomposition {
  subtasks: string[];
  steps?: PlanStep[];
  difficulty: Difficulty;
  limitOverrides?: Partial<RuntimeLimits> | null;
  requiresTabManagement?: boolean;
  instrumentation?: {
    outcome:
      | "structured_steps"
      | "legacy_subtasks"
      | "simple_task"
      | "insufficient_subtasks";
    parsedStepCount?: number;
    parsedSubtaskCount?: number;
    requestedMultiStep?: boolean;
  };
}

export interface PlanStep {
  objective: string;
  successCriteria: string;
  dependencies: number[];
  assumptions: string[];
  verifyAfter?: {
    trigger: string;
    action: "call_done" | "advance_step" | "retry_step";
    maxRetries?: number;
    pattern?: string;
  };
  toolProfile?: ToolProfile;
  expectedState?: {
    description: string; // what perception should show after step completion
    urlPattern?: string; // optional regex for expected URL
    expectedPhrases?: string[]; // key content that should appear in perception
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePlanText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function looksLikeNavigationOnlyStep(step: PlanStep): boolean {
  const text = normalizePlanText(`${step.objective} ${step.successCriteria}`);
  const hasNavigationVerb =
    /\b(navigate|go to|open|visit|return to|go back|back to|move to)\b/.test(
      text,
    );
  const hasReadVerb =
    /\b(read|check|inspect|review|report|extract|inventory count|count)\b/.test(
      text,
    );
  return hasNavigationVerb && !hasReadVerb;
}

function looksLikeReadStep(step: PlanStep): boolean {
  const text = normalizePlanText(`${step.objective} ${step.successCriteria}`);
  return /\b(read|check|inspect|review|report|extract|inventory count|count)\b/.test(
    text,
  );
}

function extractSharedTargets(a: PlanStep, b: PlanStep): string[] {
  const contractLikeTargets = buildTaskContract(
    `${a.objective}\n${a.successCriteria}\n${b.objective}\n${b.successCriteria}`,
  ).requiredEntities;
  return dedupeStrings(contractLikeTargets);
}

function mergeAdjacentRoundTripReadSteps(steps: PlanStep[]): PlanStep[] {
  if (steps.length < 2) return steps;

  const merged: PlanStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const next = steps[i + 1];

    if (
      next &&
      looksLikeNavigationOnlyStep(current) &&
      looksLikeReadStep(next)
    ) {
      const sharedTargets = extractSharedTargets(current, next);
      const currentText = normalizePlanText(current.objective);
      const nextText = normalizePlanText(next.objective);
      const hasSharedTarget =
        sharedTargets.length === 0 ||
        sharedTargets.some(
          (target) =>
            currentText.includes(target.toLowerCase()) &&
            nextText.includes(target.toLowerCase()),
        );

      if (hasSharedTarget) {
        merged.push({
          objective: `${current.objective.replace(/[.:\s]+$/, "")} and ${next.objective.replace(/^[a-z]/, (ch) => ch.toLowerCase())}`,
          successCriteria: dedupeStrings([
            next.successCriteria,
            current.successCriteria,
          ]).join(" "),
          dependencies: [...current.dependencies],
          assumptions: dedupeStrings([
            ...current.assumptions,
            ...next.assumptions,
          ]),
          verifyAfter: next.verifyAfter ?? current.verifyAfter,
          toolProfile:
            next.toolProfile === "read_only"
              ? "navigate"
              : next.toolProfile || current.toolProfile,
          expectedState: next.expectedState ?? current.expectedState,
        });
        i++;
        continue;
      }
    }

    merged.push(current);
  }

  return merged.map((step, idx) => ({
    ...step,
    dependencies: step.dependencies.filter((dep) => dep < idx),
  }));
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
const VALID_TOOL_PROFILES = new Set<ToolProfile>([
  "full",
  "read_only",
  "form_fill",
  "edit_surface",
  "navigate",
  "enter_code",
  "submit_form",
  "inspect_hidden_state",
  "recover_from_stuck",
  "navigation_only",
]);

function extractPrimaryObjective(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const stopMarkers = [
    "planner assumptions:",
    "handoff context:",
    "global task context:",
    "reality check signal:",
    "execution policy:",
    "constraints:",
    "notes:",
  ];
  const lower = trimmed.toLowerCase();
  let cutIndex = trimmed.length;
  for (const marker of stopMarkers) {
    const idx = lower.indexOf(marker);
    if (idx >= 0 && idx < cutIndex) cutIndex = idx;
  }

  const primary = trimmed.slice(0, cutIndex).trim();
  return primary || trimmed;
}

function hasSequentialActionSequence(query: string): boolean {
  const text = query.toLowerCase();
  if (!/\b(then|after that|afterwards|followed by)\b/.test(text)) return false;

  const actionMatches =
    text.match(
      /\b(activate|click|open|go to|navigate|turn on|turn off|enable|disable|select|choose|set|rename|move|drag|apply|fill|type|enter|read|report|summarize|search|find|book)\b/g,
    ) || [];

  return actionMatches.length >= 2;
}

export function inferToolProfileForStep(
  objective: string,
  successCriteria: string,
): ToolProfile | undefined {
  const primaryObjective = extractPrimaryObjective(objective);
  const primaryText = primaryObjective.toLowerCase();
  const fullText = `${objective}\n${successCriteria}`.toLowerCase();
  const isReadFocusedObjective =
    /(read|observe|inspect page|summarize|summary|identify|check|verify|review|report|extract|compare)/.test(
      primaryText,
    );
  const requiresFieldEntryBeforeSubmit =
    /(fill|type|enter|input)[^.\n]{0,80}(name|email|address|checkout|field|form)/.test(
      primaryText,
    ) &&
    /(place (the )?order|submit order|complete checkout|finish checkout|review and place|confirm purchase|confirm order|click submit|submit code)/.test(
      primaryText,
    );

  if (requiresFieldEntryBeforeSubmit) {
    return "submit_form";
  }

  if (
    /(place (the )?order|submit order|complete checkout|finish checkout|review and place|confirm purchase|confirm order|click submit|submit code)/.test(
      primaryText,
    )
  ) {
    return "submit_form";
  }

  if (
    /(add to cart|add item|apply coupon|apply promo|apply [a-z0-9-]{4,}|promo code|coupon code|select shipping|choose[^.\n]{0,30}shipping|shipping method|checkout|full name|email address|billing|payment|quantity|cart section|cart overlay|fill.*checkout|enter.*email|enter.*name|select.*option|choose.*option)/.test(
      primaryText,
    )
  ) {
    return "form_fill";
  }

  const isInlineEditSurfaceTask =
    /(\brename\b)|(\b(change|update|edit|set|replace)\b[^.\n]{0,90}\b(cell|grid|spreadsheet|table|row|column|value|field|document|filename|file name|name)\b)|(\b(context menu|context-menu|inline edit|inline rename)\b)/.test(
      primaryText,
    ) ||
    /(\brename\b)|(\b(change|update|edit|set|replace)\b[^.\n]{0,120}\b(cell|grid|spreadsheet|table|row|column|value|field|document|filename|file name|name)\b)|(\b(context menu|context-menu|inline edit|inline rename)\b)/.test(
      fullText,
    );

  if (isInlineEditSurfaceTask) {
    return "edit_surface";
  }

  if (
    /((enter|type|fill|input)[^.\n]{0,80}(secret code|verification code|otp|passcode|code))|(6-character code)|(\btype\b[^.\n]{0,40}\bsubmit\b)|(\benter\b[^.\n]{0,40}\bsubmit\b)/.test(
      primaryText,
    )
  ) {
    return "enter_code";
  }

  if (
    /(reply|respond|post|send|compose|write back|finish the form|submit|confirm|proceed to step|click submit|submit code)/.test(
      primaryText,
    ) ||
    /\bdraft\b[^.\n]{0,80}\b(reply|email|e-mail|message|comment|response)\b/.test(
      primaryText,
    ) ||
    /\b(reply|email|e-mail|message|comment|response)\b[^.\n]{0,80}\bdraft\b/.test(
      primaryText,
    ) ||
    /\bwrite\b[^.\n]{0,60}\b(message|comment|reply|response)\b/.test(
      primaryText,
    )
  ) {
    return "submit_form";
  }

  if (
    /\b(update|set|change|assign|reassign|escalate|save|submit|mark|close|reopen)\b[^.\n]{0,100}\b(ticket|case|record|status|priority|assignee|owner|category|tag|field|escalation)\b/.test(
      primaryText,
    ) ||
    /\b(add|write|post)\b[^.\n]{0,80}\b(internal note|note|comment)\b/.test(
      primaryText,
    )
  ) {
    return "form_fill";
  }

  if (
    /(hidden|aria|attribute|meta tag|inspect dom|inspect the dom|xray|find the code|discover the code)/.test(
      primaryText,
    )
  ) {
    return "inspect_hidden_state";
  }

  // Tab management takes precedence over read-only: steps that involve
  // switching/creating/closing tabs need both navigation AND read tools.
  const isTabRelated =
    /(create_tab|switch_tab|close_tab|list_tabs|new tab|open.*tab|switch.*tab|close.*tab|tab.*open|tab.*switch|tab.*close|separate tab|another tab|each tab|multiple tab|across tab)/.test(
      primaryText,
    ) ||
    /(create_tab|switch_tab|close_tab|new tab|open.*tab|separate tab|another tab|each tab|multiple tab|across tab)/.test(
      fullText,
    );

  if (isTabRelated) {
    return "navigate";
  }

  // execute_js / data attribute / JS extraction → need inspect_hidden_state profile
  const isJsRelated =
    /(execute_js|javascript|data.attribute|dataset|computed.*value|window\.|document\.get|querySelector|programmatic|console)/.test(
      primaryText,
    ) || /(execute_js|data.attribute|dataset)/.test(fullText);

  if (isJsRelated) {
    return "inspect_hidden_state";
  }

  // go_back / browser history navigation → need navigate profile
  const isBackNavigation =
    /(go_back|go back|browser back|history back|back button|return.*previous|previous page)/.test(
      primaryText,
    ) || /(go_back|go back|browser back)/.test(fullText);

  if (isBackNavigation) {
    return "navigate";
  }

  if (isReadFocusedObjective) {
    return "read_only";
  }

  if (
    /(navigate|open|go to|switch tab|new tab|back to|return to|visit|load url)/.test(
      primaryText,
    )
  ) {
    return "navigation_only";
  }

  if (
    /(stuck|blocked|intercept|overlay|covered by|not responding|retry|recover)/.test(
      primaryText,
    )
  ) {
    return "recover_from_stuck";
  }

  if (
    /(stuck|blocked|intercept|overlay|covered by|not responding|retry|recover)/.test(
      fullText,
    )
  ) {
    return "recover_from_stuck";
  }

  return undefined;
}

export class TaskPlanner {
  private llm: LLMClient;
  private openRouterApiKey: string;
  private modelOverrides?: LLMClientOptions;
  private executorLlm: LLMClient | null = null;
  private usageCallback:
    | ((usage: TokenUsage, llmMs: number, model: string) => void)
    | null = null;

  constructor(openRouterApiKey: string, modelOverrides?: LLMClientOptions) {
    this.openRouterApiKey = openRouterApiKey;
    this.modelOverrides = modelOverrides;
    this.llm = new LLMClient(openRouterApiKey, modelOverrides);
    // Planner always uses the planner model tier
    this.llm.switchToPlanner();
  }

  /** Lazy-initialized executor-tier LLM client for lightweight monitoring calls */
  private getExecutorLlm(): LLMClient {
    if (!this.executorLlm) {
      this.executorLlm = new LLMClient(
        this.openRouterApiKey,
        this.modelOverrides,
      );
      // Stay on executor tier — never switchToPlanner
    }
    return this.executorLlm;
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
        max_tokens: 4096,
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

      const taskContract = buildTaskContract(query);
      const batchedExhaustiveFallback =
        synthesizeBatchedExhaustivePlan(query);
      const requiresStructuredPlan =
        taskContract.requiresRoundTrip ||
        taskContract.reportTargets.length > 1 ||
        taskContract.requiredEntities.length > 1 ||
        hasSequentialActionSequence(query);
      const maxStructuredSteps =
        taskContract.exhaustiveScopeCount &&
        taskContract.requiresAggregateReport
          ? Math.max(
              8,
              Math.min(12, taskContract.exhaustiveScopeCount + 1),
            )
          : 8;

      // Guard: if difficulty is "simple" but model said isMultiStep, override only
      // for truly single-step work. Round trips and multi-report tasks still need structure.
      const forceSimple =
        parsed.isMultiStep && difficulty === "simple" && !requiresStructuredPlan;
      const synthesizedFallback = synthesizePlanFromTaskContract(query);
      if (forceSimple) {
        logger.info(
          "agent",
          "Planner returned isMultiStep=true but difficulty=simple — overriding to single-step",
          {
            originalStepCount: Array.isArray(parsed.steps)
              ? parsed.steps.length
              : 0,
            requiresStructuredPlan,
          },
        );
      }

      if (!parsed.isMultiStep || forceSimple) {
        // Use synthesized fallback only when the planner produced NO usable
        // steps, or when the task requires a round-trip and the planner missed
        // the return leg. For normal multi-step tasks, the planner's steps
        // preserve the user's specific instructions (names, values, codes)
        // while the synthesis creates garbled entity-concatenation objectives.
        const plannerHasSteps =
          Array.isArray(parsed.steps) &&
          parsed.steps.some(
            (s: any) => typeof s?.objective === "string" && s.objective.trim(),
          );
        if (synthesizedFallback && !forceSimple && !plannerHasSteps) {
          logger.info(
            "agent",
            "Planner under-decomposed task; using task-contract synthesis",
            {
              synthesizedStepCount: synthesizedFallback.length,
              difficulty,
            },
          );
          return {
            subtasks: synthesizedFallback.map((step) => step.objective),
            steps: synthesizedFallback,
            difficulty,
            limitOverrides,
            instrumentation: {
              outcome: "structured_steps",
              parsedStepCount: synthesizedFallback.length,
              parsedSubtaskCount: synthesizedFallback.length,
              requestedMultiStep: true,
            },
          };
        }

        // Round-trip tasks: when planner returned steps but under-decomposed,
        // repair coverage by adding the missing return leg instead of replacing
        // with synthesis (which loses specific instructions).
        if (plannerHasSteps && taskContract.requiresRoundTrip) {
          const rawSteps = (parsed.steps as any[]).filter(
            (s: any) => typeof s?.objective === "string" && s.objective.trim(),
          );
          const simpleSteps: PlanStep[] = rawSteps.map((s: any) => ({
            objective: String(s.objective).trim(),
            successCriteria:
              typeof s.successCriteria === "string" && s.successCriteria.trim()
                ? s.successCriteria.trim()
                : `Page shows: ${String(s.objective).trim().slice(0, 60)}`,
            dependencies: [] as number[],
            assumptions: [] as string[],
          }));
          const repairedSteps = mergeAdjacentRoundTripReadSteps(
            repairPlanCoverage({ query, steps: simpleSteps }),
          );
          if (repairedSteps.length >= 2) {
            logger.info(
              "agent",
              "Planner under-decomposed round-trip; repaired with return leg",
              {
                originalStepCount: simpleSteps.length,
                repairedStepCount: repairedSteps.length,
              },
            );
            return {
              subtasks: repairedSteps.map((step) => step.objective),
              steps: repairedSteps,
              difficulty,
              limitOverrides,
              instrumentation: {
                outcome: "structured_steps",
                parsedStepCount: repairedSteps.length,
                parsedSubtaskCount: repairedSteps.length,
                requestedMultiStep: true,
              },
            };
          }
        }

        // Simple task — extract single step if provided, otherwise empty
        const singleSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
        const singleSubtasks = singleSteps
          .filter((s: any) => typeof s?.objective === "string")
          .map((s: any) => s.objective.trim())
          .filter((s: string) => s.length > 0);
        return {
          subtasks: singleSubtasks.slice(0, 1),
          difficulty,
          limitOverrides,
          instrumentation: {
            outcome: "simple_task",
            parsedStepCount: singleSteps.length,
            parsedSubtaskCount: singleSubtasks.length,
            requestedMultiStep: forceSimple,
          },
        };
      }

      const parseSteps = (value: unknown): PlanStep[] | null => {
        if (!Array.isArray(value) || value.length < 1) return null;
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
          const rawCriteria =
            typeof obj.successCriteria === "string" &&
            obj.successCriteria.trim().length > 0
              ? obj.successCriteria.trim()
              : `Step "${obj.objective.trim()}" is completed and verified.`;
          const successCriteria = ensureObservableCriteria(
            rawCriteria,
            obj.objective.trim(),
          );

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
            if (
              typeof va.trigger === "string" &&
              va.trigger.trim().length > 0
            ) {
              verifyAfter = {
                trigger: va.trigger.trim(),
                action:
                  va.action === "call_done" ? "call_done" : "advance_step",
                ...(typeof va.pattern === "string" &&
                va.pattern.trim().length > 0
                  ? { pattern: va.pattern.trim() }
                  : {}),
              };
            }
          }

          // Parse optional tool profile
          let toolProfile: PlanStep["toolProfile"];
          if (
            typeof obj.toolProfile === "string" &&
            VALID_TOOL_PROFILES.has(obj.toolProfile as ToolProfile)
          ) {
            toolProfile = obj.toolProfile as PlanStep["toolProfile"];
          } else {
            toolProfile = inferToolProfileForStep(
              obj.objective.trim(),
              successCriteria,
            );
          }

          // Parse optional expectedState
          let expectedState: PlanStep["expectedState"];
          if (
            obj.expectedState &&
            typeof obj.expectedState === "object" &&
            !Array.isArray(obj.expectedState)
          ) {
            const es = obj.expectedState as Record<string, unknown>;
            if (
              typeof es.description === "string" &&
              es.description.trim().length > 0
            ) {
              expectedState = {
                description: es.description.trim(),
                ...(typeof es.urlPattern === "string" &&
                es.urlPattern.trim().length > 0
                  ? { urlPattern: es.urlPattern.trim() }
                  : {}),
                ...(Array.isArray(es.expectedPhrases)
                  ? {
                      expectedPhrases: (es.expectedPhrases as unknown[])
                        .filter(
                          (p): p is string =>
                            typeof p === "string" && p.trim().length > 0,
                        )
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

      const parsedSteps = parseSteps(parsed.steps);
      const steps = parsedSteps
        ? mergeAdjacentRoundTripReadSteps(
            repairPlanCoverage({ query, steps: parsedSteps }),
          )
        : null;
      if (
        batchedExhaustiveFallback &&
        (!steps || steps.length > batchedExhaustiveFallback.length)
      ) {
        logger.info(
          "agent",
          "Planner exhaustive review plan replaced with compact batched plan",
          {
            originalStepCount: steps?.length ?? 0,
            batchedStepCount: batchedExhaustiveFallback.length,
          },
        );
        return {
          subtasks: batchedExhaustiveFallback.map((step) => step.objective),
          steps: batchedExhaustiveFallback,
          difficulty,
          limitOverrides,
          instrumentation: {
            outcome: "structured_steps",
            parsedStepCount: batchedExhaustiveFallback.length,
            parsedSubtaskCount: batchedExhaustiveFallback.length,
            requestedMultiStep: true,
          },
        };
      }
      const legacySubtasks = Array.isArray(parsed.subtasks)
        ? parsed.subtasks
            .filter((step: unknown): step is string => typeof step === "string")
            .map((step: string) => step.trim())
            .filter((step: string) => step.length > 0)
        : [];
      const subtasks =
        steps?.map((step) => step.objective) ||
        (legacySubtasks.length >= 2 ? legacySubtasks : []);
      if (subtasks.length < 2) {
        // Only fall back to synthesis when the planner returned NO parsed
        // steps at all, or when the task requires a round-trip and the planner
        // missed the return leg. For normal tasks, the planner's steps preserve
        // the user's specific instructions (names, values, codes) while the
        // synthesis creates garbled entity-concatenation objectives.
        if (synthesizedFallback && !parsedSteps) {
          logger.info(
            "agent",
            "Planner returned insufficient subtasks; using task-contract synthesis",
            {
              synthesizedStepCount: synthesizedFallback.length,
              difficulty,
            },
          );
          return {
            subtasks: synthesizedFallback.map((step) => step.objective),
            steps: synthesizedFallback,
            difficulty,
            limitOverrides,
            instrumentation: {
              outcome: "structured_steps",
              parsedStepCount: synthesizedFallback.length,
              parsedSubtaskCount: synthesizedFallback.length,
              requestedMultiStep: true,
            },
          };
        }
        // Simple task — return difficulty but no plan
        logger.info(
          "agent",
          "Planner returned insufficient subtasks for runtime plan",
          {
            requestedMultiStep: true,
            parsedStepCount: steps?.length ?? 0,
            parsedLegacySubtaskCount: legacySubtasks.length,
            difficulty,
          },
        );
        return {
          subtasks: [],
          difficulty,
          limitOverrides,
          instrumentation: {
            outcome: "insufficient_subtasks",
            parsedStepCount: steps?.length ?? 0,
            parsedSubtaskCount: legacySubtasks.length,
            requestedMultiStep: true,
          },
        };
      }

      // Hard cap: exhaustive bounded review tasks may need more than 8 steps
      // to cover all requested items plus a final synthesis/report step.
      if (subtasks.length > maxStructuredSteps) {
        logger.warn(
          "agent",
          "Planner decomposition exceeded step cap, truncating",
          {
            original: subtasks.length,
            maxStructuredSteps,
          },
        );
        if (steps) {
          const cappedSteps = steps.slice(0, maxStructuredSteps);
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
            instrumentation: {
              outcome: "structured_steps",
              parsedStepCount: cappedSteps.length,
              parsedSubtaskCount: cappedSteps.length,
              requestedMultiStep: true,
            },
          };
        }
        return {
          subtasks: subtasks.slice(0, maxStructuredSteps),
          difficulty,
          limitOverrides,
          instrumentation: {
            outcome: "legacy_subtasks",
            parsedStepCount: 0,
            parsedSubtaskCount: Math.min(subtasks.length, maxStructuredSteps),
            requestedMultiStep: true,
          },
        };
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
          instrumentation: {
            outcome: "structured_steps",
            parsedStepCount: steps.length,
            parsedSubtaskCount: steps.length,
            requestedMultiStep: true,
          },
        };
      }

      logger.info("agent", "Planner decomposed task", {
        subtaskCount: subtasks.length,
        difficulty,
      });
      return {
        subtasks,
        difficulty,
        limitOverrides,
        instrumentation: {
          outcome: "legacy_subtasks",
          parsedStepCount: 0,
          parsedSubtaskCount: subtasks.length,
          requestedMultiStep: true,
        },
      };
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
    successCriteria?: string,
    stateEvidence?: string,
  ): Promise<DoneValidation> {
    try {
      const planText = plan
        .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
        .join("\n");

      let userContent = `Original task: ${query}\n\nPlan:\n${planText}\n\nAgent summary: ${doneSummary}\n\nCurrent page: ${pageTitle} (${pageUrl})`;
      if (successCriteria) {
        userContent += `\n\nSuccess criteria (from planner — ALL must be satisfied):\n${successCriteria}`;
      }
      if (perception) {
        userContent += `\n\nCurrent page perception:\n${perception}`;
      }
      if (stateEvidence) {
        userContent += `\n\nDeterministic state evidence (DOM changes observed after agent's last actions):\n${stateEvidence}`;
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
        max_tokens: 4096,
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

      const fallbackCorpus = [
        query,
        doneSummary,
        pageTitle,
        pageUrl,
        perception,
        successCriteria,
        stateEvidence,
      ]
        .filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
        .join("\n")
        .toLowerCase();

      const requiresExplicitCompletionEvidence =
        /\b(checkout|place order|order confirmation|confirm order|submit order|purchase|payment|receipt)\b/.test(
          fallbackCorpus,
        );
      const hasExplicitCompletionEvidence =
        /\b(order confirmation|order confirmed|confirmation page|confirmation visible|order number|receipt|thank you(?: for your order)?|purchase complete|order complete|success banner|submitted successfully)\b/.test(
          fallbackCorpus,
        );
      const hasExplicitNegativeEvidence =
        /\b(no confirmation|no confirmation banner|no order number|not visible|still on checkout|still on cart)\b/.test(
          fallbackCorpus,
        );

      if (
        requiresExplicitCompletionEvidence &&
        (!hasExplicitCompletionEvidence || hasExplicitNegativeEvidence)
      ) {
        return {
          approved: false,
          reason:
            "Planner unavailable. Structural check completed, but explicit completion evidence is missing. Continue until confirmation is visible.",
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
      const blockerMatch = perception.match(
        /BLOCKERS:[\s\S]*?(?=\n[A-Z]+:|$)/i,
      );
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
          const relevantMatch = blockerText.match(
            /RELEVANT\s+\[\d+\]\s+"?([^"\n]+)"?/i,
          );
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
      if (
        urlMatches &&
        phrases.length > 0 &&
        matchedPhrases === phrases.length
      ) {
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

      // --- Phase B: Executor LLM (heuristics inconclusive) ---
      const executorLlm = this.getExecutorLlm();
      const start = Date.now();
      const response = await executorLlm.complete({
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
        max_tokens: 4096,
        temperature: 0,
        signal,
        response_format: { type: "json_object" },
      });
      const llmMs = Date.now() - start;
      if (response.usage) {
        this.usageCallback?.(
          response.usage,
          llmMs,
          response.actualModel ?? executorLlm.getCurrentModel(),
        );
      }

      const text = (response.content || "").trim();
      const cleaned = text
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        parsed = JSON.parse(match[0]);
      }

      const VALID_ALIGNMENTS = new Set([
        "aligned",
        "progressing",
        "deviated",
        "blocked",
      ]);
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
   * Uses planner model for high-quality plan repair.
   */
  async replanFrom(
    originalQuery: string,
    completedSteps: { index: number; objective: string; result?: string }[],
    failedStep: { index: number; objective: string },
    perception: string,
    pageUrl: string,
    signal?: AbortSignal,
    failureContext?: string,
  ): Promise<ReplanResult | null> {
    try {
      const REPLAN_SYSTEM = renderPrompt("planner.replan.system");

      const completedText =
        completedSteps.length > 0
          ? completedSteps
              .map(
                (s) =>
                  `${s.index + 1}. [done] ${s.objective}${s.result ? ` → ${s.result.slice(0, 100)}` : ""}`,
              )
              .join("\n")
          : "None completed yet.";

      const start = Date.now();
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: REPLAN_SYSTEM },
          {
            role: "user",
            content: `Original task: ${originalQuery}\n\nCompleted steps:\n${completedText}\n\nDeviated at step ${failedStep.index + 1}: "${failedStep.objective}"${failureContext ? `\n\nFailure analysis:\n${failureContext}` : ""}\n\nCurrent URL: ${pageUrl}\nCurrent perception:\n${perception.slice(0, 1000)}`,
          },
        ],
        max_tokens: 4096,
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
      const cleaned = text
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match)
          throw new Error(`No JSON object found in: ${cleaned.slice(0, 100)}`);
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
        if (
          typeof obj.objective !== "string" ||
          obj.objective.trim().length === 0
        )
          continue;

        let expectedState: PlanStep["expectedState"];
        if (
          obj.expectedState &&
          typeof obj.expectedState === "object" &&
          !Array.isArray(obj.expectedState)
        ) {
          const es = obj.expectedState as Record<string, unknown>;
          if (
            typeof es.description === "string" &&
            es.description.trim().length > 0
          ) {
            expectedState = {
              description: es.description.trim(),
              ...(typeof es.urlPattern === "string" &&
              es.urlPattern.trim().length > 0
                ? { urlPattern: es.urlPattern.trim() }
                : {}),
              ...(Array.isArray(es.expectedPhrases)
                ? {
                    expectedPhrases: (es.expectedPhrases as unknown[])
                      .filter((p): p is string => typeof p === "string")
                      .map((p) => p.trim()),
                  }
                : {}),
            };
          }
        }

        // Infer tool profile for replan steps (same logic as decompose)
        let toolProfile: PlanStep["toolProfile"];
        if (
          typeof obj.toolProfile === "string" &&
          VALID_TOOL_PROFILES.has(obj.toolProfile as ToolProfile)
        ) {
          toolProfile = obj.toolProfile as PlanStep["toolProfile"];
        } else {
          const sc =
            typeof obj.successCriteria === "string"
              ? obj.successCriteria.trim()
              : "Step completed.";
          toolProfile = inferToolProfileForStep(
            (obj.objective as string).trim(),
            sc,
          );
        }

        const replanObjective = (obj.objective as string).trim();
        const replanRawCriteria =
          typeof obj.successCriteria === "string"
            ? obj.successCriteria.trim()
            : `Step completed.`;
        newSteps.push({
          objective: replanObjective,
          successCriteria: ensureObservableCriteria(
            replanRawCriteria,
            replanObjective,
          ),
          dependencies: [],
          assumptions: Array.isArray(obj.assumptions)
            ? (obj.assumptions as unknown[])
                .filter((a): a is string => typeof a === "string")
                .map((a) => a.trim())
            : [],
          ...(toolProfile ? { toolProfile } : {}),
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
