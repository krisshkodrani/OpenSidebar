import type { DomSnapshot, PerceptionRuntimeMode, UserSettings } from "../types";

type ProviderMode = UserSettings["providerMode"];

export interface PerceptionModePageSignals {
  elementCount?: number;
  visibleTextLength?: number;
  pageTextLength?: number;
  hasCanvas?: boolean;
  hasSvg?: boolean;
  imageCount?: number;
  hasIframe?: boolean;
  framework?: string;
}

export interface PerceptionRuntimeModeDecision {
  mode: Exclude<PerceptionRuntimeMode, "auto">;
  reason: string;
  signals: string[];
}

export interface PerceptionRuntimeModeDecisionArgs
  extends PerceptionModePageSignals {
  perceptionMode?: PerceptionRuntimeMode;
  useVLExecutor?: boolean;
  providerMode?: ProviderMode;
  taskText?: string;
}

const VISUAL_TASK_PATTERN =
  /\b(image|picture|photo|screenshot|visual|visually|chart|graph|diagram|canvas|map|drawing|svg|figure|gallery|dashboard)\b/i;
const IMAGE_HEAVY_PAGE_THRESHOLD = 3;
const SPARSE_TEXT_LENGTH_THRESHOLD = 500;
const SPARSE_DOM_ELEMENT_THRESHOLD = 3;
const SPARSE_SPA_ELEMENT_THRESHOLD = 5;
const SPARSE_SPA_VISIBLE_TEXT_THRESHOLD = 300;

export function extractPerceptionPageSignals(
  snapshot?: Pick<
    DomSnapshot,
    "elements" | "visibleContent" | "pageContent" | "skeleton" | "framework"
  >,
): PerceptionModePageSignals {
  if (!snapshot) return {};

  const elements = snapshot.elements ?? [];
  const elementTags = elements.map((element) =>
    element.tagName.toLowerCase(),
  );
  const skeletonTags =
    snapshot.skeleton?.map((node) => node.tagName.toLowerCase()) ?? [];
  const tags = [...elementTags, ...skeletonTags];

  return {
    elementCount: elements.length,
    visibleTextLength: snapshot.visibleContent?.trim().length ?? 0,
    pageTextLength: snapshot.pageContent?.trim().length ?? 0,
    hasCanvas: tags.includes("canvas"),
    hasSvg: tags.includes("svg"),
    imageCount: tags.filter((tag) => tag === "img" || tag === "picture")
      .length,
    hasIframe: tags.includes("iframe"),
    framework: snapshot.framework,
  };
}

export function resolvePerceptionRuntimeModeDecision(
  args: PerceptionRuntimeModeDecisionArgs,
): PerceptionRuntimeModeDecision {
  if (args.perceptionMode === "structured") {
    return {
      mode: "structured",
      reason: "explicit_structured_override",
      signals: [],
    };
  }

  if (args.perceptionMode === "unified_vl") {
    return {
      mode: "unified_vl",
      reason: "explicit_unified_vl_override",
      signals: [],
    };
  }

  if (args.useVLExecutor === true) {
    return {
      mode: "unified_vl",
      reason: "legacy_vl_executor_enabled",
      signals: ["legacy_use_vl_executor"],
    };
  }

  const signals: string[] = [];
  const elementCount = args.elementCount ?? 0;
  const visibleTextLength = args.visibleTextLength ?? 0;
  const pageTextLength = args.pageTextLength ?? visibleTextLength;

  if (VISUAL_TASK_PATTERN.test(args.taskText ?? "")) {
    signals.push("visual_task_text");
  }
  if (args.hasCanvas) signals.push("canvas_present");
  if (args.hasSvg) signals.push("svg_present");
  if ((args.imageCount ?? 0) >= IMAGE_HEAVY_PAGE_THRESHOLD) {
    signals.push("image_heavy_page");
  }
  if (args.hasIframe && pageTextLength < SPARSE_TEXT_LENGTH_THRESHOLD) {
    signals.push("iframe_with_sparse_text");
  }
  if (
    elementCount <= SPARSE_DOM_ELEMENT_THRESHOLD &&
    pageTextLength < SPARSE_TEXT_LENGTH_THRESHOLD
  ) {
    signals.push("sparse_dom");
  }
  if (
    args.framework &&
    args.framework !== "unknown" &&
    elementCount <= SPARSE_SPA_ELEMENT_THRESHOLD &&
    visibleTextLength < SPARSE_SPA_VISIBLE_TEXT_THRESHOLD
  ) {
    signals.push("sparse_spa_dom");
  }

  return {
    mode: "unified_vl",
    reason: signals[0] ?? "auto_default_unified_vl",
    signals,
  };
}

export function resolvePerceptionRuntimeMode(
  args: PerceptionRuntimeModeDecisionArgs,
): Exclude<PerceptionRuntimeMode, "auto"> {
  return resolvePerceptionRuntimeModeDecision(args).mode;
}
