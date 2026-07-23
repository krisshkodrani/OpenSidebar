/**
 * Disk skill mirror ↔ runtime catalog parity (2026-07-23 skills audit,
 * Finding 1).
 *
 * `skills/workflow/<id>/descriptor.json` mirrors a subset of the runtime
 * `SKILL_CATALOG` for review and authoring, but NOTHING reads it at runtime —
 * so nothing stopped the two copies from drifting (they had: opposite `done`
 * guidance on modal-overlay-recovery, differing triggers and notes). This test
 * makes drift loud: every mirrored descriptor must be field-identical to its
 * catalog entry. Regenerate the disk copy from the catalog when the runtime
 * changes — live wins every conflict.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "../setup";
import { SKILL_CATALOG } from "../../src/background/orchestrator/skill-catalog";

const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = resolve(here, "../../../../skills/workflow");

/** Descriptor fields the disk mirror carries; compared verbatim. */
const MIRRORED_FIELDS = [
  "id",
  "name",
  "description",
  "tags",
  "triggers",
  "maturity",
  "preferredTools",
  "discouragedTools",
  "contextScope",
  "verifierMode",
  "notes",
] as const;

const mirroredDirs = existsSync(skillsRoot)
  ? readdirSync(skillsRoot).filter((dir) =>
      existsSync(join(skillsRoot, dir, "descriptor.json")),
    )
  : [];

describe("disk skill mirror parity", () => {
  test("the mirror directory exists and mirrors at least the original nine", () => {
    expect(mirroredDirs.length).toBeGreaterThanOrEqual(9);
  });

  test.each(mirroredDirs)("%s matches its runtime catalog entry", (dir) => {
    const disk = JSON.parse(
      readFileSync(join(skillsRoot, dir, "descriptor.json"), "utf8"),
    ) as Record<string, unknown>;
    const runtime = SKILL_CATALOG.find((skill) => skill.id === dir);

    expect(
      runtime,
      `${dir} has a disk descriptor but no runtime catalog entry`,
    ).toBeDefined();

    for (const field of MIRRORED_FIELDS) {
      // Normalize absent vs empty-array so "no discouraged tools" compares
      // equal regardless of which representation a side chose.
      const normalize = (value: unknown) =>
        value === undefined && (field === "discouragedTools" || field === "notes")
          ? []
          : value;
      expect(
        normalize(disk[field]),
        `${dir}.${field} drifted from the runtime catalog`,
      ).toEqual(normalize((runtime as Record<string, unknown>)[field]));
    }

    // The disk-only alias that let drift hide (validator also rejects it).
    expect(disk.memoryScope, `${dir} still uses memoryScope`).toBeUndefined();
  });
});
