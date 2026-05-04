import { describe, expect, test } from "vitest";
import {
  CHECKPOINT_TTL_MS,
  isCheckpointCompatible,
  isCheckpointFresh,
} from "../../src/background/orchestrator/checkpoint-store";
import type { OrchestratorCheckpoint } from "../../src/background/orchestrator/types";

function checkpoint(
  value: Partial<OrchestratorCheckpoint>,
): OrchestratorCheckpoint {
  return {
    version: 1,
    savedAt: Date.now(),
    task: { workspaceId: "workspace-a" },
    ...value,
  } as OrchestratorCheckpoint;
}

describe("orchestrator checkpoint store", () => {
  test("checks checkpoint version and freshness", () => {
    expect(isCheckpointCompatible(checkpoint({ version: 1 }))).toBe(true);
    expect(isCheckpointCompatible(checkpoint({ version: 0 as 1 }))).toBe(false);

    expect(isCheckpointFresh(checkpoint({ savedAt: Date.now() }))).toBe(true);
    expect(
      isCheckpointFresh(
        checkpoint({ savedAt: Date.now() - CHECKPOINT_TTL_MS - 1 }),
      ),
    ).toBe(false);
  });
});
