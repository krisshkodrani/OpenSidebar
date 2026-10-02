/** Route an explicit missing user choice to the interaction protocol before retrying page tools. */
export function clarificationQuestionForEscalation(
  reason: string,
  userRequest: string,
): string | null {
  const describesAmbiguity =
    /\bambiguous\b/i.test(reason) ||
    /\b(?:more than one|multiple|several)\b[\s\S]{0,80}\b(?:valid|possible|plausible|matching|candidate|target|option|choice|owner|assignee|person|record|account|workspace)\b/i.test(reason) ||
    /\bno single\b[\s\S]{0,100}\b(?:two|multiple|several)\b/i.test(reason);
  const requiresChoice =
    /\b(?:choose|choice|select|pick|which|target|candidate|assign|owner|assignee)\b/i.test(reason);
  if (!describesAmbiguity || !requiresChoice) return null;

  const task = userRequest.replace(/\s+/g, " ").trim().slice(0, 180);
  return task
    ? `I found more than one possible target for "${task}". Which one should I use?`
    : "I found more than one possible target. Which one should I use?";
}
