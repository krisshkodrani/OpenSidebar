import { beforeEach, describe, expect, vi, test } from "vitest";
import "../setup";
import { SkillStore } from "../../src/background/skills/store";
import { SKILLS_STORAGE_KEY } from "../../src/skills/types";

describe("SkillStore", () => {
  let storageSkills: any[] = [];

  beforeEach(() => {
    storageSkills = [];
    (chrome.storage.local as any).get = vi.fn(async (key: string) => ({
      [key]: storageSkills,
    }));
    (chrome.storage.local as any).set = vi.fn(async (payload: Record<string, unknown>) => {
      if (Array.isArray(payload[SKILLS_STORAGE_KEY])) {
        storageSkills = payload[SKILLS_STORAGE_KEY] as any[];
      }
    });
  });

  test("auto-disables skill after repeated replay failures", async () => {
    storageSkills = [
      {
        id: "skill-1",
        name: "skill one",
        sourceQuery: "do task one",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        uses: 0,
        successfulRuns: 0,
        failedRuns: 0,
        consecutiveReplayFailures: 0,
        avgDurationMs: 0,
        avgTokens: 0,
        matchTokens: ["task", "one"],
        steps: [
          {
            objective: "step",
            successCriteria: "done",
            allowedTools: ["done"],
            assumptions: [],
          },
        ],
        enabled: true,
        pinned: false,
      },
    ];
    const store = new SkillStore();

    await store.recordSkillOutcome("skill-1", false, 1000, 100);
    await store.recordSkillOutcome("skill-1", false, 1000, 100);
    await store.recordSkillOutcome("skill-1", false, 1000, 100);

    expect(storageSkills[0].consecutiveReplayFailures).toBe(3);
    expect(storageSkills[0].enabled).toBe(false);
  });
});
