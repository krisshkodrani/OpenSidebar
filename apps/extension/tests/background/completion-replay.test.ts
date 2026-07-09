/**
 * Completion golden-replay harness (RFC LP-15, Phase 0).
 *
 * Asserts the completion corpus reproduces byte-identical kernel decisions from
 * its serialized input surface. This is the gate every later completion phase
 * (7a shadow, 7b flip) diffs against: if the pure pipeline ever disagrees with
 * a recorded decision, that phase's replay fails here.
 *
 * The corpus lives at tests/fixtures/completion-corpus/*.json. Missing fixtures
 * are bootstrapped from the seed generator on first run; to intentionally
 * regenerate after changing seeds, run with UPDATE_COMPLETION_CORPUS=1.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, test } from "vitest";
import "../setup";
import {
  COMPLETION_DECISION_RECORD_VERSION,
  replayKernelDecision,
  stableStringify,
  type CompletionDecisionRecord,
} from "../../src/background/agent/completion/decision-record";
import { runCompletionPipeline } from "../../src/background/agent/completion/pipeline";
import { evaluateGeneratedCompletionCandidate } from "../../src/background/agent/completion-evaluation-service";
import { generateSeedCorpus } from "./completion-corpus/seed";

/**
 * The shadow gate (RFC LP-15, Phase 7a): re-run the pure completion pipeline from
 * a record and return its verdict, mapped to the recorded verdict vocabulary.
 * The frozen kernel is recomputed from the input; the planner stage is stubbed
 * with the recorded legacy result (no model call).
 */
async function replayPipelineVerdict(
  record: CompletionDecisionRecord,
): Promise<"accepted" | "rejected"> {
  const { input } = record;
  const { decision } = evaluateGeneratedCompletionCandidate({
    userRequest: input.userRequest,
    snapshot: input.snapshot,
    activeObjective: input.activeObjective,
    successCriteria: input.successCriteria,
    evidence: input.evidence,
    candidateSource: input.candidateSource,
    summary: input.summary,
  });
  const pipelineDecision = await runCompletionPipeline(input.guardContext, {
    getKernelDecision: () => decision,
    deterministicAcceptanceEnabled: input.deterministicAcceptanceEnabled,
    isDuplicateTerminal: input.isDuplicateTerminal,
    validatePlan: async () => input.plannerResult,
    buildKernelRejectionEffects: () => [],
    buildPlanRejectionEffects: () => [],
  });
  return pipelineDecision.verdict === "accept" ? "accepted" : "rejected";
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, "..", "fixtures", "completion-corpus");

function fixturePath(name: string): string {
  return join(CORPUS_DIR, `${name}.json`);
}

beforeAll(() => {
  mkdirSync(CORPUS_DIR, { recursive: true });
  const update = process.env.UPDATE_COMPLETION_CORPUS === "1";
  for (const { name, record } of generateSeedCorpus()) {
    const path = fixturePath(name);
    // Bootstrap on first run / new seeds; rewrite everything on explicit update.
    if (update || !existsSync(path)) {
      writeFileSync(path, `${stableStringify(record)}\n`, "utf8");
    }
  }
});

function loadCorpus(): { file: string; record: CompletionDecisionRecord }[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      record: JSON.parse(
        readFileSync(join(CORPUS_DIR, file), "utf8"),
      ) as CompletionDecisionRecord,
    }));
}

describe("completion golden replay", () => {
  test("corpus is non-empty and every record is current-version", () => {
    const corpus = loadCorpus();
    expect(corpus.length).toBeGreaterThan(0);
    for (const { file, record } of corpus) {
      expect(
        record.recordVersion,
        `${file} has a stale recordVersion — regenerate the corpus`,
      ).toBe(COMPLETION_DECISION_RECORD_VERSION);
    }
  });

  test("every record replays to a byte-identical kernel decision", () => {
    for (const { file, record } of loadCorpus()) {
      const replayed = replayKernelDecision(record);
      expect(replayed.status, `${file}: kernel status drifted`).toBe(
        record.outcome.kernelStatus,
      );
      expect(replayed.contractKind, `${file}: contract kind drifted`).toBe(
        record.outcome.kernelContractKind,
      );
      expect(replayed.reason, `${file}: kernel reason drifted`).toBe(
        record.outcome.kernelReason,
      );
    }
  });

  test("records survive a stable serialize/parse round-trip", () => {
    for (const { file, record } of loadCorpus()) {
      const once = stableStringify(record);
      const twice = stableStringify(JSON.parse(once) as CompletionDecisionRecord);
      expect(twice, `${file}: not round-trip stable`).toBe(once);
    }
  });

  test("committed corpus matches the seed generator (no uncommitted drift)", () => {
    const onDisk = new Map(
      loadCorpus().map(({ file, record }) => [
        file.replace(/\.json$/, ""),
        stableStringify(record),
      ]),
    );
    for (const { name, record } of generateSeedCorpus()) {
      expect(onDisk.get(name), `seed "${name}" is not committed`).toBe(
        stableStringify(record),
      );
    }
  });

  test("shadow pipeline verdict matches the recorded legacy verdict (zero divergence)", async () => {
    for (const { file, record } of loadCorpus()) {
      const pipelineVerdict = await replayPipelineVerdict(record);
      expect(
        pipelineVerdict,
        `${file}: shadow completion pipeline diverged from the recorded legacy verdict`,
      ).toBe(record.outcome.verdict);
    }
  });

  test("corpus covers a spread of contract kinds and both verdicts", () => {
    const corpus = loadCorpus();
    const kinds = new Set(corpus.map((c) => c.record.outcome.kernelContractKind));
    const statuses = new Set(corpus.map((c) => c.record.outcome.kernelStatus));
    expect(kinds.size, "corpus should exercise multiple contract kinds").toBeGreaterThan(
      1,
    );
    expect(statuses.size, "corpus should exercise multiple kernel verdicts").toBeGreaterThan(
      1,
    );
  });
});
