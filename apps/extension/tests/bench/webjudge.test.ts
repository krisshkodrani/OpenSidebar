import { describe, it, expect } from "vitest";
import {
  buildWebJudgePrompt,
  parseWebJudgeVerdict,
} from "../../../../scripts/bench/webjudge";
import type {
  BenchRunEvidence,
  BenchTask,
} from "../../../../scripts/bench/types";

const task: BenchTask = {
  task_id: "t1",
  confirmed_task: "Find the year the Eiffel Tower was completed and report it.",
  website: "https://en.wikipedia.org/wiki/Eiffel_Tower",
  level: "easy",
};

function evidence(overrides: Partial<BenchRunEvidence> = {}): BenchRunEvidence {
  return {
    task,
    completionStatus: "completed",
    doneSummary: "The Eiffel Tower was completed in 1889.",
    trajectory: ["T1 navigate() @ https://en.wikipedia.org/wiki/Eiffel_Tower", "T2 read_page()"],
    finalUrl: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    turns: 2,
    costUsd: 0.01,
    durationMs: 5000,
    traceFiles: [],
    ...overrides,
  };
}

describe("webjudge — buildWebJudgePrompt", () => {
  it("includes the task, website, final answer, and trajectory", () => {
    const { system, user } = buildWebJudgePrompt(task, evidence());
    expect(system).toMatch(/WebJudge/);
    expect(user).toContain(task.confirmed_task);
    expect(user).toContain(task.website);
    expect(user).toContain("1889");
    expect(user).toContain("T1 navigate");
  });

  it("notes when there is no final answer", () => {
    const { user } = buildWebJudgePrompt(task, evidence({ doneSummary: "" }));
    expect(user).toMatch(/no final answer/i);
  });

  it("truncates an overlong trajectory", () => {
    const longTrajectory = Array.from({ length: 200 }, (_, i) => `T${i} click()`);
    const { user } = buildWebJudgePrompt(task, evidence({ trajectory: longTrajectory }));
    expect(user).toMatch(/more turns omitted/);
  });
});

describe("webjudge — parseWebJudgeVerdict", () => {
  it("parses a clean JSON success", () => {
    const verdict = parseWebJudgeVerdict(
      '{"success": true, "confidence": 0.9, "reasoning": "answer matches"}',
      "judge-x",
      "t1",
    );
    expect(verdict.outcome).toBe("success");
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.judgeModel).toBe("judge-x");
    expect(verdict.task_id).toBe("t1");
  });

  it("parses a fenced JSON failure", () => {
    const verdict = parseWebJudgeVerdict(
      'Here is my verdict:\n```json\n{"success": false, "reasoning": "no evidence"}\n```',
      "judge-x",
      "t1",
    );
    expect(verdict.outcome).toBe("failure");
    expect(verdict.confidence).toBeNull();
  });

  it("maps string verdicts", () => {
    expect(parseWebJudgeVerdict('{"outcome":"pass"}', "j", "t").outcome).toBe("success");
    expect(parseWebJudgeVerdict('{"verdict":"fail"}', "j", "t").outcome).toBe("failure");
  });

  it("returns uncertain (never success) for unparseable output", () => {
    const verdict = parseWebJudgeVerdict("the model rambled with no json", "j", "t1");
    expect(verdict.outcome).toBe("uncertain");
  });

  it("normalizes a percentage confidence into 0..1", () => {
    const verdict = parseWebJudgeVerdict('{"success": true, "confidence": 85}', "j", "t");
    expect(verdict.confidence).toBeCloseTo(0.85);
  });

  it("clamps a confidence above 100", () => {
    const verdict = parseWebJudgeVerdict('{"success": true, "confidence": 150}', "j", "t");
    expect(verdict.confidence).toBe(1);
  });

  it("clamps a negative confidence to 0", () => {
    const verdict = parseWebJudgeVerdict('{"success": false, "confidence": -3}', "j", "t");
    expect(verdict.confidence).toBe(0);
  });
});
