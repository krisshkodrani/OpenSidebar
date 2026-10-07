import { cleanLabel } from "./text-utils";

/** Infer literals only; instructions that refer to another value stay unresolved. */
export function inferWorkflowUpdateTargetValue(value: string): string | null {
  const text = cleanLabel(value);
  const patterns = [
    /\b(?:change|update|set|replace|edit)\b.{0,120}?\b(?:to|as)\s+/i,
    /\b(?:type|enter)\s+/i,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    const tail = text.slice(match.index + match[0].length)
      .replace(/^(?:(?:only|just|exactly|literally)\s+)+/i, "");
    // Quotation makes words such as "only" and "the" literal data.
    const quoted = /^(?:"([^"\n]{1,80})"|'([^'\n]{1,80})'|“([^”\n]{1,80})”)/.exec(tail);
    if (quoted) return cleanLabel(quoted[1] ?? quoted[2] ?? quoted[3]);
    if (/^(?:the|a|an|this|that|these|those|it|them|its|their|your|my|our|his|her)\b/i.test(tail)) continue;
    const afterFirstWord = tail.replace(/^\S+\s*/, "");
    if (/^(?:read|copied|shown|displayed|provided|found|listed|from|above|below)\b/i.test(afterFirstWord)) continue;
    const candidate = index === 0
      ? /^[^"',.;\n]{1,80}/.exec(tail)?.[0]
      : /^[^"'\s,.;\n]{1,80}/.exec(tail)?.[0];
    if (!candidate) continue;
    const normalized = normalizeWorkflowUpdateTargetValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeWorkflowUpdateTargetValue(value: string): string | null {
  let targetValue = cleanLabel(value);
  targetValue = targetValue.replace(
    /\s+(?:and|then|press|click|confirm|save|submit|verify|check|the\s+subtask\s+outcome|is\s+verified|verified\s+on)\b.*$/i,
    "",
  );
  targetValue = targetValue.replace(/^["']|["']$/g, "");
  targetValue = cleanLabel(targetValue);
  if (!targetValue) return null;
  if (/^(?:confirm|verify|check)\b/i.test(targetValue)) return null;
  if (!/[0-9$@._-]/.test(targetValue) && !/^.{2,40}$/.test(targetValue)) {
    return null;
  }
  return targetValue.slice(0, 80);
}
