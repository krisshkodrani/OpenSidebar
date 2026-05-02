import { AgentStep } from "../../types";

export function approvalRequestStep(args: {
  id: string;
  context: string;
  timestamp: number;
}): AgentStep {
  return {
    id: args.id,
    type: "info",
    label: `Approval requested: ${args.context}`,
    status: "running",
    timestamp: args.timestamp,
  };
}

export function clarificationRequestStep(args: {
  id: string;
  question: string;
  timestamp: number;
}): AgentStep {
  return {
    id: args.id,
    type: "info",
    label: `Clarification: "${args.question.slice(0, 80)}"`,
    status: "running",
    timestamp: args.timestamp,
  };
}
