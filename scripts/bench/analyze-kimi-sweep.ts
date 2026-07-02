#!/usr/bin/env tsx

import { createReadStream, existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import type { BenchJudgeOutcome, BenchTaskResult } from "./types";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_RUN_DIR = resolve(
  PROJECT_ROOT,
  ".artifacts/bench/kimi-k2p7-sweep-36",
);

type RunKey = "k2p6" | "k2p7-code";
type RootCause =
  | "external_site_environment"
  | "orchestration_completion"
  | "interaction_grounding"
  | "harness_infrastructure";

interface FailureCauseAssignment {
  category: RootCause;
  reason: string;
}

const FAILURE_CAUSES: Record<
  RunKey,
  Record<string, FailureCauseAssignment>
> = {
  k2p6: {
    "0a0fa834ce41b5297c6474293383759d_110325": {
      category: "interaction_grounding",
      reason:
        "Reached Carnival results but did not reliably finish duration filtering, select the cheapest cruise, or open its activities before timeout.",
    },
    "1223b07536a87e0170ff87cbbebd1d3c": {
      category: "interaction_grounding",
      reason:
        "Configured the quiz but did not sustain the repeated answer-check loop across ten questions; retries regressed to navigation and setup.",
    },
    "123e8c2fc453f55fadd1d0b9aaf94df4": {
      category: "external_site_environment",
      reason:
        "KBB returned Access Denied and fallback text mirrors could not provide an interactive filtered listing.",
    },
    "15be05973fba714e490cd9c884e4f072": {
      category: "external_site_environment",
      reason:
        "Search repeatedly landed on Google Sorry and chrome-error pages instead of usable Ohio licensing content.",
    },
    "207e933d1bba815bcb58664b5d82c085": {
      category: "external_site_environment",
      reason:
        "Apartments.com access and routing were unstable, returning blocked content or the homepage instead of usable Ohio City listings.",
    },
    "2d5a7f95f951a26838289dfd629ae850_110325": {
      category: "orchestration_completion",
      reason:
        "The executor treated the ZIP-code search substep as complete and never advanced to the pool and private-outdoor-space filters.",
    },
    "4464a8421f8bc8786524a499258dfad3": {
      category: "interaction_grounding",
      reason:
        "Could not operate Best Buy's search control reliably, escalated for a missing click capability that existed, and timed out on the homepage.",
    },
    "4c186c6ed888d0c8d4cf4adb39443080": {
      category: "external_site_environment",
      reason:
        "The NBA store redirected to a regional storefront and exposed access-denied behavior before product, size, or cart interaction.",
    },
    "50d91eabde542906937ab4c5b6f8f23a_121425": {
      category: "harness_infrastructure",
      reason:
        "The run consumed the timeout but produced zero trajectory turns, so no model behavior was available to evaluate.",
    },
    "5e4e89c9b6fdaee7a41aca5601b82e04": {
      category: "orchestration_completion",
      reason:
        "A form-fill completion contract rejected four done calls while the run looped through identifier forms without reaching a result.",
    },
    "63d6866fc000fcb1f153e07604bd1395": {
      category: "orchestration_completion",
      reason:
        "The run completed the popular-attraction substep, then hit four navigation-contract rejections and never executed nearby-attraction extraction.",
    },
    "7fff82864f21ddeccf4104a220892824": {
      category: "external_site_environment",
      reason:
        "Google Shopping repeatedly presented Sorry/reCAPTCHA pages, preventing product filtering and comparison.",
    },
    "9b5dfe54a1c14c5c6336bae7374c3bb5": {
      category: "external_site_environment",
      reason:
        "UPS forced a German locale and German drop-off flow, preventing a Spring, Texas location result.",
    },
    "bd1e3770b7181f6fce9c35e18caa9785": {
      category: "external_site_environment",
      reason:
        "The environment resolved Craigslist to Prague, where the requested query returned no service listings to browse.",
    },
    "c09721cc937d4dcfb391a0bc2c574b28": {
      category: "orchestration_completion",
      reason:
        "The search result satisfied the current substep, but a spurious form-fill contract rejected done fifteen times and blocked calendar work.",
    },
    "c2153fc053112e89c2f103869c4d6890": {
      category: "orchestration_completion",
      reason:
        "The run stopped after search and ZIP substeps; six rejected completions prevented advancing to weekly frequency.",
    },
    "c39d6c245f8243993e707d54d2f4acec": {
      category: "orchestration_completion",
      reason:
        "Incidental page choices triggered a quiz-selection contract, causing nine rejected completions before the skin carousel step.",
    },
    "d7c955b47af68e01766fa86d0bee08a7": {
      category: "interaction_grounding",
      reason:
        "The executor could not locate and operate Apartments.com's search/property controls before the timeout.",
    },
    "eb323dc584156d0eb3a2b90bb8c4b791_110325": {
      category: "orchestration_completion",
      reason:
        "Six navigation-contract rejections kept the run around the rentals landing page instead of applying beds, baths, and price ordering.",
    },
    "f27c0a7b8b0bb33d37698dff227fc8d7": {
      category: "external_site_environment",
      reason:
        "KBB returned Access Denied; read-only mirrors could not execute year and sort filters.",
    },
  },
  "k2p7-code": {
    "0a0fa834ce41b5297c6474293383759d_110325": {
      category: "orchestration_completion",
      reason:
        "The executor repeatedly completed navigation/search setup while later duration, cheapest-cruise, and activities steps remained unexecuted.",
    },
    "1223b07536a87e0170ff87cbbebd1d3c": {
      category: "interaction_grounding",
      reason:
        "Configured and started the quiz but answered at most one question; the repeated ten-question interaction loop did not stabilize.",
    },
    "123e8c2fc453f55fadd1d0b9aaf94df4": {
      category: "external_site_environment",
      reason:
        "KBB returned Access Denied and never exposed usable filtered listings.",
    },
    "15be05973fba714e490cd9c884e4f072": {
      category: "external_site_environment",
      reason:
        "Ohio.gov returned broken/404 routes and the run could not obtain a stable licensing page.",
    },
    "207e933d1bba815bcb58664b5d82c085": {
      category: "external_site_environment",
      reason:
        "Apartments.com returned Access Denied, Google Sorry, and robots.txt instead of usable listings.",
    },
    "2d5a7f95f951a26838289dfd629ae850_110325": {
      category: "orchestration_completion",
      reason:
        "The ZIP search substep became a quiz-selection contract with three rejected completions, so amenity filters never ran.",
    },
    "4464a8421f8bc8786524a499258dfad3": {
      category: "orchestration_completion",
      reason:
        "A form-fill contract rejected five attempts to finish the storefront-navigation substep and consumed the run before product research.",
    },
    "4c186c6ed888d0c8d4cf4adb39443080": {
      category: "external_site_environment",
      reason:
        "NBA Store/Fanatics routing was region-blocked or inaccessible before product, size, and cart actions.",
    },
    "50d91eabde542906937ab4c5b6f8f23a_121425": {
      category: "orchestration_completion",
      reason:
        "The executor treated opening the calculator as the objective; a quiz-selection contract rejected done nine times instead of prompting data entry.",
    },
    "63d6866fc000fcb1f153e07604bd1395": {
      category: "orchestration_completion",
      reason:
        "The plan stopped after finding the attraction/list page and never required extraction of nearby attractions from the Disneyland page.",
    },
    "6b2cfae0ef25c73d1224b6ab74cb8b63": {
      category: "interaction_grounding",
      reason:
        "The run clicked the season-type select without changing it to Playoffs, then stopped at the player profile without extracting the table.",
    },
    "7fff82864f21ddeccf4104a220892824": {
      category: "external_site_environment",
      reason:
        "Google Shopping presented reCAPTCHA and Bing fallback did not yield comparable local monitor results.",
    },
    "9b5dfe54a1c14c5c6336bae7374c3bb5": {
      category: "external_site_environment",
      reason:
        "UPS remained locked to the German locale, preventing a Spring, Texas access-point search.",
    },
    "bd1e3770b7181f6fce9c35e18caa9785": {
      category: "external_site_environment",
      reason:
        "Craigslist resolved to Prague and returned no results, despite the duplicate filter being active.",
    },
    "c09721cc937d4dcfb391a0bc2c574b28": {
      category: "orchestration_completion",
      reason:
        "A spurious form-fill contract rejected seventeen completions after the Albion search result, preventing availability-calendar work.",
    },
    "d7c955b47af68e01766fa86d0bee08a7": {
      category: "interaction_grounding",
      reason:
        "Reached the property page late but did not operate favorite or virtual-tour controls.",
    },
    "eb323dc584156d0eb3a2b90bb8c4b791_110325": {
      category: "interaction_grounding",
      reason:
        "Reached New York rentals but did not reliably operate bed, bath, and sort controls or compare listing prices.",
    },
    "f27c0a7b8b0bb33d37698dff227fc8d7": {
      category: "external_site_environment",
      reason:
        "KBB returned a confirmed Akamai Access Denied page with no usable interactive fallback.",
    },
  },
};

interface TraceEvent {
  type?: string;
  data?: Record<string, unknown>;
}

interface TraceRecord {
  llmRequest?: {
    contextMetrics?: {
      totalTokens?: number;
      utilization?: number;
      droppedMessageCount?: number;
      compressionLevel?: string;
    };
  };
  llmResponse?: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  events?: TraceEvent[];
  toolExecutions?: Array<{ success?: boolean }>;
  snapshot?: { url?: string; title?: string };
  postToolSnapshot?: { url?: string; title?: string };
}

interface TraceMetrics {
  malformedLines: number;
  failedToolExecutions: number;
  rejectedDone: number;
  acceptedDone: number;
  completionCandidates: number;
  contractKinds: string[];
  strategyPivots: number;
  bridgeRecoveryAttempts: number;
  bridgeRecoveryFailures: number;
  pathologies: Record<string, number>;
  maxPromptTokens: number;
  maxContextUtilization: number;
  maxDroppedMessages: number;
  compressedTurns: number;
  blockedSignals: string[];
}

interface TaskAnalysis {
  run: RunKey;
  taskId: string;
  task: string;
  level: string;
  outcome: BenchJudgeOutcome | "missing";
  completionStatus: string;
  turns: number;
  durationMs: number;
  finalUrl: string;
  traceMetrics: TraceMetrics;
}

interface PairedTaskAnalysis {
  taskId: string;
  task: string;
  level: string;
  k2p6: TaskAnalysis;
  k2p7: TaskAnalysis;
  transition: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function emptyTraceMetrics(): TraceMetrics {
  return {
    malformedLines: 0,
    failedToolExecutions: 0,
    rejectedDone: 0,
    acceptedDone: 0,
    completionCandidates: 0,
    contractKinds: [],
    strategyPivots: 0,
    bridgeRecoveryAttempts: 0,
    bridgeRecoveryFailures: 0,
    pathologies: {},
    maxPromptTokens: 0,
    maxContextUtilization: 0,
    maxDroppedMessages: 0,
    compressedTurns: 0,
    blockedSignals: [],
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function addBlockedSignals(
  record: TraceRecord,
  blockedSignals: Set<string>,
): void {
  const values = [
    record.snapshot?.url,
    record.snapshot?.title,
    record.postToolSnapshot?.url,
    record.postToolSnapshot?.title,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (/access denied/i.test(values)) blockedSignals.add("access_denied");
  if (/captcha|recaptcha/i.test(values)) blockedSignals.add("captcha");
  if (/sorry\/index|google.*sorry/i.test(values))
    blockedSignals.add("google_sorry");
  if (/robots\.txt/i.test(values)) blockedSignals.add("robots");
  if (/chrome-error|chromewebdata|err_/i.test(values))
    blockedSignals.add("chrome_error");
}

async function analyzeTrace(path: string): Promise<TraceMetrics> {
  const metrics = emptyTraceMetrics();
  const contractKinds = new Set<string>();
  const blockedSignals = new Set<string>();
  const input = createReadStream(path, { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let record: TraceRecord;
    try {
      record = JSON.parse(line) as TraceRecord;
    } catch {
      metrics.malformedLines += 1;
      continue;
    }
    const context = record.llmRequest?.contextMetrics;
    metrics.maxPromptTokens = Math.max(
      metrics.maxPromptTokens,
      context?.totalTokens ?? record.llmResponse?.usage?.prompt_tokens ?? 0,
    );
    metrics.maxContextUtilization = Math.max(
      metrics.maxContextUtilization,
      context?.utilization ?? 0,
    );
    metrics.maxDroppedMessages = Math.max(
      metrics.maxDroppedMessages,
      context?.droppedMessageCount ?? 0,
    );
    if (context?.compressionLevel && context.compressionLevel !== "none") {
      metrics.compressedTurns += 1;
    }
    addBlockedSignals(record, blockedSignals);
    metrics.failedToolExecutions += (record.toolExecutions ?? []).filter(
      (execution) => execution.success === false,
    ).length;

    for (const event of record.events ?? []) {
      const data = event.data ?? {};
      if (event.type === "completion_candidate") {
        metrics.completionCandidates += 1;
        const kind = stringValue(data.contractKind);
        if (kind) contractKinds.add(kind);
      }
      if (event.type === "completion_decision") {
        const status = stringValue(data.status);
        const source = stringValue(data.source);
        if (source === "model_done" && status === "rejected") {
          metrics.rejectedDone += 1;
        }
        if (source === "model_done" && status === "accepted") {
          metrics.acceptedDone += 1;
        }
      }
      if (event.type === "strategy_pivot") metrics.strategyPivots += 1;
      if (event.type === "bridge_recovery_attempt") {
        metrics.bridgeRecoveryAttempts += 1;
      }
      if (event.type === "bridge_recovery_result") {
        const success = data.success;
        if (success === false) metrics.bridgeRecoveryFailures += 1;
      }
      if (event.type === "multi_turn_pathology") {
        const pathology = stringValue(data.pathology) ?? "unknown";
        metrics.pathologies[pathology] =
          (metrics.pathologies[pathology] ?? 0) + 1;
      }
      if (event.type === "escalation") {
        const reasonCode = stringValue(data.reasonCode);
        if (reasonCode === "blocked") blockedSignals.add("model_escalated_blocked");
      }
      const promptTokens = numberValue(data.promptTokens);
      if (promptTokens) {
        metrics.maxPromptTokens = Math.max(
          metrics.maxPromptTokens,
          promptTokens,
        );
      }
    }
  }

  metrics.contractKinds = [...contractKinds].sort();
  metrics.blockedSignals = [...blockedSignals].sort();
  return metrics;
}

async function analyzeResult(
  runDir: string,
  run: RunKey,
  result: BenchTaskResult,
): Promise<TaskAnalysis> {
  const traceMetrics = emptyTraceMetrics();
  for (const relativePath of result.evidence.traceFiles) {
    const metrics = await analyzeTrace(join(runDir, run, relativePath));
    traceMetrics.malformedLines += metrics.malformedLines;
    traceMetrics.failedToolExecutions += metrics.failedToolExecutions;
    traceMetrics.rejectedDone += metrics.rejectedDone;
    traceMetrics.acceptedDone += metrics.acceptedDone;
    traceMetrics.completionCandidates += metrics.completionCandidates;
    traceMetrics.strategyPivots += metrics.strategyPivots;
    traceMetrics.bridgeRecoveryAttempts += metrics.bridgeRecoveryAttempts;
    traceMetrics.bridgeRecoveryFailures += metrics.bridgeRecoveryFailures;
    traceMetrics.maxPromptTokens = Math.max(
      traceMetrics.maxPromptTokens,
      metrics.maxPromptTokens,
    );
    traceMetrics.maxContextUtilization = Math.max(
      traceMetrics.maxContextUtilization,
      metrics.maxContextUtilization,
    );
    traceMetrics.maxDroppedMessages = Math.max(
      traceMetrics.maxDroppedMessages,
      metrics.maxDroppedMessages,
    );
    traceMetrics.compressedTurns += metrics.compressedTurns;
    for (const kind of metrics.contractKinds) {
      if (!traceMetrics.contractKinds.includes(kind)) {
        traceMetrics.contractKinds.push(kind);
      }
    }
    for (const signal of metrics.blockedSignals) {
      if (!traceMetrics.blockedSignals.includes(signal)) {
        traceMetrics.blockedSignals.push(signal);
      }
    }
    for (const [pathology, count] of Object.entries(metrics.pathologies)) {
      traceMetrics.pathologies[pathology] =
        (traceMetrics.pathologies[pathology] ?? 0) + count;
    }
  }

  return {
    run,
    taskId: result.evidence.task.task_id,
    task: result.evidence.task.confirmed_task,
    level: result.evidence.task.level,
    outcome: result.verdict?.outcome ?? "missing",
    completionStatus: result.evidence.completionStatus,
    turns: result.evidence.turns,
    durationMs: result.evidence.durationMs,
    finalUrl: result.evidence.finalUrl,
    traceMetrics,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarize(tasks: TaskAnalysis[]): Record<string, unknown> {
  const failures = tasks.filter((task) => task.outcome === "failure");
  const successes = tasks.filter((task) => task.outcome === "success");
  const summarizeGroup = (group: TaskAnalysis[]) => ({
    tasks: group.length,
    malformedTraceLines: group.reduce(
      (total, task) => total + task.traceMetrics.malformedLines,
      0,
    ),
    failedToolExecutions: group.reduce(
      (total, task) => total + task.traceMetrics.failedToolExecutions,
      0,
    ),
    medianTurns: median(group.map((task) => task.turns)),
    medianDurationMs: median(group.map((task) => task.durationMs)),
    rejectedDone: group.reduce(
      (total, task) => total + task.traceMetrics.rejectedDone,
      0,
    ),
    tasksWithRejectedDone: group.filter(
      (task) => task.traceMetrics.rejectedDone > 0,
    ).length,
    tasksWithThreeOrMoreRejectedDone: group.filter(
      (task) => task.traceMetrics.rejectedDone >= 3,
    ).length,
    bridgeRecoveryFailures: group.reduce(
      (total, task) => total + task.traceMetrics.bridgeRecoveryFailures,
      0,
    ),
    tasksWithBridgeRecoveryFailure: group.filter(
      (task) => task.traceMetrics.bridgeRecoveryFailures > 0,
    ).length,
    tasksWithBlockedSignals: group.filter(
      (task) => task.traceMetrics.blockedSignals.length > 0,
    ).length,
    tasksAtOrAbove290Seconds: group.filter(
      (task) => task.durationMs >= 290_000,
    ).length,
    maxPromptTokens: Math.max(
      0,
      ...group.map((task) => task.traceMetrics.maxPromptTokens),
    ),
    maxContextUtilization: Math.max(
      0,
      ...group.map((task) => task.traceMetrics.maxContextUtilization),
    ),
    compressedTurns: group.reduce(
      (total, task) => total + task.traceMetrics.compressedTurns,
      0,
    ),
    maxDroppedMessages: Math.max(
      0,
      ...group.map((task) => task.traceMetrics.maxDroppedMessages),
    ),
  });
  return {
    all: summarizeGroup(tasks),
    successes: summarizeGroup(successes),
    failures: summarizeGroup(failures),
  };
}

const ROOT_CAUSE_LABELS: Record<RootCause, string> = {
  external_site_environment: "External site / environment",
  orchestration_completion: "Orchestration / completion",
  interaction_grounding: "Interaction / grounding",
  harness_infrastructure: "Harness / infrastructure",
};

const ROOT_CAUSE_COLORS: Record<RootCause, string> = {
  external_site_environment: "#ef4444",
  orchestration_completion: "#7c3aed",
  interaction_grounding: "#f59e0b",
  harness_infrastructure: "#64748b",
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function countCauses(
  tasks: TaskAnalysis[],
): Record<RootCause, number> {
  const counts: Record<RootCause, number> = {
    external_site_environment: 0,
    orchestration_completion: 0,
    interaction_grounding: 0,
    harness_infrastructure: 0,
  };
  for (const task of tasks) {
    if (task.outcome !== "failure") continue;
    const assignment = FAILURE_CAUSES[task.run][task.taskId];
    if (!assignment) {
      throw new Error(`Missing failure cause for ${task.run}/${task.taskId}`);
    }
    counts[assignment.category] += 1;
  }
  return counts;
}

function binomialCoefficient(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - index + 1)) / index;
  }
  return result;
}

function exactTwoSidedMcNemarP(k2p7Wins: number, k2p6Wins: number): number {
  const discordant = k2p7Wins + k2p6Wins;
  if (discordant === 0) return 1;
  const lower = Math.min(k2p7Wins, k2p6Wins);
  let tail = 0;
  for (let value = 0; value <= lower; value += 1) {
    tail += binomialCoefficient(discordant, value) * 0.5 ** discordant;
  }
  return Math.min(1, tail * 2);
}

function causeLabel(task: TaskAnalysis): string {
  if (task.outcome === "success") return "Success";
  const assignment = FAILURE_CAUSES[task.run][task.taskId];
  return assignment ? ROOT_CAUSE_LABELS[assignment.category] : "Unclassified";
}

function formatRootCauseMarkdown(params: {
  byRun: Record<RunKey, TaskAnalysis[]>;
  paired: PairedTaskAnalysis[];
  causeCounts: Record<RunKey, Record<RootCause, number>>;
  k2p7Wins: number;
  k2p6Wins: number;
  mcnemarP: number;
}): string {
  const { byRun, paired, causeCounts, k2p7Wins, k2p6Wins, mcnemarP } =
    params;
  const pairedK2p6Successes = paired.filter(
    (task) => task.k2p6.outcome === "success",
  ).length;
  const pairedK2p7Successes = paired.filter(
    (task) => task.k2p7.outcome === "success",
  ).length;
  const sharedFailures = paired.filter(
    (task) =>
      task.k2p6.outcome === "failure" && task.k2p7.outcome === "failure",
  );
  const sameCauseShared = sharedFailures.filter(
    (task) =>
      FAILURE_CAUSES.k2p6[task.taskId]?.category ===
      FAILURE_CAUSES["k2p7-code"][task.taskId]?.category,
  ).length;
  const sharedExternal = sharedFailures.filter(
    (task) =>
      FAILURE_CAUSES.k2p6[task.taskId]?.category ===
        "external_site_environment" &&
      FAILURE_CAUSES["k2p7-code"][task.taskId]?.category ===
        "external_site_environment",
  ).length;
  const byLevel = (level: string) => {
    const tasks = paired.filter((task) => task.level === level);
    return {
      total: tasks.length,
      k2p6: tasks.filter((task) => task.k2p6.outcome === "success").length,
      k2p7: tasks.filter((task) => task.k2p7.outcome === "success").length,
    };
  };
  const k2p6Failures = byRun.k2p6.filter(
    (task) => task.outcome === "failure",
  );
  const k2p7Failures = byRun["k2p7-code"].filter(
    (task) => task.outcome === "failure",
  );
  const totalFailureInstances = k2p6Failures.length + k2p7Failures.length;
  const combinedCauseCounts = (
    Object.keys(ROOT_CAUSE_LABELS) as RootCause[]
  ).map((category) => ({
    category,
    count:
      causeCounts.k2p6[category] + causeCounts["k2p7-code"][category],
  }));
  const easy = byLevel("easy");
  const medium = byLevel("medium");
  const hard = byLevel("hard");
  const rows = paired.filter(
    (task) =>
      task.k2p6.outcome !== "success" || task.k2p7.outcome !== "success",
  );

  return [
    "# Kimi K2.6 vs K2.7 Root-Cause Analysis",
    "",
    "> Based on six receipt-backed verdict corrections. Raw WebJudge files remain unchanged.",
    "",
    "## Executive findings",
    "",
    `- Fair paired result: K2.6 ${pairedK2p6Successes}/${paired.length} (${pct(pairedK2p6Successes / paired.length)}) vs K2.7 ${pairedK2p7Successes}/${paired.length} (${pct(pairedK2p7Successes / paired.length)}).`,
    `- Only ${k2p7Wins + k2p6Wins} paired tasks are discordant: K2.7 wins ${k2p7Wins}, K2.6 wins ${k2p6Wins}. Exact McNemar p=${mcnemarP.toFixed(3)}; this sweep does not establish a statistically reliable model advantage.`,
    `- Both models fail the same ${sharedFailures.length}/${paired.length} tasks. ${sameCauseShared}/${sharedFailures.length} share the same broad primary cause, including ${sharedExternal} tasks blocked by site, locale, CAPTCHA, or data availability.`,
    "- The dominant internal bottleneck is the planner/completion handshake, not context length: narrow hidden substeps combine with heuristic completion contracts that can reject correct substep completion indefinitely.",
    "- K2.7 is materially less exposed to bridge-recovery failure, but its failed runs more often consume the full 300-second budget.",
    "",
    "## Primary failure causes",
    "",
    "| Cause | K2.6 failures | K2.7 failures | Combined failure instances |",
    "| --- | ---: | ---: | ---: |",
    ...combinedCauseCounts.map(
      ({ category, count }) =>
        `| ${ROOT_CAUSE_LABELS[category]} | ${causeCounts.k2p6[category]} | ${causeCounts["k2p7-code"][category]} | ${count}/${totalFailureInstances} (${pct(count / totalFailureInstances)}) |`,
    ),
    "",
    "Primary cause is the first mechanism that made the literal objective unattainable in the recorded run. Bridge failures and completion rejections are counted separately as amplifiers.",
    "",
    "## Difficulty",
    "",
    "| Level | K2.6 paired | K2.7 paired | Interpretation |",
    "| --- | ---: | ---: | --- |",
    `| Easy | ${easy.k2p6}/${easy.total} (${pct(easy.k2p6 / easy.total)}) | ${easy.k2p7}/${easy.total} (${pct(easy.k2p7 / easy.total)}) | Easy failures were Craigslist locality/no-results, Albion completion deadlock, Elevate interaction, plus Thumbtack completion deadlock for K2.6. |`,
    `| Medium | ${medium.k2p6}/${medium.total} (${pct(medium.k2p6 / medium.total)}) | ${medium.k2p7}/${medium.total} (${pct(medium.k2p7 / medium.total)}) | Tied after receipt audit; blockers and partial multi-step execution dominate. |`,
    `| Hard | ${hard.k2p6}/${hard.total} (${pct(hard.k2p6 / hard.total)}) | ${hard.k2p7}/${hard.total} (${pct(hard.k2p7 / hard.total)}) | K2.7's Ahri pass is a real carousel traversal, not a lucky static layout. |`,
    "",
    "## Runtime signals",
    "",
    "| Signal in failed runs | K2.6 | K2.7 |",
    "| --- | ---: | ---: |",
    `| Rejected done calls | ${k2p6Failures.reduce((sum, task) => sum + task.traceMetrics.rejectedDone, 0)} across ${k2p6Failures.filter((task) => task.traceMetrics.rejectedDone > 0).length}/${k2p6Failures.length} tasks | ${k2p7Failures.reduce((sum, task) => sum + task.traceMetrics.rejectedDone, 0)} across ${k2p7Failures.filter((task) => task.traceMetrics.rejectedDone > 0).length}/${k2p7Failures.length} tasks |`,
    `| Failed bridge recoveries | ${k2p6Failures.reduce((sum, task) => sum + task.traceMetrics.bridgeRecoveryFailures, 0)} across ${k2p6Failures.filter((task) => task.traceMetrics.bridgeRecoveryFailures > 0).length}/${k2p6Failures.length} tasks | ${k2p7Failures.reduce((sum, task) => sum + task.traceMetrics.bridgeRecoveryFailures, 0)} across ${k2p7Failures.filter((task) => task.traceMetrics.bridgeRecoveryFailures > 0).length}/${k2p7Failures.length} tasks |`,
    `| Runs at least 290 seconds | ${k2p6Failures.filter((task) => task.durationMs >= 290_000).length}/${k2p6Failures.length} | ${k2p7Failures.filter((task) => task.durationMs >= 290_000).length}/${k2p7Failures.length} |`,
    `| Maximum context utilization | ${pct(Math.max(...k2p6Failures.map((task) => task.traceMetrics.maxContextUtilization)))} | ${pct(Math.max(...k2p7Failures.map((task) => task.traceMetrics.maxContextUtilization)))} |`,
    `| Failed tool executions | ${k2p6Failures.reduce((sum, task) => sum + task.traceMetrics.failedToolExecutions, 0)} | ${k2p7Failures.reduce((sum, task) => sum + task.traceMetrics.failedToolExecutions, 0)} |`,
    "",
    "## Task-level comparison",
    "",
    "| Level | Task | Transition | K2.6 primary cause | K2.7 primary cause |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (task) =>
        `| ${task.level} | ${task.task.replaceAll("|", "\\|")} | ${task.transition} | ${causeLabel(task.k2p6)} | ${causeLabel(task.k2p7)} |`,
    ),
    "",
    "## Mechanism conclusions",
    "",
    "1. External access is the largest single category. KBB, Google Shopping, Apartments.com, NBA Store, UPS locale routing, and Prague Craigslist account for eight shared failures.",
    "2. Completion contracts are frequently selected from incidental page controls. Quiz contracts blocked Ahri and BabyCenter; form contracts blocked Albion and Best Buy; navigation contracts blocked Trip.com and Compass flows.",
    "3. The handoff deliberately hides future step descriptions and tells the executor not to execute them. When the current substep cannot be accepted, recovery pivots preserve the same objective/contract and create a deadlock.",
    "4. Dynamic interaction remains a model-level weakness: repeated quizzes, rich filters, virtual tours, and select controls fail even when access is available.",
    "5. Context size is not the universal bottleneck. Failed runs peaked far below the available context window, and failed tool executions were rare compared with semantic incompletion.",
    "",
    "## Model differences",
    "",
    "- K2.7 wins pill identification, weekly Thumbtack filtering, and the Ahri carousel. These are genuine interaction/recovery improvements.",
    "- K2.6's only paired unique win is Devin Booker playoff PPG. K2.7 reached the stats page but failed to change the season-type select and extract the playoff table.",
    "- K2.7 had far fewer failed bridge recoveries, while K2.6 was more affected by reinjection/recovery instability.",
    "- K2.7 failures clustered at the timeout boundary, indicating persistence without successful replanning rather than early abandonment.",
    "",
    "## Recommended fix order",
    "",
    "1. Make benchmark locale and egress deterministic; detect hard blocks and mark tasks environment-blocked instead of charging them to the model.",
    "2. Generate completion contracts from the active objective and explicit success criteria, not incidental visible controls; invalidate the contract after repeated contradictory rejections.",
    "3. Repair the planner/executor handshake so verified substep completion advances the plan, and expose enough next-step intent to prevent repeated navigation-only done calls.",
    "4. Add act-check-act primitives for dynamic selects, repeated quiz loops, filters, carousels, favorites, and virtual-tour controls.",
    "5. Harden bridge reinjection, especially for the K2.6 path, and distinguish bridge failure from model failure in benchmark reporting.",
    "",
    "## Caveats",
    "",
    "- K2.7 is missing the Rotten Tomatoes Easy task, so only the 31 common tasks support paired claims.",
    "- Root-cause categories are receipt-backed but manually assigned; several runs have secondary contributing mechanisms.",
    "- Six tasks per difficulty band are insufficient for promotion or broad capability claims.",
    "",
  ].join("\n");
}

function svgText(
  x: number,
  y: number,
  text: string,
  options: {
    size?: number;
    weight?: number;
    fill?: string;
    anchor?: "start" | "middle" | "end";
  } = {},
): string {
  return `<text x="${x}" y="${y}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${options.size ?? 18}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? "#172033"}" text-anchor="${options.anchor ?? "start"}">${escapeXml(text)}</text>`;
}

function buildRootCauseSvg(params: {
  paired: PairedTaskAnalysis[];
  causeCounts: Record<RunKey, Record<RootCause, number>>;
  k2p7Wins: number;
  k2p6Wins: number;
  mcnemarP: number;
}): string {
  const { paired, causeCounts, k2p7Wins, k2p6Wins, mcnemarP } = params;
  const width = 1400;
  const height = 900;
  const pairedK2p6Successes = paired.filter(
    (task) => task.k2p6.outcome === "success",
  ).length;
  const pairedK2p7Successes = paired.filter(
    (task) => task.k2p7.outcome === "success",
  ).length;
  const sharedFailures = paired.filter(
    (task) =>
      task.k2p6.outcome === "failure" && task.k2p7.outcome === "failure",
  ).length;
  const categories = Object.keys(ROOT_CAUSE_LABELS) as RootCause[];
  const runs: Array<{
    key: RunKey;
    label: string;
    failures: number;
    x: number;
  }> = [
    { key: "k2p6", label: "K2.6", failures: 20, x: 770 },
    { key: "k2p7-code", label: "K2.7 Code", failures: 18, x: 1050 },
  ];
  const elements = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>`,
    '<rect x="34" y="30" width="1332" height="840" rx="24" fill="#ffffff" stroke="#e2e8f0"/>',
    svgText(78, 88, "Kimi K2.6 vs K2.7: Failure Root Causes", {
      size: 34,
      weight: 700,
    }),
    svgText(
      78,
      124,
      "31 paired tasks | six receipt-backed judge corrections | compatibility evidence, not a promotion benchmark",
      { size: 17, fill: "#64748b" },
    ),
    '<rect x="78" y="165" width="570" height="265" rx="18" fill="#f8fafc" stroke="#e2e8f0"/>',
    svgText(108, 205, "Paired pass rate", { size: 23, weight: 700 }),
  ];
  const scoreBars = [
    {
      label: "K2.6",
      successes: pairedK2p6Successes,
      rate: pairedK2p6Successes / paired.length,
      y: 255,
      color: "#2563eb",
    },
    {
      label: "K2.7 Code",
      successes: pairedK2p7Successes,
      rate: pairedK2p7Successes / paired.length,
      y: 335,
      color: "#7c3aed",
    },
  ];
  for (const bar of scoreBars) {
    elements.push(
      svgText(108, bar.y + 24, bar.label, { size: 19, weight: 600 }),
      `<rect x="230" y="${bar.y}" width="330" height="34" rx="8" fill="#e2e8f0"/>`,
      `<rect x="230" y="${bar.y}" width="${330 * bar.rate}" height="34" rx="8" fill="${bar.color}"/>`,
      svgText(
        575,
        bar.y + 25,
        `${bar.successes}/${paired.length}  ${pct(bar.rate)}`,
        { size: 19, weight: 700, fill: bar.color, anchor: "end" },
      ),
    );
  }
  elements.push(
    svgText(
      108,
      402,
      `Discordant: K2.7 ${k2p7Wins} wins, K2.6 ${k2p6Wins} win | exact p=${mcnemarP.toFixed(3)}`,
      { size: 16, fill: "#475569" },
    ),
    '<rect x="680" y="165" width="638" height="425" rx="18" fill="#f8fafc" stroke="#e2e8f0"/>',
    svgText(710, 205, "Primary cause among failed runs", {
      size: 23,
      weight: 700,
    }),
  );
  const legendPositions: Array<{
    category: RootCause;
    x: number;
    y: number;
  }> = [
    { category: "external_site_environment", x: 710, y: 225 },
    { category: "orchestration_completion", x: 950, y: 225 },
    { category: "interaction_grounding", x: 710, y: 252 },
    { category: "harness_infrastructure", x: 950, y: 252 },
  ];
  for (const { category, x, y } of legendPositions) {
    elements.push(
      `<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${ROOT_CAUSE_COLORS[category]}"/>`,
      svgText(x + 21, y + 12, ROOT_CAUSE_LABELS[category], {
        size: 13,
        fill: "#475569",
      }),
    );
  }
  const chartTop = 290;
  const chartBottom = 520;
  const chartHeight = chartBottom - chartTop;
  for (const run of runs) {
    let y = chartBottom;
    for (const category of categories) {
      const count = causeCounts[run.key][category];
      const segmentHeight = (count / run.failures) * chartHeight;
      y -= segmentHeight;
      if (segmentHeight > 0) {
        elements.push(
          `<rect x="${run.x}" y="${y}" width="155" height="${segmentHeight}" fill="${ROOT_CAUSE_COLORS[category]}"/>`,
        );
        if (segmentHeight >= 28) {
          elements.push(
            svgText(
              run.x + 77.5,
              y + segmentHeight / 2 + 6,
              `${count}`,
              {
                size: 18,
                weight: 700,
                fill: "#ffffff",
                anchor: "middle",
              },
            ),
          );
        }
      }
    }
    elements.push(
      svgText(run.x + 77.5, 552, run.label, {
        size: 20,
        weight: 700,
        anchor: "middle",
      }),
      svgText(run.x + 77.5, 577, `${run.failures} failures`, {
        size: 15,
        fill: "#64748b",
        anchor: "middle",
      }),
    );
  }
  elements.push(
    '<rect x="78" y="465" width="570" height="125" rx="18" fill="#fff7ed" stroke="#fed7aa"/>',
    svgText(108, 505, `${sharedFailures} shared failures`, {
      size: 27,
      weight: 700,
      fill: "#9a3412",
    }),
    svgText(108, 538, "8 are shared external/site-environment blocks.", {
      size: 18,
      fill: "#7c2d12",
    }),
    svgText(108, 566, "13 share the same broad primary cause.", {
      size: 18,
      fill: "#7c2d12",
    }),
    '<rect x="78" y="625" width="1240" height="190" rx="18" fill="#f8fafc" stroke="#e2e8f0"/>',
    svgText(108, 667, "What drives the variance", {
      size: 24,
      weight: 700,
    }),
    svgText(
      108,
      706,
      "1. Locale, bot protection, and site availability change whether the task is executable at all.",
      { size: 18, fill: "#334155" },
    ),
    svgText(
      108,
      741,
      "2. Hidden planner substeps plus heuristic completion contracts can trap a correct executor state.",
      { size: 18, fill: "#334155" },
    ),
    svgText(
      108,
      776,
      "3. K2.7 is stronger on some dynamic workflows, but still struggles with repeated controls and replanning.",
      { size: 18, fill: "#334155" },
    ),
    svgText(
      108,
      842,
      "Context saturation is not the shared bottleneck: failed runs peaked at 41.1% (K2.6) and 29.5% (K2.7).",
      { size: 15, fill: "#64748b" },
    ),
    "</svg>",
  );
  return elements.join("\n");
}

async function main(): Promise<void> {
  const runDirIndex = process.argv.indexOf("--run-dir");
  const runDir =
    runDirIndex >= 0 && process.argv[runDirIndex + 1]
      ? resolve(process.cwd(), process.argv[runDirIndex + 1])
      : DEFAULT_RUN_DIR;
  if (!existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`);
  }

  const byRun = {} as Record<RunKey, TaskAnalysis[]>;
  for (const run of ["k2p6", "k2p7-code"] as const) {
    const resultPath = join(runDir, run, "results.audited.json");
    if (!existsSync(resultPath)) {
      throw new Error(`Missing audited results: ${resultPath}`);
    }
    const results = readJson<BenchTaskResult[]>(resultPath);
    byRun[run] = [];
    for (const result of results) {
      if (result.evidence.completionStatus === "skipped") continue;
      byRun[run].push(await analyzeResult(runDir, run, result));
    }
  }

  const k2p7ById = new Map(
    byRun["k2p7-code"].map((task) => [task.taskId, task]),
  );
  const paired: PairedTaskAnalysis[] = byRun.k2p6
    .filter((task) => k2p7ById.has(task.taskId))
    .map((k2p6) => {
      const k2p7 = k2p7ById.get(k2p6.taskId)!;
      return {
        taskId: k2p6.taskId,
        task: k2p6.task,
        level: k2p6.level,
        k2p6,
        k2p7,
        transition: `${k2p6.outcome}->${k2p7.outcome}`,
      };
    });
  const transitionCounts = Object.fromEntries(
    [...new Set(paired.map((task) => task.transition))]
      .sort()
      .map((transition) => [
        transition,
        paired.filter((task) => task.transition === transition).length,
      ]),
  );
  for (const run of ["k2p6", "k2p7-code"] as const) {
    for (const task of byRun[run]) {
      if (task.outcome === "failure" && !FAILURE_CAUSES[run][task.taskId]) {
        throw new Error(`Missing failure classification for ${run}/${task.taskId}`);
      }
    }
  }
  const causeCounts = {
    k2p6: countCauses(byRun.k2p6),
    "k2p7-code": countCauses(byRun["k2p7-code"]),
  };
  const k2p7Wins = paired.filter(
    (task) =>
      task.k2p6.outcome === "failure" && task.k2p7.outcome === "success",
  ).length;
  const k2p6Wins = paired.filter(
    (task) =>
      task.k2p6.outcome === "success" && task.k2p7.outcome === "failure",
  ).length;
  const mcnemarP = exactTwoSidedMcNemarP(k2p7Wins, k2p6Wins);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRunDir: basename(runDir),
    pairedTaskCount: paired.length,
    transitionCounts,
    pairedComparison: {
      k2p6Successes: paired.filter(
        (task) => task.k2p6.outcome === "success",
      ).length,
      k2p7Successes: paired.filter(
        (task) => task.k2p7.outcome === "success",
      ).length,
      k2p7Wins,
      k2p6Wins,
      exactMcNemarP: mcnemarP,
    },
    causeCounts,
    summaries: {
      k2p6: summarize(byRun.k2p6),
      k2p7Code: summarize(byRun["k2p7-code"]),
    },
    failureClassifications: {
      k2p6: byRun.k2p6
        .filter((task) => task.outcome === "failure")
        .map((task) => ({
          taskId: task.taskId,
          task: task.task,
          level: task.level,
          ...FAILURE_CAUSES.k2p6[task.taskId],
        })),
      k2p7Code: byRun["k2p7-code"]
        .filter((task) => task.outcome === "failure")
        .map((task) => ({
          taskId: task.taskId,
          task: task.task,
          level: task.level,
          ...FAILURE_CAUSES["k2p7-code"][task.taskId],
        })),
    },
    paired: paired.map((task) => ({
      ...task,
      k2p6PrimaryCause:
        task.k2p6.outcome === "failure"
          ? FAILURE_CAUSES.k2p6[task.taskId]
          : null,
      k2p7PrimaryCause:
        task.k2p7.outcome === "failure"
          ? FAILURE_CAUSES["k2p7-code"][task.taskId]
          : null,
    })),
  };
  const jsonPath = join(runDir, "root-cause.json");
  const metricsPath = join(runDir, "root-cause.metrics.json");
  const markdownPath = join(runDir, "root-cause.md");
  const svgPath = join(runDir, "root-cause.svg");
  writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  writeFileSync(metricsPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  writeFileSync(
    markdownPath,
    formatRootCauseMarkdown({
      byRun,
      paired,
      causeCounts,
      k2p7Wins,
      k2p6Wins,
      mcnemarP,
    }),
    "utf-8",
  );
  writeFileSync(
    svgPath,
    buildRootCauseSvg({
      paired,
      causeCounts,
      k2p7Wins,
      k2p6Wins,
      mcnemarP,
    }),
    "utf-8",
  );
  console.log(`Wrote root-cause artifacts to ${runDir}`);
  console.log(JSON.stringify(output.summaries, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
