import type { LLMMessage } from "../llm/types";
import type { TaggedElement } from "../../types";

type ProfileRecord = Record<string, unknown>;

export interface ProfileRecordSet {
  path: string;
  records: ProfileRecord[];
}

export interface ProfileLiteralTextRewriteInput {
  selectedSkillId: string | null;
  messages: LLMMessage[];
  recordSets?: ProfileRecordSet[];
  element: TaggedElement | undefined | null;
  text: string;
}

export interface ProfileLiteralTextRewrite {
  rewrittenText: string;
  reason: string;
}

const EXACT_PROFILE_LITERAL_SKILLS = new Set(["progressive-repeatable-form"]);

const FIELD_KEY_CANDIDATES: Array<{
  pattern: RegExp;
  keys: string[];
}> = [
  {
    pattern: /\b(?:company|employer|organization|organisation)\b/i,
    keys: ["company", "employer", "organization", "organisation"],
  },
  {
    pattern: /\b(?:job\s*title|title|position)\b/i,
    keys: ["title", "job_title", "jobTitle", "position", "role"],
  },
  {
    pattern: /\b(?:start\s*date|start|from)\b/i,
    keys: ["start_date", "startDate", "start", "from"],
  },
  {
    pattern: /\b(?:end\s*date|end|to)\b/i,
    keys: ["end_date", "endDate", "end", "to"],
  },
  {
    pattern: /\b(?:summary|description|responsibilities|role\s*summary)\b/i,
    keys: [
      "summary",
      "description",
      "role_summary",
      "roleSummary",
      "responsibilities",
    ],
  },
];

function contentToString(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function isPlainRecord(value: unknown): value is ProfileRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectRecordSetsFromValue(
  path: string,
  value: unknown,
): ProfileRecordSet[] {
  if (Array.isArray(value) && value.every(isPlainRecord)) {
    return [{ path, records: value }];
  }

  if (!isPlainRecord(value)) return [];

  const sets: ProfileRecordSet[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) && child.every(isPlainRecord)) {
      sets.push({ path: `${path}.${key}`, records: child });
    }
  }
  return sets;
}

function parseProfileRecordSets(messages: LLMMessage[]): ProfileRecordSet[] {
  const sets: ProfileRecordSet[] = [];
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const text = contentToString(message.content);
    if (!text.includes("PROFILE FIELDS:")) continue;

    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s+([^:]+):\s+(.+)$/);
      if (!match) continue;
      const [, rawPath, rawJson] = match;
      try {
        const value = JSON.parse(rawJson);
        sets.push(...collectRecordSetsFromValue(rawPath.trim(), value));
      } catch {
        // Profile tool outputs JSON for structured values. Ignore non-JSON lines.
      }
    }
  }
  return sets;
}

export function collectProfileRecordSetsFromValues(
  values: Record<string, unknown>,
): ProfileRecordSet[] {
  const sets: ProfileRecordSet[] = [];
  for (const [path, value] of Object.entries(values)) {
    sets.push(...collectRecordSetsFromValue(path, value));
  }
  return sets;
}

function elementText(element: TaggedElement): string {
  const attrs = element.attributes ?? {};
  return [
    element.text,
    attrs.id,
    attrs.name,
    attrs["aria-label"],
    attrs.label,
    attrs.placeholder,
  ]
    .filter(Boolean)
    .join(" ");
}

function inferRepeatIndex(element: TaggedElement): number | null {
  const text = elementText(element);
  const bracketMatch = text.match(/\[(\d+)\]/);
  if (bracketMatch) return Number(bracketMatch[1]);

  const numberedMatch = text.match(
    /\b(?:experience|role|entry|section|item|row|education|address|dependent)[\s_-]*(\d+)\b/i,
  );
  if (numberedMatch) return Math.max(0, Number(numberedMatch[1]) - 1);

  return null;
}

function inferFieldKeys(element: TaggedElement): string[] {
  const text = elementText(element);
  for (const candidate of FIELD_KEY_CANDIDATES) {
    if (candidate.pattern.test(text)) return candidate.keys;
  }
  return [];
}

export function getProfileLiteralFallbackFields(
  element: TaggedElement | undefined | null,
): string[] {
  if (!element) return [];
  const text = elementText(element);
  if (/\b(?:experience|work\s*history|employment|roles?)\b/i.test(text)) {
    return [
      "experience.roles",
      "experience",
      "work_experience",
      "work_history",
      "employment_history",
      "roles",
    ];
  }
  if (/\b(?:education|school|degree)\b/i.test(text)) {
    return ["education.entries", "education.schools", "education"];
  }
  if (/\b(?:address|location)\b/i.test(text)) {
    return ["addresses", "address", "locations"];
  }
  if (/\bdependents?\b/i.test(text)) {
    return ["dependents", "family.dependents"];
  }
  return [];
}

function getRecordValue(
  record: ProfileRecord,
  keys: string[],
): string | number | boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
  }
  return null;
}

export function assessProfileLiteralTextRewrite(
  input: ProfileLiteralTextRewriteInput,
): ProfileLiteralTextRewrite | null {
  if (!input.selectedSkillId) return null;
  if (!EXACT_PROFILE_LITERAL_SKILLS.has(input.selectedSkillId)) return null;
  if (!input.element) return null;

  const index = inferRepeatIndex(input.element);
  const keys = inferFieldKeys(input.element);
  if (index === null || keys.length === 0) return null;

  const recordSets = [
    ...parseProfileRecordSets(input.messages),
    ...(input.recordSets ?? []),
  ];
  for (const set of recordSets) {
    const record = set.records[index];
    if (!record) continue;
    const value = getRecordValue(record, keys);
    if (value === null) continue;

    const exactText = String(value);
    if (exactText === input.text) return null;
    return {
      rewrittenText: exactText,
      reason:
        `Retargeted type_text to exact saved profile value from ${set.path}[${index}] ` +
        "for this repeatable form field.",
    };
  }

  return null;
}
