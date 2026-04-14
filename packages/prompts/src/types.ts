export type PromptId =
  | "orchestrator.verifier.system"
  | "orchestrator.advisory.system"
  | "orchestrator.site_knowledge_extraction.system"
  | "planner.decompose.system"
  | "planner.validate_done.system"
  | "planner.replan.system"
  | "planner.monitor_step.system"
  | "agent.system"
  | "agent.reflection.text_only_correction"
  | "agent.reflection.escalation"
  | "agent.reflection.deescalation"
  | "agent.reflection.handoff"
  | "agent.reflection.pivot"
  | "perception.interpret_page"
  | "evals.judge.system"
  | "evals.judge.user"
  | "evals.critique.llm_template"
  | "evals.perception_judge.system"
  | "evals.perception_judge.user"
  | "evals.planner_judge.system"
  | "evals.planner_judge.user"
  | "evals.tool_confusion_judge.system"
  | "evals.completion_timing_judge.system"
  | "evals.e2e_judge.system"
  | "evals.escalation_judge.system"
  | "evals.grounding_judge.system"
  | "demos.multi_item_shopping"
  | "ui.saved_prompt.summarize_page"
  | "ui.saved_prompt.extract_links"
  | "ui.saved_prompt.fill_form";

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
