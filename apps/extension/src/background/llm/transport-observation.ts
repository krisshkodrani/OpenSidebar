/** Request context for local transport observers. Fetch ignores this symbol;
 * it is never serialized into the HTTP request. */
export const LLM_REQUEST_OBSERVATION = Symbol.for("opensidebar.llm.request-observation");

export type LlmRequestRole = "executor" | "planner" | "writer" | "judge";

export interface LlmRequestObservation {
  role: LlmRequestRole;
  requestId: string;
}

export function withLlmRequestObservation(
  init: RequestInit,
  role: LlmRequestRole,
): RequestInit {
  const observed = { ...init } as RequestInit & { [LLM_REQUEST_OBSERVATION]?: LlmRequestObservation };
  observed[LLM_REQUEST_OBSERVATION] = { role, requestId: crypto.randomUUID() };
  return observed;
}
