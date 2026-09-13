import type { ScenarioFamily } from "./catalog.js";
import type { ScenarioLifecycle } from "./runtime.js";

/** Public task suggestions, never submitted agent prompts or benchmark telemetry. */
export interface PlaygroundScenarioV2 {
  id: string;
  version: number;
  title: string;
  task: string;
  family: ScenarioFamily;
  difficulty: "easy" | "medium" | "hard";
  observationOnly: boolean;
}

export interface PlaygroundRunV2 {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  lifecycle: ScenarioLifecycle;
  revision: number;
  result: "page_state_only" | "succeeded" | "not_completed" | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
