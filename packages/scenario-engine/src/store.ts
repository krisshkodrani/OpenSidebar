import type {
  ScenarioActionV2,
  ScenarioRunV2,
} from "@opensidebar/scenario-contracts";
import { scenarioEngine } from "./engine.js";
import { cloneJson } from "./stable-json.js";

export class ScenarioRevisionConflict extends Error {
  constructor(
    readonly runId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Scenario run ${runId} revision conflict: expected ${expectedRevision}, received ${actualRevision}.`,
    );
  }
}

export interface CreateScenarioRunV2 {
  id: string;
  ownerId: string;
  caseId: string;
  createdAt: string;
  expiresAt: string;
}

export interface ScenarioStoreV2 {
  create(input: CreateScenarioRunV2): Promise<ScenarioRunV2>;
  get(id: string): Promise<ScenarioRunV2 | null>;
  apply(
    id: string,
    expectedRevision: number,
    action: ScenarioActionV2,
    updatedAt: string,
  ): Promise<ScenarioRunV2>;
  expire(id: string, expectedRevision: number, updatedAt: string): Promise<ScenarioRunV2>;
}

export class MemoryScenarioStore implements ScenarioStoreV2 {
  private readonly runs = new Map<string, ScenarioRunV2>();

  async create(input: CreateScenarioRunV2): Promise<ScenarioRunV2> {
    if (this.runs.has(input.id)) throw new Error(`Scenario run already exists: ${input.id}`);
    const definition = scenarioEngine.case(input.caseId);
    const state = scenarioEngine.initialize(input.caseId);
    const run: ScenarioRunV2 = {
      id: input.id,
      ownerId: input.ownerId,
      scenarioId: state.scenarioId,
      scenarioVersion: state.scenarioVersion,
      caseId: definition.contract.id,
      lifecycle: state.lifecycle,
      revision: state.revision,
      state,
      result: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
    };
    this.runs.set(run.id, cloneJson(run));
    return cloneJson(run);
  }

  async get(id: string): Promise<ScenarioRunV2 | null> {
    const run = this.runs.get(id);
    return run ? cloneJson(run) : null;
  }

  async apply(
    id: string,
    expectedRevision: number,
    action: ScenarioActionV2,
    updatedAt: string,
  ): Promise<ScenarioRunV2> {
    const current = this.requireRun(id);
    this.assertRevision(current, expectedRevision);
    const state = scenarioEngine.apply(current.state, action);
    const next: ScenarioRunV2 = {
      ...current,
      revision: state.revision,
      lifecycle: state.lifecycle,
      state,
      updatedAt,
    };
    this.runs.set(id, cloneJson(next));
    return cloneJson(next);
  }

  async expire(
    id: string,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<ScenarioRunV2> {
    const current = this.requireRun(id);
    this.assertRevision(current, expectedRevision);
    const next: ScenarioRunV2 = {
      ...current,
      revision: current.revision + 1,
      lifecycle: "expired",
      state: {
        ...current.state,
        revision: current.state.revision + 1,
        lifecycle: "expired",
      },
      updatedAt,
    };
    this.runs.set(id, cloneJson(next));
    return cloneJson(next);
  }

  private requireRun(id: string): ScenarioRunV2 {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown scenario run: ${id}`);
    return run;
  }

  private assertRevision(run: ScenarioRunV2, expected: number): void {
    if (run.revision !== expected) {
      throw new ScenarioRevisionConflict(run.id, expected, run.revision);
    }
  }
}
