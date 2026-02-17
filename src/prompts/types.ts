export type PromptId =
  | "orchestrator.verifier.system"
  | "orchestrator.verifier.critic.system"
  | "orchestrator.advisory.system"
  | "orchestrator.verifier.preflight.system"
  | "orchestrator.verifier.advocate.system"
  | "orchestrator.planner.retrospective.system";

export interface PromptDefinition {
  id: PromptId;
  version: string;
  description: string;
  template: string;
}

export interface PromptDescriptor {
  id: PromptId;
  version: string;
  hash: string;
}
