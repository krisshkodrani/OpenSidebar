const SUMMARY_INTENT_RE =
  /\b(summarize|summary|overview|describe|extract|report|review|read|list|identify)\b/i;

const TERMINAL_PUNCTUATION_RE = /[.!?。！？)\]}>"']$/;

// Trailing Markdown emphasis/formatting (e.g. **bold.**, _italic._, `code`)
// is not real punctuation but otherwise trips the "complete sentence" check.
const TRAILING_MARKDOWN_RE = /[*_~`]+\s*$/;

function stripTrailingMarkdown(value: string): string {
  return value.replace(TRAILING_MARKDOWN_RE, "").trimEnd();
}

const TRAILING_FRAGMENT_RE =
  /\b(?:and|or|the|a|an|of|for|to|with|without|in|on|at|by|from|as|into|through|including|such as|top|key|main)\s*$/i;

const DRAFT_REVIEW_BOUNDARY_RE =
  /\b(?:do\s+not|don't|dont)\s+(?:send|submit|post|publish)\b|\bleave\b.{0,80}\b(?:unsent|for\s+(?:user\s+|my\s+|your\s+)?review)\b/i;

export function getIncompleteDoneSummaryReason(params: {
  summary: string;
  taskContext: string;
}): string | null {
  const text = stripTrailingMarkdown(params.summary.trim());
  if (text.length < 160) return null;
  if (DRAFT_REVIEW_BOUNDARY_RE.test(params.taskContext)) return null;
  if (!SUMMARY_INTENT_RE.test(params.taskContext)) return null;
  if (TERMINAL_PUNCTUATION_RE.test(text)) return null;

  const lastLine = stripTrailingMarkdown(text.split("\n").at(-1)?.trim() ?? text);
  if (/[:;,/-]\s*$/.test(lastLine)) {
    return "summary ends with an open separator";
  }
  if (TRAILING_FRAGMENT_RE.test(lastLine)) {
    return "summary ends with an unfinished phrase";
  }
  return "summary does not end as a complete sentence";
}
