import type { SkillMatcherInput } from "./skill-types";

export function buildCorpus(parts: Array<string | undefined>): string {
  return parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n")
    .toLowerCase();
}

export function buildRoutingCorpus(input: SkillMatcherInput): string {
  return buildCorpus([
    input.query,
    input.objective,
    input.successCriteria,
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
}
