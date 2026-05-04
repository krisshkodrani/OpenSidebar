import { ToolName } from "../../types";

type SnapshotElementLike = {
  tag?: number | string | null;
  text?: string | null;
  role?: string | null;
  tagName?: string | null;
  attributes?: Record<string, unknown> | null;
};

type SnapshotLike = {
  visibleContent?: string | null;
  pageContent?: string | null;
  elements?: SnapshotElementLike[];
};

export type AmbiguousChoiceGuardInput = {
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot?: SnapshotLike | null;
  originalQuery: string;
  activeObjective?: string | null;
};

export type AmbiguousChoiceGuardDecision = {
  blockReason: string | null;
  targetLabel: string;
  choiceKind: string;
};

const OPTION_ACTION_PATTERN =
  /\b(?:open|select|choose|pick|use|switch to|continue (?:with|to)|go to)\b/i;
const EXPLICIT_PAGE_DEFERRAL_PATTERN =
  /\b(?:correct|right|appropriate|intended|which)\s+(?:workspace|account|project|environment|tenant|record|option|item|choice)\b[\s\S]{0,120}\b(?:not specified|unspecified|unknown|unclear|ambiguous|not provided)\b/i;
const ASK_USER_BEFORE_ACTION_PATTERN =
  /\b(?:ask|confirm with|check with)\s+(?:the\s+)?user\b[\s\S]{0,160}\b(?:before|prior to)\s+(?:clicking|opening|selecting|choosing|continuing)\b/i;
const USER_SHOULD_USE_PATTERN =
  /\b(?:i|we)\s+should\s+(?:use|open|select|choose|pick)\b|\b(?:for|to)\s+this\s+(?:project|task|work|request)\b/i;

export function assessAmbiguousChoiceClickGuard(
  input: AmbiguousChoiceGuardInput,
): AmbiguousChoiceGuardDecision {
  if (input.toolName !== ToolName.CLICK_ELEMENT || input.args.id == null) {
    return { blockReason: null, targetLabel: "", choiceKind: "choice" };
  }

  const targetId = Number(input.args.id);
  const target = Number.isFinite(targetId)
    ? input.snapshot?.elements?.find(
        (element) => Number(element.tag) === targetId,
      )
    : null;
  const targetLabel = getElementLabel(target);
  const pageText = compactText(
    `${input.snapshot?.visibleContent || ""}\n${input.snapshot?.pageContent || ""}`,
  );
  const taskText = compactText(
    `${input.originalQuery || ""}\n${input.activeObjective || ""}`,
  );

  if (!targetLabel || !OPTION_ACTION_PATTERN.test(targetLabel)) {
    return { blockReason: null, targetLabel, choiceKind: "choice" };
  }

  if (
    !EXPLICIT_PAGE_DEFERRAL_PATTERN.test(pageText) &&
    !ASK_USER_BEFORE_ACTION_PATTERN.test(pageText)
  ) {
    return { blockReason: null, targetLabel, choiceKind: "choice" };
  }

  const choiceKind = inferChoiceKind(`${pageText}\n${targetLabel}\n${taskText}`);
  if (taskNamesTargetChoice(taskText, targetLabel, choiceKind)) {
    return { blockReason: null, targetLabel, choiceKind };
  }

  if (!USER_SHOULD_USE_PATTERN.test(taskText) && !/which\b/i.test(taskText)) {
    return { blockReason: null, targetLabel, choiceKind };
  }

  return {
    targetLabel,
    choiceKind,
    blockReason:
      `Ambiguous choice blocked: the page says the correct ${choiceKind} is not specified and asks for user confirmation before choosing. ` +
      `Do not click "${targetLabel}". Ask the user which ${choiceKind} to use, or finish with a clarification-needed summary instead of guessing.`,
  };
}

function getElementLabel(element?: SnapshotElementLike | null): string {
  if (!element) return "";
  const attributes = element.attributes ?? {};
  return compactText(
    [
      element.text,
      attributes["aria-label"],
      attributes.title,
      attributes.value,
      attributes.name,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferChoiceKind(corpus: string): string {
  const match = corpus.match(
    /\b(workspace|account|project|environment|tenant|record|option|item|choice)\b/i,
  );
  return match?.[1].toLowerCase() ?? "choice";
}

function taskNamesTargetChoice(
  taskText: string,
  targetLabel: string,
  choiceKind: string,
): boolean {
  const normalizedTask = taskText.toLowerCase();
  const normalizedLabel = targetLabel.toLowerCase();
  const withoutAction = normalizedLabel
    .replace(OPTION_ACTION_PATTERN, "")
    .replace(/\b(the|this|that)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = withoutAction
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && token !== choiceKind);
  return tokens.some((token) => normalizedTask.includes(token));
}
