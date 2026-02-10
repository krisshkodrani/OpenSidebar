/**
 * Golden Dataset Loader
 *
 * Loads and manages golden test cases from YAML files.
 */

import { parse } from "yaml";
import type { GoldenCase } from "./types.js";
import { readdir } from "fs/promises";
import { join } from "path";

const GOLDEN_CASES_DIR = "./evals/golden/cases";

/**
 * Load a single golden case from YAML file
 */
export async function loadGoldenCase(filePath: string): Promise<GoldenCase> {
  const file = Bun.file(filePath);
  const content = await file.text();
  const data = parse(content) as GoldenCase;

  // Validate required fields
  validateGoldenCase(data, filePath);

  return data;
}

/**
 * Load all golden cases from the cases directory
 */
export async function loadAllGoldenCases(): Promise<GoldenCase[]> {
  const cases: GoldenCase[] = [];

  try {
    const files = await readdir(GOLDEN_CASES_DIR);

    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const filePath = join(GOLDEN_CASES_DIR, file);
        const testCase = await loadGoldenCase(filePath);
        cases.push(testCase);
      }
    }
  } catch (error) {
    console.warn(
      `Could not load golden cases from ${GOLDEN_CASES_DIR}:`,
      error,
    );
    return [];
  }

  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Filter golden cases by criteria
 */
export function filterGoldenCases(
  cases: GoldenCase[],
  options: {
    tags?: string[];
    difficulty?: string[];
    category?: string[];
    ids?: string[];
  },
): GoldenCase[] {
  return cases.filter((testCase) => {
    // Filter by IDs
    if (options.ids?.length && !options.ids.includes(testCase.id)) {
      return false;
    }

    // Filter by tags (match any)
    if (options.tags?.length) {
      const hasTag = options.tags.some((tag) =>
        testCase.metadata.tags.includes(tag),
      );
      if (!hasTag) return false;
    }

    // Filter by difficulty
    if (options.difficulty?.length) {
      if (!options.difficulty.includes(testCase.metadata.difficulty)) {
        return false;
      }
    }

    // Filter by category
    if (options.category?.length) {
      if (
        !testCase.metadata.category ||
        !options.category.includes(testCase.metadata.category)
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Validate a golden case has all required fields
 */
function validateGoldenCase(data: GoldenCase, filePath: string): void {
  const errors: string[] = [];

  if (!data.id) {
    errors.push("Missing required field: id");
  }

  if (!data.input) {
    errors.push("Missing required field: input");
  } else {
    if (!data.input.url) {
      errors.push("Missing required field: input.url");
    }
    if (!data.input.dom_snapshot) {
      errors.push("Missing required field: input.dom_snapshot");
    }
    if (!data.input.user_query) {
      errors.push("Missing required field: input.user_query");
    }
  }

  if (!data.expected) {
    errors.push("Missing required field: expected");
  }

  if (!data.metadata) {
    errors.push("Missing required field: metadata");
  } else {
    if (!data.metadata.tags || !Array.isArray(data.metadata.tags)) {
      errors.push("Missing or invalid field: metadata.tags");
    }
    if (!data.metadata.difficulty) {
      errors.push("Missing required field: metadata.difficulty");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid golden case in ${filePath}:\n${errors.join("\n")}`,
    );
  }
}

/**
 * Get statistics about the golden dataset
 */
export function getGoldenDatasetStats(cases: GoldenCase[]): {
  total: number;
  byDifficulty: Record<string, number>;
  byTag: Record<string, number>;
  byCategory: Record<string, number>;
} {
  const stats = {
    total: cases.length,
    byDifficulty: {} as Record<string, number>,
    byTag: {} as Record<string, number>,
    byCategory: {} as Record<string, number>,
  };

  for (const testCase of cases) {
    // Count by difficulty
    const diff = testCase.metadata.difficulty;
    stats.byDifficulty[diff] = (stats.byDifficulty[diff] || 0) + 1;

    // Count by tags
    for (const tag of testCase.metadata.tags) {
      stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
    }

    // Count by category
    if (testCase.metadata.category) {
      const cat = testCase.metadata.category;
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
    }
  }

  return stats;
}

/**
 * Save a golden case to file
 */
export async function saveGoldenCase(
  testCase: GoldenCase,
  filePath?: string,
): Promise<void> {
  const targetPath = filePath || `${GOLDEN_CASES_DIR}/${testCase.id}.yaml`;

  // Convert to YAML (simple implementation)
  const yaml = convertToYaml(testCase);

  await Bun.write(targetPath, yaml);
}

/**
 * Simple YAML converter (could use a library if needed)
 */
function convertToYaml(data: GoldenCase): string {
  // For now, use JSON.stringify as a simple representation
  // In production, you'd want a proper YAML library
  return JSON.stringify(data, null, 2);
}
