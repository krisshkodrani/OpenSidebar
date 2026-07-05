/**
 * Task-list loader for the public benchmark adapter (RFC LP-1).
 *
 * Loads and schema-validates a vendored Online-Mind2Web task file, and builds
 * a stratified subset using the benchmark's own difficulty labels. Pure (no
 * I/O beyond the explicit `loadTaskFile` reader) so the validation and subset
 * logic are unit-testable.
 */

import { readFileSync } from "fs";
import type {
  BenchDifficulty,
  BenchTask,
  BenchTaskFile,
} from "./types";

const DIFFICULTIES: readonly BenchDifficulty[] = ["easy", "medium", "hard"];

export class BenchTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchTaskValidationError";
  }
}

function isDifficulty(value: unknown): value is BenchDifficulty {
  return (
    typeof value === "string" &&
    (DIFFICULTIES as readonly string[]).includes(value)
  );
}

function validateTask(value: unknown, index: number): BenchTask {
  if (!value || typeof value !== "object") {
    throw new BenchTaskValidationError(`task[${index}] is not an object`);
  }
  const record = value as Record<string, unknown>;
  const taskId = record.task_id;
  const confirmedTask = record.confirmed_task;
  const website = record.website;
  const level = record.level;

  if (typeof taskId !== "string" || taskId.trim().length === 0) {
    throw new BenchTaskValidationError(
      `task[${index}] is missing a non-empty string task_id`,
    );
  }
  if (typeof confirmedTask !== "string" || confirmedTask.trim().length === 0) {
    throw new BenchTaskValidationError(
      `task ${taskId} is missing a non-empty confirmed_task`,
    );
  }
  if (typeof website !== "string" || !/^https?:\/\//i.test(website)) {
    throw new BenchTaskValidationError(
      `task ${taskId} has an invalid website URL: ${String(website)}`,
    );
  }
  if (!isDifficulty(level)) {
    throw new BenchTaskValidationError(
      `task ${taskId} has an invalid level: ${String(level)} (expected easy|medium|hard)`,
    );
  }

  const task: BenchTask = {
    task_id: taskId,
    confirmed_task: confirmedTask,
    website,
    level,
  };
  if (typeof record.reference_length === "number") {
    task.reference_length = record.reference_length;
  }
  return task;
}

/** Validate a parsed object as a BenchTaskFile, throwing on any problem. */
export function validateTaskFile(value: unknown): BenchTaskFile {
  if (!value || typeof value !== "object") {
    throw new BenchTaskValidationError("task file root is not an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["source", "revision", "license"] as const) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
      throw new BenchTaskValidationError(
        `task file is missing required pin field "${key}"`,
      );
    }
  }
  if (!Array.isArray(record.tasks)) {
    throw new BenchTaskValidationError("task file has no tasks array");
  }
  if (record.tasks.length === 0) {
    throw new BenchTaskValidationError("task file tasks array is empty");
  }

  const seen = new Set<string>();
  const tasks = record.tasks.map((task, index) => {
    const validated = validateTask(task, index);
    if (seen.has(validated.task_id)) {
      throw new BenchTaskValidationError(
        `duplicate task_id: ${validated.task_id}`,
      );
    }
    seen.add(validated.task_id);
    return validated;
  });

  return {
    source: record.source as string,
    revision: record.revision as string,
    license: record.license as string,
    note: typeof record.note === "string" ? record.note : undefined,
    tasks,
  };
}

/** Read and validate a vendored task file from disk. */
export function loadTaskFile(filePath: string): BenchTaskFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BenchTaskValidationError(
      `could not read task file ${filePath}: ${detail}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BenchTaskValidationError(
      `task file ${filePath} is not valid JSON: ${detail}`,
    );
  }
  return validateTaskFile(parsed);
}

/**
 * Deterministic seeded shuffle (mulberry32) so a given seed always selects the
 * same stratified subset — reproducibility is a benchmark requirement.
 */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface SubsetOptions {
  /** Total number of tasks to select across difficulty bands. */
  size?: number;
  /** Restrict to these difficulty bands (default: all). */
  levels?: BenchDifficulty[];
  /** Seed for the deterministic selection. */
  seed?: number;
}

/**
 * Build a stratified subset of tasks. When `size` is given, tasks are drawn
 * proportionally to each band's share of the (level-filtered) pool, so the
 * subset preserves the benchmark's easy/medium/hard mix. Selection within a
 * band is seeded-deterministic.
 */
export function selectStratifiedSubset(
  tasks: BenchTask[],
  options: SubsetOptions = {},
): BenchTask[] {
  const levels = options.levels ?? [...DIFFICULTIES];
  const seed = options.seed ?? 0;
  const pool = tasks.filter((task) => levels.includes(task.level));

  if (options.size == null || options.size >= pool.length) {
    return pool;
  }
  const size = Math.max(0, Math.floor(options.size));
  if (size === 0) return [];

  const byLevel = new Map<BenchDifficulty, BenchTask[]>();
  for (const level of levels) {
    byLevel.set(
      level,
      seededShuffle(
        pool.filter((task) => task.level === level),
        seed,
      ),
    );
  }

  // Proportional allocation with largest-remainder rounding.
  const allocations = levels.map((level) => {
    const count = byLevel.get(level)?.length ?? 0;
    const exact = (count / pool.length) * size;
    return { level, count, exact, floor: Math.floor(exact) };
  });
  let allocated = allocations.reduce((sum, a) => sum + a.floor, 0);
  const remainders = [...allocations].sort(
    (a, b) => b.exact - b.floor - (a.exact - a.floor),
  );
  let r = 0;
  while (allocated < size && r < remainders.length) {
    const target = remainders[r];
    if (target.floor < target.count) {
      target.floor += 1;
      allocated += 1;
    }
    r += 1;
    if (r >= remainders.length && allocated < size) r = 0;
    // Guard against an impossible request (size > pool already handled above).
    if (remainders.every((a) => a.floor >= a.count)) break;
  }

  const selected: BenchTask[] = [];
  for (const allocation of allocations) {
    const bandTasks = byLevel.get(allocation.level) ?? [];
    selected.push(...bandTasks.slice(0, allocation.floor));
  }
  // Stable order: by level then task_id, for readable reports.
  return selected.sort(
    (a, b) =>
      DIFFICULTIES.indexOf(a.level) - DIFFICULTIES.indexOf(b.level) ||
      a.task_id.localeCompare(b.task_id),
  );
}
