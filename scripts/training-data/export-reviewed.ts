#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactTracePayload } from "../../apps/extension/src/utils/trace-protection.js";

type Json = Record<string, unknown>;
type Split = "train" | "validation" | "test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AUDIT_DIR = join(ROOT, ".artifacts", "training-data-audit");
const OUTPUT_DIR = join(ROOT, ".artifacts", "training-data-dataset");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitForSession(sessionId: string): Split {
  const bucket = Number.parseInt(hash(sessionId).slice(0, 8), 16) % 10;
  return bucket === 0 ? "validation" : bucket === 1 ? "test" : "train";
}

function validMessages(messages: unknown): messages is Json[] {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  if (!messages.every((message) => message && typeof message === "object")) {
    return false;
  }
  const target = messages.at(-1) as Json;
  if (target.role !== "assistant") return false;
  const calls = target.tool_calls;
  if (calls !== undefined) {
    if (!Array.isArray(calls)) return false;
    for (const call of calls) {
      const fn = call?.function;
      if (typeof fn?.name !== "string" || typeof fn.arguments !== "string") {
        return false;
      }
      try {
        JSON.parse(fn.arguments);
      } catch {
        return false;
      }
    }
  }
  return true;
}

export function prepareReviewedDataset(
  samples: Json[],
  reviews: Record<string, { status?: string }>,
): { rows: Record<Split, Json[]>; rejected: Record<string, number> } {
  const rows: Record<Split, Json[]> = {
    train: [],
    validation: [],
    test: [],
  };
  const rejected: Record<string, number> = {};
  const seen = new Set<string>();
  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  for (const sample of [...samples].sort((a, b) =>
    String((a.metadata as Json | undefined)?.id ?? "").localeCompare(
      String((b.metadata as Json | undefined)?.id ?? ""),
    ),
  )) {
    const metadata = sample.metadata as Json | undefined;
    const id = metadata?.id;
    const sessionId = metadata?.sessionId;
    if (typeof id !== "string" || typeof sessionId !== "string") {
      reject("missing_provenance");
      continue;
    }
    if (reviews[id]?.status !== "approved") {
      reject("not_approved");
      continue;
    }
    if (
      typeof metadata?.sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(metadata.sourceHash) ||
      typeof metadata.schemaVersion !== "string"
    ) {
      reject("missing_source_hash_or_schema");
      continue;
    }
    if (
      metadata.toolExecutionsSuccessful !== true ||
      !["completed", "success"].includes(String(metadata.outcome))
    ) {
      reject("outcome_or_tool_failure");
      continue;
    }
    if (!validMessages(sample.messages)) {
      reject("invalid_messages");
      continue;
    }
    const messages = sample.messages;
    const content = JSON.stringify(messages);
    if (
      /servicenow|service-now|workarena/i.test(
        `${String(metadata.domain ?? "")} ${content}`,
      )
    ) {
      reject("removed_servicenow_workflow");
      continue;
    }
    if (/\[image\]|\[REDACTED_IMAGE_DATA_URL\]|data:image\//i.test(content)) {
      reject("missing_image_input");
      continue;
    }
    const sanitized = redactTracePayload(messages, { mode: "export" });
    if (JSON.stringify(sanitized) !== content) {
      reject("changed_since_review");
      continue;
    }
    const contentHash = hash(content);
    if (seen.has(contentHash)) {
      reject("duplicate_conversation");
      continue;
    }
    seen.add(contentHash);
    const split = splitForSession(sessionId);
    rows[split].push({
      messages,
      metadata: {
        id,
        role: "executor",
        sourceHash: metadata.sourceHash,
        sourceSchemaVersion: metadata.schemaVersion,
        sourceSessionHash: hash(sessionId),
        domain: metadata.domain,
        reviewStatus: "approved",
      },
    });
  }
  return { rows, rejected };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const queuePath = join(AUDIT_DIR, "executor-review-queue.jsonl");
  const reviewsPath = join(AUDIT_DIR, "reviews.json");
  if (!existsSync(queuePath) || !existsSync(reviewsPath)) {
    throw new Error("Run training-data:audit and review examples before export.");
  }
  const samples = readFileSync(queuePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
  const reviews = readJson(reviewsPath) as Record<string, { status?: string }>;
  const { rows, rejected } = prepareReviewedDataset(samples, reviews);
  if (
    rows.train.length === 0 ||
    rows.validation.length === 0 ||
    rows.test.length === 0
  ) {
    throw new Error(
      "More approved examples across distinct sessions are needed for train, validation, and test splits.",
    );
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const split of ["train", "validation", "test"] as const) {
    writeFileSync(
      join(OUTPUT_DIR, `${split}.jsonl`),
      rows[split].map((row) => JSON.stringify(row)).join("\n") +
        (rows[split].length ? "\n" : ""),
    );
  }
  const sourceHashes = Object.values(rows)
    .flat()
    .map((row) => String((row.metadata as Json).sourceHash))
    .sort();
  const manifest = {
    schemaVersion: 1,
    use: "local_only",
    role: "executor",
    sourceDigest: hash(sourceHashes.join("\n")),
    counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
    rejected,
  };
  writeFileSync(
    join(OUTPUT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`[training-data] local reviewed export: ${JSON.stringify(manifest)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
