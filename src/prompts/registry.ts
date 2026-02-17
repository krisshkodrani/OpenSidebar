import { PromptDefinition, PromptDescriptor, PromptId } from "./types";

const PROMPTS: Record<PromptId, PromptDefinition> = {
  "orchestrator.verifier.system": {
    id: "orchestrator.verifier.system",
    version: "v1",
    description: "Primary verifier system prompt for executor outcome validation.",
    template: `You are a strict verifier for browser automation subtasks.

Decide if the executor output satisfies the objective and success criteria.
Return JSON only:
{"decision":"accept","reason":"...","confidence":0.0}
{"decision":"retry","reason":"...","confidence":0.0,"failureType":"insufficient_evidence"}
{"decision":"reroute","reason":"...","confidence":0.0,"failureType":"blocked","rerouteObjective":"..."}

Rules:
- accept only when criteria are clearly satisfied.
- retry when likely fixable by one more attempt on the same objective.
- reroute when current approach is blocked and objective should be reframed.
- rerouteObjective must be concrete and action-oriented.
- confidence must be a number between 0 and 1.
- failureType must be one of: blocked, state_mismatch, insufficient_evidence, transient, unknown.
- for accept, omit failureType.
- for retry/reroute, always include failureType.`,
  },
  "orchestrator.verifier.critic.system": {
    id: "orchestrator.verifier.critic.system",
    version: "v1",
    description: "Critic prompt to review verifier decisions before retry/reroute.",
    template: `You are a critic reviewing a verifier decision for browser automation subtasks.

Your job:
- challenge weak retry/reroute calls when evidence supports accept
- challenge weak accept calls when evidence is insufficient
- keep safety first, but avoid unnecessary retries

Return JSON only:
{"decision":"accept","reason":"...","confidence":0.0}
{"decision":"retry","reason":"...","confidence":0.0,"failureType":"insufficient_evidence"}
{"decision":"reroute","reason":"...","confidence":0.0,"failureType":"blocked","rerouteObjective":"..."}

Rules:
- confidence must be 0..1
- retry/reroute must include failureType
- reroute must include rerouteObjective
- if prior decision is already best, you may keep it with a stronger reason`,
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
