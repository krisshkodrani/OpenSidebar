export const RFC_DECISION_STATUSES = [
  "Approved",
  "Approved with edits",
  "Rejected",
  "Parked",
  "Needs more research",
] as const;

export const RFC_NEXT_ACTIONS = [
  "Implement",
  "Revise RFC",
  "Run spike",
  "Archive",
] as const;

export type RfcDecisionStatus = (typeof RFC_DECISION_STATUSES)[number];
export type RfcNextAction = (typeof RFC_NEXT_ACTIONS)[number];

export interface RfcDecisionStamp {
  status: RfcDecisionStatus;
  chosenPath: string[];
  requiredEdits: string[];
  nonBlockingFollowUps: string[];
  doNotDo: string[];
  evidenceRequired: string[];
  nextAction: RfcNextAction;
}

export interface RfcDecisionValidation {
  errors: string[];
  stamp?: RfcDecisionStamp;
}

interface DecisionField {
  key:
    | "chosenPath"
    | "requiredEdits"
    | "nonBlockingFollowUps"
    | "doNotDo"
    | "evidenceRequired"
    | "nextAction";
  label: string;
}

const DECISION_FIELDS: DecisionField[] = [
  { key: "chosenPath", label: "Chosen path:" },
  {
    key: "requiredEdits",
    label: "Required edits before implementation:",
  },
  { key: "nonBlockingFollowUps", label: "Non-blocking follow-ups:" },
  { key: "doNotDo", label: "Do not do:" },
  { key: "evidenceRequired", label: "Evidence required before merge:" },
  { key: "nextAction", label: "Next action:" },
];

const PLACEHOLDERS = new Set([
  "...",
  "n/a",
  "pending",
  "tbd",
  "to be decided",
  "todo",
  "unknown",
]);

function normalizedValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^\.+$/.test(trimmed)) return "...";
  return trimmed.replace(/[.;]$/, "");
}

function isNone(items: string[]): boolean {
  return items.length === 1 && normalizedValue(items[0]) === "none";
}

function readBulletItems(
  lines: string[],
  start: number,
  end: number,
  label: string,
  errors: string[],
): string[] {
  const contentLines = lines
    .slice(start, end)
    .filter((line) => line.trim().length > 0);
  const items: string[] = [];

  for (const line of contentLines) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) {
      items.push(match[1].trim());
      continue;
    }

    if (/^\s{2,}\S/.test(line) && items.length > 0) {
      items[items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    errors.push(`${label} must contain only Markdown bullet items`);
  }

  const resolvedItems = items.filter((value) => {
    if (PLACEHOLDERS.has(normalizedValue(value))) {
      errors.push(`${label} contains unresolved placeholder "${value}"`);
      return false;
    }
    return true;
  });

  if (resolvedItems.length === 0) {
    errors.push(`${label} must contain at least one bullet item`);
  }

  return resolvedItems;
}

function removeFencedCode(lines: string[]): string[] {
  let fence: { marker: string; length: number } | null = null;

  return lines.map((line) => {
    const trimmed = line.trim();
    if (!fence) {
      const opening = trimmed.match(/^(`{3,}|~{3,})/);
      if (!opening) return line;
      fence = {
        marker: opening[1][0],
        length: opening[1].length,
      };
      return "";
    }

    const closingPattern = new RegExp(
      `^${fence.marker}{${fence.length},}\\s*$`,
    );
    if (closingPattern.test(trimmed)) {
      fence = null;
    }
    return "";
  });
}

export function validateRfcDecisionMarkdown(
  markdown: string,
): RfcDecisionValidation {
  const errors: string[] = [];
  const lines = removeFencedCode(markdown.replace(/\r\n?/g, "\n").split("\n"));
  const decisionHeadings = lines
    .map((line, index) =>
      /^##\s+Decision\s*$/i.test(line.trim()) ? index : -1,
    )
    .filter((index) => index >= 0);

  if (decisionHeadings.length === 0) {
    return { errors: ['Missing required "## Decision" section'] };
  }
  if (decisionHeadings.length > 1) {
    return { errors: ['RFC must contain exactly one "## Decision" section'] };
  }

  const decisionStart = decisionHeadings[0];
  const nextHeadingOffset = lines
    .slice(decisionStart + 1)
    .findIndex((line) => /^##\s+/.test(line.trim()));
  const decisionEnd =
    nextHeadingOffset === -1
      ? lines.length
      : decisionStart + 1 + nextHeadingOffset;
  const block = lines.slice(decisionStart + 1, decisionEnd);

  const statusLines = block
    .map((line, index) => {
      const match = line.match(/^Status:\s*(.+?)\s*$/i);
      return match ? { index, value: match[1].trim() } : null;
    })
    .filter(
      (entry): entry is { index: number; value: string } => entry !== null,
    );

  if (statusLines.length !== 1) {
    errors.push("Decision Stamp must contain exactly one Status line");
  }

  const statusValue = statusLines[0]?.value;
  const status = RFC_DECISION_STATUSES.find(
    (allowed) => allowed.toLowerCase() === statusValue?.toLowerCase(),
  );
  if (statusValue && !status) {
    errors.push(`Status must be one of: ${RFC_DECISION_STATUSES.join(", ")}`);
  }

  const fieldIndexes = DECISION_FIELDS.map((field) => ({
    ...field,
    indexes: block
      .map((line, index) =>
        line.trim().toLowerCase() === field.label.toLowerCase() ? index : -1,
      )
      .filter((index) => index >= 0),
  }));

  for (const field of fieldIndexes) {
    if (field.indexes.length !== 1) {
      errors.push(`Decision Stamp must contain exactly one "${field.label}"`);
    }
  }

  const presentFields = fieldIndexes.filter(
    (field) => field.indexes.length === 1,
  );
  if (
    statusLines.length === 1 &&
    presentFields.length > 0 &&
    statusLines[0].index > presentFields[0].indexes[0]
  ) {
    errors.push("Status must appear before the Decision Stamp fields");
  }
  for (let index = 1; index < presentFields.length; index += 1) {
    if (presentFields[index].indexes[0] < presentFields[index - 1].indexes[0]) {
      errors.push("Decision Stamp fields must use the canonical order");
      break;
    }
  }

  const values = new Map<DecisionField["key"], string[]>();
  for (let index = 0; index < fieldIndexes.length; index += 1) {
    const field = fieldIndexes[index];
    if (field.indexes.length !== 1) continue;

    const start = field.indexes[0] + 1;
    const laterIndexes = fieldIndexes
      .slice(index + 1)
      .flatMap((candidate) => candidate.indexes)
      .filter((candidateIndex) => candidateIndex > field.indexes[0]);
    const end =
      laterIndexes.length > 0 ? Math.min(...laterIndexes) : block.length;
    values.set(
      field.key,
      readBulletItems(block, start, end, field.label, errors),
    );
  }

  const chosenPath = values.get("chosenPath") ?? [];
  const requiredEdits = values.get("requiredEdits") ?? [];
  const nonBlockingFollowUps = values.get("nonBlockingFollowUps") ?? [];
  const doNotDo = values.get("doNotDo") ?? [];
  const evidenceRequired = values.get("evidenceRequired") ?? [];
  const nextActions = values.get("nextAction") ?? [];

  if (chosenPath.length > 0 && isNone(chosenPath)) {
    errors.push("Chosen path must record an explicit authoritative direction");
  }
  if (status === "Approved" && !isNone(requiredEdits)) {
    errors.push(
      'Use "Approved with edits" when required edits block implementation',
    );
  }
  if (status === "Approved with edits" && isNone(requiredEdits)) {
    errors.push(
      '"Approved with edits" requires at least one blocking RFC edit',
    );
  }
  if (
    (status === "Approved" || status === "Approved with edits") &&
    evidenceRequired.length > 0 &&
    isNone(evidenceRequired)
  ) {
    errors.push("Approved RFCs must define evidence required before merge");
  }

  let nextAction: RfcNextAction | undefined;
  if (nextActions.length === 1) {
    nextAction = RFC_NEXT_ACTIONS.find(
      (allowed) =>
        allowed.toLowerCase() === normalizedValue(nextActions[0]).toLowerCase(),
    );
    if (!nextAction) {
      errors.push(`Next action must be one of: ${RFC_NEXT_ACTIONS.join(", ")}`);
    }
  } else if (nextActions.length > 1) {
    errors.push("Next action must contain exactly one bullet item");
  }

  if (
    status &&
    nextAction &&
    ((status === "Approved" &&
      nextAction !== "Implement" &&
      nextAction !== "Archive") ||
      (status === "Approved with edits" &&
        nextAction !== "Revise RFC" &&
        nextAction !== "Implement") ||
      (status === "Rejected" && nextAction !== "Archive") ||
      (status === "Parked" && nextAction !== "Archive") ||
      (status === "Needs more research" &&
        nextAction !== "Run spike" &&
        nextAction !== "Revise RFC"))
  ) {
    errors.push(`Next action "${nextAction}" is inconsistent with "${status}"`);
  }

  if (!status || !nextAction || errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    stamp: {
      status,
      chosenPath,
      requiredEdits,
      nonBlockingFollowUps,
      doNotDo,
      evidenceRequired,
      nextAction,
    },
  };
}
