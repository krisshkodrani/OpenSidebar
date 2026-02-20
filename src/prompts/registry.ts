import { PromptDefinition, PromptDescriptor, PromptId } from "./types";

const PROMPTS: Record<PromptId, PromptDefinition> = {
  "orchestrator.verifier.system": {
    id: "orchestrator.verifier.system",
    version: "v2",
    description:
      "Primary verifier system prompt for executor outcome validation.",
    template: `You are a strict verifier for browser automation subtasks.

Decide if the executor output satisfies the objective and success criteria.
Return JSON only:
{"decision":"accept","reason":"...","confidence":0.0}
{"decision":"retry","reason":"...","confidence":0.0,"failureType":"insufficient_evidence"}
{"decision":"reroute","reason":"...","confidence":0.0,"failureType":"blocked","rerouteObjective":"..."}

Rules:
- accept only when criteria are clearly satisfied.
- When deciding "accept", you MUST cite at least one specific piece of evidence from the executor's output. If the output lacks concrete evidence of success, use "retry" with failureType "insufficient_evidence".
- retry when likely fixable by one more attempt on the same objective.
- reroute when current approach is blocked and objective should be reframed.
- rerouteObjective must be concrete and action-oriented.
- confidence must be a number between 0 and 1.
- failureType must be one of: blocked, state_mismatch, insufficient_evidence, transient, unknown.
- for accept, omit failureType.
- for retry/reroute, always include failureType.`,
  },
  "orchestrator.advisory.system": {
    id: "orchestrator.advisory.system",
    version: "v1",
    description: "Pre-execution advisory for retried/rerouted nodes.",
    template: `You are a brief advisor for a browser automation executor about to retry or continue from a prior failed attempt.

Given the executor instruction and current page state, provide a 2-4 sentence advisory covering:
- Mismatches between what the instruction assumes and what the page actually shows
- Potential blockers visible on the page (modals, auth walls, changed layout)
- Recommended approach adjustments based on current page reality

If the instruction and page state look well-aligned, respond with exactly: "No advisory needed."

Keep your response concise and actionable. No JSON — plain text only.`,
  },
};

function hashPrompt(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getPromptTemplate(id: PromptId): string {
  return PROMPTS[id].template;
}

export function getPromptDefinition(id: PromptId): PromptDefinition {
  return PROMPTS[id];
}

export function listPromptDescriptors(ids?: PromptId[]): PromptDescriptor[] {
  const keys = ids ?? (Object.keys(PROMPTS) as PromptId[]);
  return keys.map((id) => ({
    id,
    version: PROMPTS[id].version,
    hash: hashPrompt(PROMPTS[id].template),
  }));
}
