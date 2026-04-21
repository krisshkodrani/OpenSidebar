import { renderPrompt } from "../../prompts";
import { buildElementSummary } from "./perception";
import type { ObserveInput, PerceptionTaskContext } from "./types";

export interface BuildProductionPerceptionPromptOptions {
  priorObservations?: string;
  isFirstObservation?: boolean;
}

const TASK_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "then",
  "into",
  "onto",
  "your",
  "page",
  "step",
  "click",
  "select",
  "open",
  "visit",
  "check",
  "review",
  "verify",
  "continue",
  "submit",
  "button",
  "input",
  "field",
  "agent",
  "after",
  "before",
  "state",
  "current",
]);
const MIN_SHORTLIST_SIZE = 10;
const MAX_SHORTLIST_SIZE = 18;

function tokenizeTaskContext(taskContext: PerceptionTaskContext): string[] {
  const source = [
    taskContext.objective,
    taskContext.successCriteria,
    taskContext.expectedStateDescription,
    taskContext.toolProfile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [...new Set(source.match(/[a-z0-9$@._-]{3,}/g) ?? [])].filter(
    (token) => !TASK_TOKEN_STOPWORDS.has(token),
  );
}

function describeElementForMatching(
  element: ObserveInput["elements"][number],
): string {
  return [
    element.text,
    element.tagName,
    element.role,
    element.attributes.id,
    element.attributes.name,
    element.attributes.placeholder,
    element.attributes["aria-label"],
    element.attributes.label,
    element.attributes.value,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreActionability(element: ObserveInput["elements"][number]): number {
  const tagName = element.tagName.toLowerCase();
  const role = (element.role || "").toLowerCase();
  const type = (element.attributes.type || "").toLowerCase();

  let score = 0;
  if (["input", "textarea", "select"].includes(tagName)) score += 8;
  if (tagName === "button" || role === "button") score += 9;
  if (tagName === "a" || role === "link") score += 4;
  if (["submit", "button", "checkbox", "radio"].includes(type)) score += 3;
  if (element.isVisible) score += 2;
  if (!element.isDisabled) score += 1;
  return score;
}

export function selectElementsForTaskContext(
  elements: ObserveInput["elements"],
  taskContext?: PerceptionTaskContext,
): ObserveInput["elements"] {
  if (!taskContext || elements.length <= MAX_SHORTLIST_SIZE) {
    return elements;
  }

  const tokens = tokenizeTaskContext(taskContext);
  if (tokens.length === 0) {
    return elements;
  }

  const scored = elements.map((element, index) => {
    const haystack = describeElementForMatching(element);
    let taskMatches = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) taskMatches++;
    }

    return {
      element,
      index,
      taskMatches,
      score: taskMatches * 30 + scoreActionability(element),
    };
  });

  const taskRelevant = scored
    .filter((entry) => entry.taskMatches > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (taskRelevant.length < 3) {
    return elements;
  }

  const shortlistSize = Math.min(
    MAX_SHORTLIST_SIZE,
    Math.max(
      MIN_SHORTLIST_SIZE,
      Math.min(taskRelevant.length + 4, Math.ceil(elements.length * 0.4)),
    ),
  );
  const chosen = taskRelevant.slice(0, shortlistSize);
  const chosenTags = new Set(chosen.map((entry) => entry.element.tag));

  if (chosen.length < MIN_SHORTLIST_SIZE) {
    const actionableFallback = scored
      .filter((entry) => !chosenTags.has(entry.element.tag))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, MIN_SHORTLIST_SIZE - chosen.length);
    for (const entry of actionableFallback) {
      chosen.push(entry);
      chosenTags.add(entry.element.tag);
    }
  }

  return chosen.sort((a, b) => a.index - b.index).map((entry) => entry.element);
}

function buildTaskContextNote(
  taskContext: PerceptionTaskContext | undefined,
  selectedCount: number,
  totalCount: number,
): string {
  if (!taskContext) return "";

  const lines = ["Current step context:"];
  if (
    taskContext.currentStepIndex != null &&
    taskContext.totalSteps != null &&
    taskContext.totalSteps > 0
  ) {
    lines.push(
      `- Step ${taskContext.currentStepIndex + 1} of ${taskContext.totalSteps}`,
    );
  }
  lines.push(`- Objective: ${taskContext.objective}`);
  if (taskContext.successCriteria) {
    lines.push(`- Success criteria: ${taskContext.successCriteria}`);
  }
  if (taskContext.expectedStateDescription) {
    lines.push(`- Expected state: ${taskContext.expectedStateDescription}`);
  }
  if (taskContext.toolProfile) {
    lines.push(`- Tool profile: ${taskContext.toolProfile}`);
  }
  if (selectedCount < totalCount) {
    lines.push(
      `- Element slice: showing ${selectedCount} of ${totalCount} interactive elements judged most relevant to this step. Omitted elements are lower priority, not absent.`,
    );
  }
  return lines.join("\n") + "\n";
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
  const shortlistedElements = selectElementsForTaskContext(
    input.elements,
    input.taskContext,
  );
  const elementSummary = buildElementSummary(
    shortlistedElements,
    input.skeleton,
    viewport,
  );
  const taskContextNote = buildTaskContextNote(
    input.taskContext,
    shortlistedElements.length,
    input.elements.length,
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
    ? "\n(First observation - describe the current page layout and state instead of changes.)"
    : "";

  const langNote = input.lang
    ? `Page language: ${input.lang}. Element text and labels are in ${input.lang}. Match [tagId] by checking the element list, not by guessing from the screenshot.\n`
    : "";

  return renderPrompt("perception.interpret_page", {
    priorObservations: options.priorObservations ?? "",
    title: input.title || "Unknown",
    url: input.url || "Unknown",
    langNote,
    taskContextNote,
    scrollPosition: `${input.scroll.y}/${input.scroll.maxY}px (${scrollPct}%)${moreBelow ? " - more content below" : ""}`,
    elementSummary,
    panoramicNote,
    changesHint,
  });
}
