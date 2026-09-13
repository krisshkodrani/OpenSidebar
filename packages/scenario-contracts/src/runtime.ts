import type { JsonObject } from "./json.js";

export type ScenarioLifecycle =
  | "ready"
  | "active"
  | "finished"
  | "expired";

export interface ScenarioEventV2 {
  sequence: number;
  type: string;
  payload: JsonObject;
}

export interface ScenarioStateV2 {
  schemaVersion: 2;
  scenarioId: string;
  scenarioVersion: number;
  seed: number;
  revision: number;
  lifecycle: ScenarioLifecycle;
  route: string;
  data: JsonObject;
  events: readonly ScenarioEventV2[];
}

export interface ScenarioTargetViewV2 {
  scenarioId: string;
  scenarioVersion: number;
  revision: number;
  lifecycle: ScenarioLifecycle;
  route: string;
  data: JsonObject;
}

export interface ScenarioActionV2 {
  type: string;
  payload?: JsonObject;
}

export interface ScenarioRunV2 {
  id: string;
  ownerId: string;
  scenarioId: string;
  scenarioVersion: number;
  caseId?: string;
  lifecycle: ScenarioLifecycle;
  revision: number;
  state: ScenarioStateV2;
  result: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
