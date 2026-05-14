const SUMMARY_INTENT_RE =
  /\b(summarize|summary|overview|describe|extract|report|review|read|list|identify)\b/i;

const TERMINAL_PUNCTUATION_RE = /[.!?。！？)\]}>"']$/;

const TRAILING_FRAGMENT_RE =
  /\b(?:and|or|the|a|an|of|for|to|with|without|in|on|at|by|from|as|into|through|including|such as|top|key|main)\s*$/i;

export function getIncompleteDoneSummaryReason(params: {
  summary: string;
  taskContext: string;
}): string | null {
  const text = params.summary.trim();
  if (text.length < 160) return null;
  if (!SUMMARY_INTENT_RE.test(params.taskContext)) return null;
  if (TERMINAL_PUNCTUATION_RE.test(text)) return null;

  const lastLine = text.split("\n").at(-1)?.trim() ?? text;
  if (/[:;,/-]\s*$/.test(lastLine)) {
    return "summary ends with an open separator";
  }
  if (TRAILING_FRAGMENT_RE.test(lastLine)) {
    return "summary ends with an unfinished phrase";
  }
  return "summary does not end as a complete sentence";
}
