import { describe, expect, test } from "vitest";
import { extractPromptMessages } from "../../src/trace-viewer/analysis/prompt-messages";
import { extractSkillEvents } from "../../src/trace-viewer/analysis/skill-events";

describe("trace-viewer prompt and skill extraction", () => {
  test("extracts prompt messages while reporting partial turn availability", () => {
    const result = extractPromptMessages(
      {
        sessionId: "session-1",
        startTime: 0,
        endTime: 1,
        query: "Objective",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 2,
        summary: "done",
        metrics: null,
      } as any,
      [
        {
          sessionId: "session-1",
          turnNumber: 1,
          timestamp: 10,
          llmRequest: {
            model: "model-a",
            modelTier: "executor",
            messages: [
              { role: "system", content: "System instructions" },
              { role: "user", content: null, tool_call_id: "tool-1" },
            ],
          },
        },
        {
          sessionId: "session-1",
          turnNumber: 2,
          timestamp: 20,
          llmRequest: {
            model: "model-a",
          },
        },
      ] as any,
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "user",
      content: null,
      toolCallId: "tool-1",
    });
    expect(result.totalTurns).toBe(2);
    expect(result.turnsWithMessages).toBe(1);
    expect(result.unavailableTurnNumbers).toEqual([2]);
  });

  test("extracts structured skill ranking and selection events", () => {
    const result = extractSkillEvents([
      {
        sessionId: "session-1",
        turnNumber: 3,
        events: [
          {
            eventId: "event-rank",
            type: "skill_tool_ranking_applied",
            timestamp: 100,
            data: {
              turn: 3,
              skillId: "job-search",
              preferredTools: ["click"],
              discouragedTools: ["sleep"],
              originalOrder: ["sleep", "click"],
              rankedOrder: ["click", "sleep"],
            },
          },
          {
            eventId: "event-select",
            type: "skill_tool_selected",
            timestamp: 110,
            data: {
              turn: 3,
              skillId: "job-search",
              toolName: "click",
              preference: "preferred",
              mode: "sequential",
            },
          },
        ],
      },
    ] as any);

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      id: "event-rank",
      kind: "ranking_applied",
      originalOrder: ["sleep", "click"],
      rankedOrder: ["click", "sleep"],
    });
    expect(result.events[1]).toMatchObject({
      id: "event-select",
      kind: "selected",
      selectedToolName: "click",
      selectionPreference: "preferred",
      selectionMode: "sequential",
    });
  });
});
