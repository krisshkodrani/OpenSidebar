export function hasDecomposedReadAnswerIntent(normalized: string): boolean {
  const requestedResult =
    /\b(?:requested|target|matching|found|located)\s+(?:result|results|answer|answers|value|values|code|token|key|identifier|id)s?\b/;
  const answerNoun =
    /\b(?:answer|answers|result|results|value|values|code|token|key|identifier|id)s?\b/;
  const readOrReportVerb =
    /\b(?:read|report|extract|identify|tell me|return|provide|find|locate)\b/;
  const navigationVerb = /\b(?:navigate to|open|go to|visit|scroll to)\b/;
  return (
    readOrReportVerb.test(normalized) &&
    (requestedResult.test(normalized) ||
      (navigationVerb.test(normalized) && answerNoun.test(normalized)))
  );
}
