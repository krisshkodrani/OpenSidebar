import { renderPrompt } from "../../prompts";
import { buildElementSummary } from "./perception";
import type { ObserveInput } from "./types";

export interface BuildProductionPerceptionPromptOptions {
  priorObservations?: string;
  isFirstObservation?: boolean;
}

/**
 * Shared v6 prompt builder used by both production perception and eval replay.
 * This keeps prompt construction on a single code path.
 */
export function buildProductionPerceptionPrompt(
  input: ObserveInput,
  options: BuildProductionPerceptionPromptOptions = {},
): string {
  const scrollPct =
    input.scroll.maxY > 0
      ? Math.round((input.scroll.y / input.scroll.maxY) * 100)
      : 0;
  const moreBelow = input.scroll.y < input.scroll.maxY - 10;
  const viewport = input.scroll.viewportHeight
    ? { height: input.scroll.viewportHeight, scrollY: input.scroll.y }
    : undefined;
  const elementSummary = buildElementSummary(
    input.elements,
    input.skeleton,
    viewport,
  );

  let panoramicNote = "";
  if (input.panoramicScreenshots?.length) {
    const imageLabels = input.panoramicScreenshots
      .map(
        (shot, index) =>
          `Image ${index + 2}: ${shot.label} view at scroll Y=${shot.scrollY}.`,
      )
      .join("\n");
    panoramicNote = [
      "",
      "NOTE: Multiple screenshots are provided showing different scroll positions.",
      `Image 1: current viewport at scroll Y=${input.scroll.y}.`,
      imageLabels,
      'Report CHANGES and AFFORDANCES covering the full page structure visible across all images. Reference specific images when noting spatial positions (e.g., "logo visible in Image 2 (top)").',
    ].join("\n");
  }

  const changesHint = options.isFirstObservation
    ? "\n(First observation — describe the current page layout and state instead of changes.)"
    : "";

  const langNote = input.lang
    ? `Page language: ${input.lang}. Element text and labels are in ${input.lang}. Match [tagId] by checking the element list, not by guessing from the screenshot.\n`
    : "";

  return renderPrompt("perception.interpret_page", {
    priorObservations: options.priorObservations ?? "",
    title: input.title || "Unknown",
    url: input.url || "Unknown",
    langNote,
    scrollPosition: `${input.scroll.y}/${input.scroll.maxY}px (${scrollPct}%)${moreBelow ? " — more content below" : ""}`,
    elementSummary,
    panoramicNote,
    changesHint,
  });
}
