#!/usr/bin/env tsx

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, any>;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const UI_DIR = join(ROOT, "apps", "training-data-review");
const DATA_DIR = join(ROOT, ".artifacts", "training-data-audit");
const SAMPLE_PATH = join(DATA_DIR, "executor-review-queue.jsonl");
const AUDIT_PATH = join(DATA_DIR, "audit.json");
const REVIEWS_PATH = join(DATA_DIR, "reviews.json");
const DEFAULT_PORT = 4317;

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export type ReviewDecision = {
  status: "approved" | "needs_work" | "rejected" | "unreviewed";
  note: string;
  updatedAt: string;
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readJson(path: string, fallback: unknown): any {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readSamples(): JsonRecord[] {
  if (!existsSync(SAMPLE_PATH)) return [];
  return readFileSync(SAMPLE_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRecord];
      } catch {
        return [];
      }
    });
}

function readReviews(): Record<string, ReviewDecision> {
  return readJson(REVIEWS_PATH, {});
}

function writeReviews(reviews: Record<string, ReviewDecision>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REVIEWS_PATH, `${JSON.stringify(reviews, null, 2)}\n`);
}

async function requestBody(request: IncomingMessage): Promise<JsonRecord> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64_000) throw new Error("Request body is too large");
  }
  return body ? (JSON.parse(body) as JsonRecord) : {};
}

function summarizeSample(
  sample: JsonRecord,
  review?: ReviewDecision,
): JsonRecord {
  const messages = Array.isArray(sample.messages) ? sample.messages : [];
  const target = messages.at(-1) ?? {};
  const toolCalls = Array.isArray(target.tool_calls) ? target.tool_calls : [];
  const metadata = sample.metadata ?? {};
  const firstUser = messages.find(
    (message: JsonRecord) => message.role === "user",
  );
  return {
    id: metadata.id,
    domain: metadata.domain ?? "unknown",
    turnNumber: metadata.turnNumber ?? 0,
    sourceModel: metadata.sourceModel ?? "unknown",
    promptTokens: metadata.recordedPromptTokens ?? 0,
    completionTokens: metadata.recordedCompletionTokens ?? 0,
    messageCount: messages.length,
    toolNames: toolCalls
      .map((call: JsonRecord) => call.function?.name)
      .filter(Boolean),
    task:
      typeof firstUser?.content === "string"
        ? firstUser.content.slice(0, 220)
        : "",
    review: review ?? { status: "unreviewed", note: "", updatedAt: "" },
  };
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\\|\/|$))+/, "");
  const path = join(UI_DIR, safe);
  if (!path.startsWith(UI_DIR) || !existsSync(path)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(path)] ?? "application/octet-stream",
  });
  response.end(readFileSync(path));
}

export function createReviewServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/audit") {
        const audit = readJson(AUDIT_PATH, {
          counters: {},
          reviewedSampleSize: 0,
        });
        const reviews = Object.values(readReviews());
        json(response, 200, {
          ...audit,
          reviewCounts: {
            approved: reviews.filter((review) => review.status === "approved")
              .length,
            needs_work: reviews.filter(
              (review) => review.status === "needs_work",
            ).length,
            rejected: reviews.filter((review) => review.status === "rejected")
              .length,
          },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/samples") {
        const samples = readSamples();
        const reviews = readReviews();
        json(
          response,
          200,
          samples.map((sample) =>
            summarizeSample(sample, reviews[sample.metadata?.id]),
          ),
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/samples/")
      ) {
        const id = decodeURIComponent(
          url.pathname.slice("/api/samples/".length),
        );
        const sample = readSamples().find((item) => item.metadata?.id === id);
        if (!sample) return json(response, 404, { error: "Sample not found" });
        json(response, 200, { ...sample, review: readReviews()[id] ?? null });
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/reviews/")
      ) {
        const id = decodeURIComponent(
          url.pathname.slice("/api/reviews/".length),
        );
        const sampleExists = readSamples().some(
          (item) => item.metadata?.id === id,
        );
        if (!sampleExists)
          return json(response, 404, { error: "Sample not found" });
        const body = await requestBody(request);
        const allowed = new Set([
          "approved",
          "needs_work",
          "rejected",
          "unreviewed",
        ]);
        if (!allowed.has(body.status)) {
          return json(response, 400, { error: "Invalid review status" });
        }
        const reviews = readReviews();
        reviews[id] = {
          status: body.status,
          note: typeof body.note === "string" ? body.note.slice(0, 4000) : "",
          updatedAt: new Date().toISOString(),
        };
        writeReviews(reviews);
        json(response, 200, reviews[id]);
        return;
      }
      if (request.method !== "GET") {
        return json(response, 405, { error: "Method not allowed" });
      }
      serveStatic(url.pathname, response);
    } catch (error) {
      json(response, 500, {
        error:
          error instanceof Error ? error.message : "Unexpected server error",
      });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }
  createReviewServer().listen(port, "127.0.0.1", () => {
    console.log(`Training Data Review Studio: http://127.0.0.1:${port}`);
  });
}
