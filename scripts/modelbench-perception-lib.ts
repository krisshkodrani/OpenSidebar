import { existsSync } from "node:fs";
import type {
  BenchmarkAttemptV1,
  JsonObject,
  PerceptionBenchmarkCaseV1,
  PerceptionBenchmarkResultV1,
  PerceptionCaptureCheckV1,
  PerceptionCaptureResultV1,
  PerceptionDirectModelResultV1,
  PerceptionImageArtifactV1,
} from "@opensidebar/scenario-contracts";
import {
  classifyPerceptionResult,
  integratedPerceptionResult,
} from "@opensidebar/scenario-engine";
import { inspectPerceptionImage } from "./modelbench-image-artifacts.js";

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function imageArtifacts(
  attempt: BenchmarkAttemptV1,
): PerceptionImageArtifactV1[] {
  const values = object(attempt.diagnostics).imageArtifacts;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is PerceptionImageArtifactV1 => {
    const candidate = object(value);
    return (
      candidate.schemaVersion === 1 &&
      typeof candidate.path === "string" &&
      typeof candidate.sha256 === "string"
    );
  });
}

function imageDetailRank(detail: PerceptionImageArtifactV1["detail"]): number {
  if (detail === "high") return 3;
  if (detail === "auto") return 2;
  if (detail === "low") return 1;
  return 0;
}

function bestImageArtifact(
  artifacts: readonly PerceptionImageArtifactV1[],
): PerceptionImageArtifactV1 | null {
  return artifacts.reduce<PerceptionImageArtifactV1 | null>((best, candidate) => {
    if (!best) return candidate;
    return imageDetailRank(candidate.detail) >= imageDetailRank(best.detail)
      ? candidate
      : best;
  }, null);
}

function check(
  checks: PerceptionCaptureCheckV1[],
  id: string,
  passed: boolean,
  detail: string,
): void {
  checks.push({ id, passed, detail });
}

export function captureIntegrityForAttempt(
  attempt: BenchmarkAttemptV1,
): PerceptionCaptureResultV1 {
  const diagnostics = object(attempt.diagnostics);
  const artifacts = imageArtifacts(attempt);
  const candidate = bestImageArtifact(artifacts);
  const checks: PerceptionCaptureCheckV1[] = [];
  const pageUrls = Array.isArray(diagnostics.pageUrls)
    ? diagnostics.pageUrls.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  check(
    checks,
    "target-page",
    pageUrls.some((url) => url.includes("scenario-target")),
    pageUrls.length ? pageUrls.join(", ") : "No page URL was recorded.",
  );
  check(
    checks,
    "visual-surface",
    diagnostics.canvasObserved === true,
    diagnostics.canvasObserved === true
      ? "A canvas visual surface was observed in the executor snapshot."
      : "No canvas visual surface was observed.",
  );
  check(
    checks,
    "screenshot-recorded",
    candidate !== null,
    candidate?.path ?? "No screenshot artifact was recorded.",
  );
  let image: PerceptionImageArtifactV1 | null = null;
  if (candidate && existsSync(candidate.path)) {
    try {
      image = inspectPerceptionImage({
        path: candidate.path,
        detail: candidate.detail,
        turnNumber: candidate.turnNumber,
        screenshotStatus: candidate.screenshotStatus,
      });
      check(
        checks,
        "screenshot-hash",
        image.sha256 === candidate.sha256,
        image.sha256 === candidate.sha256
          ? image.sha256
          : `Recorded ${candidate.sha256}; current ${image.sha256}.`,
      );
      const withinProfile =
        image.width <= 1280 && Math.max(image.width, image.height) <= 1568;
      check(
        checks,
        "production-profile",
        withinProfile,
        `${image.width}x${image.height} ${image.mimeType}, ${image.byteLength} bytes.`,
      );
    } catch (error) {
      check(
        checks,
        "screenshot-decodes",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else if (candidate) {
    check(checks, "screenshot-file", false, `Missing ${candidate.path}.`);
  }
  const imagePrompts = attempt.telemetry?.imagePrompts ?? 0;
  check(
    checks,
    "executor-delivery",
    imagePrompts > 0,
    `${imagePrompts} image prompt attachment(s) recorded.`,
  );
  check(
    checks,
    "detail-recorded",
    image?.detail !== undefined && image.detail !== "unknown",
    image ? `detail=${image.detail}` : "No image detail was available.",
  );
  return {
    passed: checks.every((item) => item.passed),
    checks,
    image,
  };
}

export function buildPerceptionResult(input: {
  case: PerceptionBenchmarkCaseV1;
  attempt: BenchmarkAttemptV1;
  capture: PerceptionCaptureResultV1;
  direct: PerceptionDirectModelResultV1 | null;
}): PerceptionBenchmarkResultV1 {
  const base = {
    schemaVersion: 1 as const,
    benchmark: "modelbench-perception" as const,
    case: input.case,
    capture: input.capture,
    direct: input.direct,
    integrated: integratedPerceptionResult(input.attempt),
    diagnostics: {
      configurationLabel: input.attempt.configurationLabel ?? "unlabelled",
      artifactRefs: [...input.attempt.artifactRefs],
    },
  };
  return { ...base, diagnosis: classifyPerceptionResult(base) };
}
