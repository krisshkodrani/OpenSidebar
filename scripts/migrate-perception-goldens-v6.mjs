import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const GOLDEN_DIR = join(process.cwd(), "evals", "golden", "perception");
const V6_SECTIONS = [
  "LOCATION",
  "CHANGES",
  "BLOCKERS",
  "VISUAL-ONLY",
  "AFFORDANCES",
];

const DIMENSION_MAP = {
  accuracy: "accuracy",
  blockers: "blockers",
  completion_signal: "visual_only",
  hallucination: "hallucination",
  hazards: "blockers",
  actionability: "affordances",
};

const files = readdirSync(GOLDEN_DIR).filter((file) => file.endsWith(".json"));

for (const file of files) {
  const fullPath = join(GOLDEN_DIR, file);
  const parsed = JSON.parse(readFileSync(fullPath, "utf-8"));
  const interpretation = parsed.reference?.interpretation ?? "";
  const elements = parsed.input?.elements ?? [];

  const expected = parsed.expected ?? {};
  parsed.input = {
    screenshotDataUrl: parsed.input?.screenshotDataUrl ?? "",
    elements,
    url: parsed.input?.url ?? "",
    title: parsed.input?.title ?? "",
    scroll: parsed.input?.scroll ?? { y: 0, maxY: 0 },
  };

  parsed.expected = {
    requiredSections: V6_SECTIONS,
    ...(expected.pageType ? { pageType: expected.pageType } : {}),
    ...(Array.isArray(expected.blockers) ? { blockers: sanitizeBlockers(expected.blockers, elements) } : {}),
    ...(extractMentionedElementIds(interpretation, elements).length > 0
      ? { mustMentionElements: extractMentionedElementIds(interpretation, elements) }
      : {}),
    ...(extractVisualOnlyFacts(interpretation).length > 0
      ? { visualOnlyContent: extractVisualOnlyFacts(interpretation) }
      : {}),
    ...(expected.notes ? { notes: expected.notes } : {}),
  };

  if (parsed.metadata) {
    const mappedDimension = DIMENSION_MAP[parsed.metadata.dimension] ?? parsed.metadata.dimension;
    parsed.metadata = {
      ...parsed.metadata,
      ...(mappedDimension ? { dimension: mappedDimension } : {}),
    };
  }

  writeFileSync(fullPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
}

console.log(`Migrated ${files.length} perception golden file(s) to v6 schema.`);

function sanitizeBlockers(blockers, elements) {
  const availableIds = new Set(
    elements
      .map((element) => element?.tag)
      .filter((tag) => typeof tag === "number"),
  );

  return blockers.map((blocker) => {
    const next = {
      type: blocker.type === "mismatch" ? "mismatch" : blocker.type,
      description: blocker.description,
    };

    if (typeof blocker.tagId === "number" && availableIds.has(blocker.tagId)) {
      next.tagId = blocker.tagId;
    }

    return next;
  });
}

function extractMentionedElementIds(interpretation, elements) {
  const availableIds = new Set(
    elements
      .map((element) => element?.tag)
      .filter((tag) => typeof tag === "number"),
  );
  const found = new Set();

  for (const match of interpretation.matchAll(/\[(\d+)\]/g)) {
    const id = Number.parseInt(match[1], 10);
    if (availableIds.has(id)) {
      found.add(id);
    }
  }

  return Array.from(found).sort((a, b) => a - b);
}

function extractVisualOnlyFacts(interpretation) {
  const sectionMatch = interpretation.match(
    /\bVISUAL-ONLY\s*:\s*([\s\S]*?)(?:\n\s*\d+\.\s*[A-Z-]+\s*:|$)/i,
  );
  if (!sectionMatch) {
    return [];
  }

  return sectionMatch[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}
