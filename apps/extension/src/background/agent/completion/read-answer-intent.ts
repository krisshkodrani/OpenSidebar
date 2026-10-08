export function hasDecomposedReadAnswerIntent(normalized: string): boolean {
  const requestedResult =
    /\b(?:requested|target|matching|found|located)\s+(?:result|results|answer|answers|value|values|code|token|key|identifier|id)s?\b/;
  const answerNoun =
    /\b(?:answer|answers|result|results|value|values|code|token|key|identifier|id)s?\b/;
  const readOrReportVerb =
    /\b(?:read|report|extract|identify|tell me|return|provide|find|locate)\b/;
  const navigationVerb = /\b(?:navigate to|open|go to|visit|scroll to)\b/;
  // Reading an artifact and reporting on it does not request the past actions
  // described in that artifact. Explicit mixed action requests are gated by
  // inferRequestedWorkflowConfirmationAction before read-answer generation.
  const readAndReport =
    /\bread\b.{0,160}\b(?:report|explain|give me|tell me|describe|extract)\b/;
  return (
    readAndReport.test(normalized) ||
    (readOrReportVerb.test(normalized) &&
      (requestedResult.test(normalized) ||
        (navigationVerb.test(normalized) && answerNoun.test(normalized))))
  );
}
