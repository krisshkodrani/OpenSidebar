/**
 * Bluebox/Dynatrace OpenTelemetry bootstrap for the repo's Node-side services
 * (the e2e harness and the browser MCP host).
 *
 * Default-off and env-gated: without `OTEL_EXPORTER_OTLP_ENDPOINT` this whole
 * module is a no-op — `startOtel()` returns false, every `@opentelemetry/api`
 * call in instrumented code hits the built-in no-op implementations, and the
 * heavy SDK packages are never even imported (they load lazily inside
 * `startOtel`). Nobody's test run changes unless they opt in.
 *
 * Config contract: the repo-root `.env.otel.bluebox-template` (written by
 * `bluebox setup`) is canonical. Copy it to `.env.otel` (git-ignored), fill in
 * the endpoint and — from your secret store, never committed — the
 * `OTEL_EXPORTER_OTLP_HEADERS` token line. This module reads `.env.otel` at
 * startup and only fills env vars that are not already set, so real
 * environment variables always win.
 *
 * Bluebox ingest rules honored here (do not change casually):
 *   - http/protobuf only — never gRPC/4317 (`OTEL_EXPORTER_OTLP_PROTOCOL`).
 *   - metrics must use DELTA temporality — cumulative is rejected with a
 *     silent partial-success, so the default is forced below.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  context,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

type OtelSdkLike = { shutdown(): Promise<void> };

let sdk: OtelSdkLike | null = null;
let started = false;

/** Parse repo-root `.env.otel` (KEY=VALUE, # comments, optional quotes). */
function loadEnvOtelFile(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(REPO_ROOT, ".env.otel"), "utf8");
  } catch {
    return; // No local config — env vars may still be set by the shell/CI.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) && value) process.env[key] = value;
  }
}

function gitValue(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

/** ssh/`.git` remote forms → canonical `https://host/owner/repo`. */
function normalizeRepoUrl(remote: string): string | null {
  let url = remote.trim();
  const sshMatch = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(url);
  if (sshMatch) url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  if (!/^https?:\/\//.test(url)) return null;
  url = url.replace(/^(https?:\/\/)[^@/]+@/, "$1"); // strip userinfo
  url = url.replace(/\.git$/, "").replace(/\/+$/, "");
  return url;
}

/**
 * Merge our defaults into OTEL_RESOURCE_ATTRIBUTES without overriding any
 * key the caller already set.
 */
function buildResourceAttributes(): void {
  const existing = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
  const has = (key: string) => existing.includes(`${key}=`);
  const parts: string[] = existing ? [existing] : [];

  if (!has("service.namespace")) parts.push("service.namespace=opensidebar");
  if (!has("deployment.environment")) {
    parts.push("deployment.environment=local-dev");
  }
  // VCS identity: local runs have .git; guarded so a tarball build just omits.
  if (!has("vcs.repository.url.full")) {
    const remote = gitValue("git remote get-url origin");
    const url = remote ? normalizeRepoUrl(remote) : null;
    if (url) parts.push(`vcs.repository.url.full=${url}`);
  }
  if (!has("vcs.ref.head.revision")) {
    const sha = gitValue("git rev-parse HEAD");
    if (sha) parts.push(`vcs.ref.head.revision=${sha}`);
  }

  const merged = parts.filter(Boolean).join(",");
  if (merged) process.env.OTEL_RESOURCE_ATTRIBUTES = merged;
}

/**
 * Start the OTel SDK for this process if Bluebox export is configured.
 * Returns false (and stays a no-op) when it is not.
 */
export async function startOtel(serviceName: string): Promise<boolean> {
  if (started) return true;
  loadEnvOtelFile();
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;

  if (!process.env.OTEL_SERVICE_NAME) {
    process.env.OTEL_SERVICE_NAME = serviceName;
  }
  // Bluebox contract: http/protobuf transport, delta metrics.
  if (!process.env.OTEL_EXPORTER_OTLP_PROTOCOL) {
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  }
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = "delta";
  }
  buildResourceAttributes();

  // Heavy imports only on the opted-in path. The metric-reader and
  // log-processor classes come via sdk-node's official re-exports so we do
  // not depend on transitive packages directly.
  const [sdkNode, { OTLPTraceExporter }, { OTLPMetricExporter }, { OTLPLogExporter }] =
    await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-proto"),
      import("@opentelemetry/exporter-metrics-otlp-proto"),
      import("@opentelemetry/exporter-logs-otlp-proto"),
    ]);

  const nodeSdk = new sdkNode.NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new sdkNode.metrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10_000,
    }),
    logRecordProcessors: [
      // 0.2xx API: options object, not a positional exporter.
      new sdkNode.logs.BatchLogRecordProcessor({
        exporter: new OTLPLogExporter(),
      }),
    ],
  });
  nodeSdk.start();
  sdk = nodeSdk;
  started = true;
  return true;
}

/** Flush and stop. Safe to call when never started. */
export async function shutdownOtel(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = null;
  started = false;
  try {
    await current.shutdown();
  } catch {
    // Flush failures must never fail a test run or the MCP host shutdown.
  }
}

export function otelStarted(): boolean {
  return started;
}

/** W3C traceparent for handing a span across a process boundary (env var). */
export function traceparentFor(span: Span): string {
  const ctx = span.spanContext();
  return `00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags.toString(16)}`;
}

/** Context carrying the remote parent from `TRACEPARENT`, if present/valid. */
export function contextFromTraceparentEnv(): Context {
  const header = process.env.TRACEPARENT;
  const match = header
    ? /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim())
    : null;
  if (!match) return context.active();
  return trace.setSpanContext(context.active(), {
    traceId: match[1],
    spanId: match[2],
    traceFlags: parseInt(match[3], 16),
    isRemote: true,
  });
}
