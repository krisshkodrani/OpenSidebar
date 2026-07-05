import { describe, it, expect } from "vitest";
import {
  BenchTaskValidationError,
  selectStratifiedSubset,
  validateTaskFile,
} from "../../../../scripts/bench/loader";
import type { BenchTask } from "../../../../scripts/bench/types";

function makeTask(id: string, level: BenchTask["level"]): BenchTask {
  return {
    task_id: id,
    confirmed_task: `do thing ${id}`,
    website: "https://example.com",
    level,
  };
}

const validFile = {
  source: "osunlp/Online-Mind2Web",
  revision: "abc123",
  license: "CC-BY-4.0",
  tasks: [
    { task_id: "t1", confirmed_task: "find X", website: "https://a.com", level: "easy" },
    { task_id: "t2", confirmed_task: "find Y", website: "http://b.org/p", level: "hard" },
  ],
};

describe("bench loader — validateTaskFile", () => {
  it("accepts a well-formed task file", () => {
    const file = validateTaskFile(validFile);
    expect(file.tasks).toHaveLength(2);
    expect(file.revision).toBe("abc123");
  });

  it("rejects a missing pin field", () => {
    const { revision, ...rest } = validFile;
    void revision;
    expect(() => validateTaskFile(rest)).toThrow(BenchTaskValidationError);
  });

  it("rejects an empty tasks array", () => {
    expect(() => validateTaskFile({ ...validFile, tasks: [] })).toThrow(
      /empty/,
    );
  });

  it("rejects an invalid website URL", () => {
    expect(() =>
      validateTaskFile({
        ...validFile,
        tasks: [{ task_id: "t1", confirmed_task: "x", website: "ftp://no", level: "easy" }],
      }),
    ).toThrow(/website/);
  });

  it("rejects an invalid difficulty level", () => {
    expect(() =>
      validateTaskFile({
        ...validFile,
        tasks: [{ task_id: "t1", confirmed_task: "x", website: "https://a.com", level: "trivial" }],
      }),
    ).toThrow(/level/);
  });

  it("rejects duplicate task ids", () => {
    expect(() =>
      validateTaskFile({
        ...validFile,
        tasks: [validFile.tasks[0], validFile.tasks[0]],
      }),
    ).toThrow(/duplicate/);
  });
});

describe("bench loader — selectStratifiedSubset", () => {
  const pool: BenchTask[] = [
    ...Array.from({ length: 10 }, (_, i) => makeTask(`e${i}`, "easy")),
    ...Array.from({ length: 6 }, (_, i) => makeTask(`m${i}`, "medium")),
    ...Array.from({ length: 4 }, (_, i) => makeTask(`h${i}`, "hard")),
  ];

  it("returns the full pool when size exceeds it", () => {
    expect(selectStratifiedSubset(pool, { size: 100 })).toHaveLength(20);
  });

  it("returns the whole pool when size is omitted", () => {
    expect(selectStratifiedSubset(pool)).toHaveLength(20);
  });

  it("preserves the difficulty mix proportionally", () => {
    const subset = selectStratifiedSubset(pool, { size: 10, seed: 1 });
    expect(subset).toHaveLength(10);
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const task of subset) counts[task.level] += 1;
    // 10/6/4 of 20 → 5/3/2 of 10.
    expect(counts).toEqual({ easy: 5, medium: 3, hard: 2 });
  });

  it("is deterministic for a given seed", () => {
    const a = selectStratifiedSubset(pool, { size: 8, seed: 42 });
    const b = selectStratifiedSubset(pool, { size: 8, seed: 42 });
    expect(a.map((t) => t.task_id)).toEqual(b.map((t) => t.task_id));
  });

  it("honors a level filter", () => {
    const subset = selectStratifiedSubset(pool, { levels: ["hard"] });
    expect(subset).toHaveLength(4);
    expect(subset.every((t) => t.level === "hard")).toBe(true);
  });

  it("returns an empty array for size 0", () => {
    expect(selectStratifiedSubset(pool, { size: 0 })).toEqual([]);
  });
});
