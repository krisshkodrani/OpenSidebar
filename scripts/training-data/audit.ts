#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { redactTracePayload } from "../../apps/extension/src/utils/trace-protection.js";

type Json = Record<string, any>;

export type AuditCandidate = {
  id: string;
  sourceHash: string;
  schemaVersion: string;
  sessionId: string;
  turnNumber: number;
  role: "executor" | "planner-tier-executor";
  domain: string;
  outcome: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  messages: Json[];
  target: Json;
  targetToolNames: string[];
  toolExecutionsSuccessful: boolean | null;
  score: number;
  warnings: string[];
};

type AuditCounters = {
  files: number;
  malformedLines: number;
  turns: number;
  turnsWithMessages: number;
  turnsWithResponses: number;
  turnsWithImagesFlattened: number;
  executorTurns: number;
  plannerTierExecutorTurns: number;
  verifiedSuccessTurns: number;
  candidateTurns: number;
  uniqueCandidates: number;
  duplicateCandidates: number;
  successfulCandidates: number;
  cleanCandidates: number;
  successfulCandidateTokens: number;
  cleanCandidateTokens: number;
  promptTokens: number;
  completionTokens: number;
  candidatePromptTokens: number;
  candidateCompletionTokens: number;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_TRACE_DIR = join(ROOT, "traces");
const DEFAULT_OUTPUT_DIR = join(ROOT, ".artifacts", "training-data-audit");

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isSuccessfulOutcome(outcome: string): boolean {
  return outcome === "completed" || outcome === "success";
}

function domainOf(entry: Json): string {
  const raw = text(entry.snapshot?.url);
  try {
    return new URL(raw).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

function assistantTarget(response: Json): Json | null {
  const content = response?.content;
  const toolCalls = Array.isArray(response?.toolCalls)
    ? response.toolCalls
    : [];
  if (
    typeof content !== "string" &&
    content !== null &&
    toolCalls.length === 0
  ) {
    return null;
  }
  const target: Json = { role: "assistant", content: content ?? null };
  if (toolCalls.length > 0) target.tool_calls = toolCalls;
  return target;
}

function validToolCalls(toolCalls: unknown): boolean {
  if (!Array.isArray(toolCalls)) return true;
  return toolCalls.every((call) => {
    if (!call || typeof call !== "object") return false;
    const fn = (call as Json).function;
    if (
      !fn ||
      typeof fn.name !== "string" ||
      typeof fn.arguments !== "string"
    ) {
      return false;
    }
    try {
      JSON.parse(fn.arguments);
      return true;
    } catch {
      return false;
    }
  });
}

function containsFlattenedImage(messages: Json[]): boolean {
  return messages.some((message) => text(message.content).includes("[image]"));
}

export function candidateFromTurn(
  entry: Json,
  outcome: string,
  sourceHash?: string,
): AuditCandidate | null {
  const messages = entry.llmRequest?.messages;
  const response = entry.llmResponse;
  if (!Array.isArray(messages) || messages.length === 0 || !response)
    return null;
  const target = assistantTarget(response);
  if (!target || !validToolCalls(response.toolCalls)) return null;
  if (text(response.finishReason).toLowerCase().includes("length")) return null;

  const tier = text(entry.llmRequest?.modelTier) || "executor";
  const role = tier === "planner" ? "planner-tier-executor" : "executor";
  const executions = Array.isArray(entry.toolExecutions)
    ? entry.toolExecutions
    : [];
  const targetToolNames = Array.isArray(response.toolCalls)
    ? response.toolCalls
        .map((call: Json) => text(call.function?.name))
        .filter(Boolean)
    : [];
  const toolsOk =
    executions.length > 0
      ? executions.every((execution: Json) => execution.success === true)
      : targetToolNames.length > 0
        ? null
        : true;
  const warnings: string[] = [];
  if (containsFlattenedImage(messages)) warnings.push("flattened_image_input");
  if (role === "planner-tier-executor") {
    warnings.push("planner_tier_is_not_orchestrator_planner");
  }
  if (toolsOk === false) warnings.push("tool_execution_failed");
  if (toolsOk === null) warnings.push("missing_tool_execution_receipt");
  if (!isSuccessfulOutcome(outcome))
    warnings.push("session_not_verified_success");
  if (
    /(?:^|\.)service-now\.com$|(?:^|\.)servicenow\.com$/i.test(domainOf(entry)) ||
    targetToolNames.some((name) => /servicenow/i.test(name)) ||
    /servicenow|service-now|workarena/i.test(
      JSON.stringify({ messages, target }),
    )
  ) {
    warnings.push("removed_servicenow_workflow");
  }

  let score = 0;
  if (isSuccessfulOutcome(outcome)) score += 5;
  if (toolsOk === true) score += 3;
  if (warnings.length === 0) score += 2;
  if (targetToolNames.length > 0) score += 1;

  const completionTokens = number(response.usage?.completion_tokens);
  const promptTokens = number(response.usage?.prompt_tokens);
  const identity = {
    messages,
    target,
    role,
  };
  return {
    id: createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex")
      .slice(0, 20),
    sourceHash:
      sourceHash ?? createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
    schemaVersion: text(entry.schemaVersion) || "legacy",
    sessionId: text(entry.sessionId),
    turnNumber: number(entry.turnNumber),
    role,
    domain: domainOf(entry),
    outcome,
    model: text(response.actualModel) || text(entry.llmRequest?.model),
    promptTokens,
    completionTokens,
    messages,
    target,
    targetToolNames,
    toolExecutionsSuccessful: toolsOk,
    score,
    warnings,
  };
}

function readOutcomes(traceDir: string): Map<string, string> {
  const path = join(traceDir, "index.jsonl");
  const outcomes = new Map<string, string>();
  if (!existsSync(path)) return outcomes;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Json;
      if (record.sessionId)
        outcomes.set(record.sessionId, text(record.outcome));
    } catch {
      // The streaming trace scan reports malformed turn records separately.
    }
  }
  return outcomes;
}

async function scanFile(
  path: string,
  outcomes: Map<string, string>,
  counters: AuditCounters,
  uniqueIds: Set<string>,
  reviewed: AuditCandidate[],
  plannerGaps: AuditCandidate[],
  sampleSize: number,
): Promise<void> {
  const input = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    let entry: Json;
    try {
      entry = JSON.parse(line) as Json;
    } catch {
      counters.malformedLines++;
      continue;
    }
    if (!entry.llmRequest || !entry.llmResponse) continue;
    counters.turns++;
    const messages = entry.llmRequest.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      counters.turnsWithMessages++;
      if (containsFlattenedImage(messages)) counters.turnsWithImagesFlattened++;
    }
    counters.turnsWithResponses++;
    const tier = text(entry.llmRequest.modelTier) || "executor";
    if (tier === "planner") counters.plannerTierExecutorTurns++;
    else counters.executorTurns++;
    const usage = entry.llmResponse.usage ?? {};
    counters.promptTokens += number(usage.prompt_tokens);
    counters.completionTokens += number(usage.completion_tokens);
    const outcome = outcomes.get(text(entry.sessionId)) || "unknown";
    if (isSuccessfulOutcome(outcome)) counters.verifiedSuccessTurns++;
    const candidate = candidateFromTurn(
      entry,
      outcome,
      createHash("sha256").update(line).digest("hex"),
    );
    if (!candidate) continue;
    counters.candidateTurns++;
    counters.candidatePromptTokens += candidate.promptTokens;
    counters.candidateCompletionTokens += candidate.completionTokens;
    if (uniqueIds.has(candidate.id)) {
      counters.duplicateCandidates++;
      continue;
    }
    uniqueIds.add(candidate.id);
    counters.uniqueCandidates++;
    if (isSuccessfulOutcome(candidate.outcome)) counters.successfulCandidates++;
    if (isSuccessfulOutcome(candidate.outcome)) {
      counters.successfulCandidateTokens +=
        candidate.promptTokens + candidate.completionTokens;
    }
    if (candidate.warnings.length === 0) {
      counters.cleanCandidates++;
      counters.cleanCandidateTokens +=
        candidate.promptTokens + candidate.completionTokens;
    }
    if (
      candidate.role === "planner-tier-executor" &&
      plannerGaps.length < sampleSize
    ) {
      plannerGaps.push(candidate);
    }
    considerForReviewedSample(reviewed, candidate, sampleSize);
  }
}

function considerForReviewedSample(
  selected: AuditCandidate[],
  candidate: AuditCandidate,
  limit: number,
): void {
  if (
    selected.length >= limit ||
    candidate.role !== "executor" ||
    !isSuccessfulOutcome(candidate.outcome) ||
    candidate.toolExecutionsSuccessful !== true ||
    candidate.warnings.length > 0
  ) {
    return;
  }
  const tool = candidate.targetToolNames[0] || "text_response";
  const domainCount = selected.filter(
    (item) => item.domain === candidate.domain,
  ).length;
  const toolCount = selected.filter(
    (item) => (item.targetToolNames[0] || "text_response") === tool,
  ).length;
  if (domainCount >= Math.max(2, Math.ceil(limit / 4))) return;
  if (toolCount >= Math.max(2, Math.ceil(limit / 5))) return;
  selected.push(candidate);
}

function writeJsonl(path: string, records: unknown[]): void {
  const stream = createWriteStream(path, { encoding: "utf8" });
  for (const record of records) stream.write(`${JSON.stringify(record)}\n`);
  stream.end();
}

function parseArgs(argv: string[]): {
  traceDir: string;
  outputDir: string;
  sampleSize: number;
} {
  let traceDir = DEFAULT_TRACE_DIR;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let sampleSize = 40;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--trace-dir") traceDir = resolve(argv[++index]);
    else if (arg === "--output-dir") outputDir = resolve(argv[++index]);
    else if (arg === "--sample-size") sampleSize = Number(argv[++index]);
    else if (arg === "--help") {
      console.log(
        "Usage: tsx scripts/training-data/audit.ts [--trace-dir PATH] [--output-dir PATH] [--sample-size N]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 1000) {
    throw new Error("--sample-size must be an integer between 1 and 1000");
  }
  return { traceDir, outputDir, sampleSize };
}

export async function runAudit(input: {
  traceDir: string;
  outputDir: string;
  sampleSize: number;
}): Promise<void> {
  mkdirSync(input.outputDir, { recursive: true });
  const outcomes = readOutcomes(input.traceDir);
  const files = readdirSync(input.traceDir)
    .filter((file) => file.endsWith(".jsonl") && file !== "index.jsonl")
    .sort();
  const counters: AuditCounters = {
    files: files.length,
    malformedLines: 0,
    turns: 0,
    turnsWithMessages: 0,
    turnsWithResponses: 0,
    turnsWithImagesFlattened: 0,
    executorTurns: 0,
    plannerTierExecutorTurns: 0,
    verifiedSuccessTurns: 0,
    candidateTurns: 0,
    uniqueCandidates: 0,
    duplicateCandidates: 0,
    successfulCandidates: 0,
    cleanCandidates: 0,
    successfulCandidateTokens: 0,
    cleanCandidateTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    candidatePromptTokens: 0,
    candidateCompletionTokens: 0,
  };
  const uniqueIds = new Set<string>();
  const sample: AuditCandidate[] = [];
  const plannerGaps: AuditCandidate[] = [];
  for (const file of files) {
    await scanFile(
      join(input.traceDir, file),
      outcomes,
      counters,
      uniqueIds,
      sample,
      plannerGaps,
      input.sampleSize,
    );
  }

  writeJsonl(
    join(input.outputDir, "executor-review-queue.jsonl"),
    sample.map((candidate) => ({
      messages: redactTracePayload(
        [...candidate.messages, candidate.target],
        { mode: "export" },
      ),
      metadata: {
        id: candidate.id,
        sourceHash: candidate.sourceHash,
        schemaVersion: candidate.schemaVersion,
        sessionId: candidate.sessionId,
        turnNumber: candidate.turnNumber,
        domain: candidate.domain,
        sourceModel: candidate.model,
        outcome: candidate.outcome,
        toolExecutionsSuccessful: candidate.toolExecutionsSuccessful,
        recordedPromptTokens: candidate.promptTokens,
        recordedCompletionTokens: candidate.completionTokens,
        reviewStatus: "needs_human_review",
      },
    })),
  );
  writeJsonl(
    join(input.outputDir, "planner-gap-sample.jsonl"),
    plannerGaps.map((candidate) => ({
      messages: [...candidate.messages, candidate.target],
      metadata: {
        id: candidate.id,
        sessionId: candidate.sessionId,
        turnNumber: candidate.turnNumber,
        classification: "planner-tier executor; not planner training data",
        warnings: candidate.warnings,
      },
    })),
  );
  writeFileSync(
    join(input.outputDir, "audit.json"),
    `${JSON.stringify({ counters, reviewedSampleSize: sample.length }, null, 2)}\n`,
  );
  console.log(`Training-data audit written to ${input.outputDir}`);
  console.log(
    `${counters.uniqueCandidates} distinct candidates; ${sample.length} executor examples awaiting review`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runAudit(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
