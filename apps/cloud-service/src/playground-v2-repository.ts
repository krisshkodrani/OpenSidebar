import type {
  PlaygroundRunV2,
  ScenarioStateV2,
} from "@opensidebar/scenario-contracts";

export interface PlaygroundRunRecordV2 extends PlaygroundRunV2 {
  ownerId: string;
  state: ScenarioStateV2;
}

/** Operational public data only; deliberately has no benchmark attempt/trace methods. */
export interface PlaygroundV2Repository {
  list(ownerId: string): Promise<PlaygroundRunRecordV2[]>;
  get(id: string): Promise<PlaygroundRunRecordV2 | null>;
  create(
    run: PlaygroundRunRecordV2,
    idempotencyHash: string,
  ): Promise<PlaygroundRunRecordV2>;
  update(
    run: PlaygroundRunRecordV2,
    expectedRevision: number,
  ): Promise<boolean>;
  remove(id: string, ownerId: string): Promise<boolean>;
  createLaunch(hash: string, id: string, expiresAt: string): Promise<void>;
  consumeLaunch(hash: string): Promise<string | null>;
  createTargetSession(
    hash: string,
    id: string,
    expiresAt: string,
  ): Promise<void>;
  targetRunId(hash: string): Promise<string | null>;
}

export function publicPlaygroundRun(
  run: PlaygroundRunRecordV2,
): PlaygroundRunV2 {
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    lifecycle: run.lifecycle,
    revision: run.revision,
    result: run.result,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expiresAt: run.expiresAt,
  };
}

export function usablePlaygroundRun(
  run: PlaygroundRunRecordV2 | null,
): run is PlaygroundRunRecordV2 {
  return Boolean(
    run &&
    run.lifecycle !== "expired" &&
    Date.parse(run.expiresAt) > Date.now(),
  );
}
