/**
 * Improvement Tracker
 *
 * Tracks prompt improvements and their effects over time.
 */

import type {
  PromptSuggestion,
  PromptVersion,
  EvaluationSummary,
} from "../core/types.js";
import { readdir } from "fs/promises";

const HISTORY_FILE = "./evals/golden/history/improvements.json";

export interface ImprovementRecord {
  id: string;
  timestamp: string;
  prompt_version: string;
  suggestion_id: string;
  metrics_before: Record<string, number>;
  metrics_after: Record<string, number>;
  delta: Record<string, number>;
  cases_affected: {
    improved: string[];
    regressed: string[];
    unchanged: string[];
  };
}

/**
 * Track a prompt improvement
 */
export async function trackImprovement(
  suggestion: PromptSuggestion,
  metricsBefore: EvaluationSummary,
  metricsAfter: EvaluationSummary,
  affectedCases: {
    improved: string[];
    regressed: string[];
    unchanged: string[];
  },
): Promise<ImprovementRecord> {
  const record: ImprovementRecord = {
    id: `imp-${Date.now()}`,
    timestamp: new Date().toISOString(),
    prompt_version: suggestion.id,
    suggestion_id: suggestion.id,
    metrics_before: extractMetrics(metricsBefore),
    metrics_after: extractMetrics(metricsAfter),
    delta: calculateDelta(
      extractMetrics(metricsBefore),
      extractMetrics(metricsAfter),
    ),
    cases_affected: affectedCases,
  };

  // Save to history
  await saveImprovementRecord(record);

  // Update suggestion with results
  suggestion.results = {
    before_metrics: record.metrics_before,
    after_metrics: record.metrics_after,
  };

  return record;
}

/**
 * Extract key metrics from summary
 */
function extractMetrics(summary: EvaluationSummary): Record<string, number> {
  return {
    total_cases: summary.total_cases,
    pass_rate: summary.passed / summary.total_cases,
    avg_duration_ms: summary.avg_duration_ms,
    avg_tool_accuracy: summary.avg_tool_accuracy || 0,
    avg_text_similarity: summary.avg_text_similarity || 0,
  };
}

/**
 * Calculate delta between before and after
 */
function calculateDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const delta: Record<string, number> = {};

  for (const key of Object.keys(before)) {
    if (key in after) {
      delta[`${key}_delta`] = after[key] - before[key];
    }
  }

  return delta;
}

/**
 * Save improvement record to history
 */
async function saveImprovementRecord(record: ImprovementRecord): Promise<void> {
  try {
    // Load existing history
    let history: ImprovementRecord[] = [];
    const file = Bun.file(HISTORY_FILE);

    if (await file.exists()) {
      const content = await file.text();
      history = JSON.parse(content);
    }

    // Add new record
    history.push(record);

    // Save back
    await Bun.write(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error("Failed to save improvement record:", error);
  }
}

/**
 * Load improvement history
 */
export async function loadImprovementHistory(): Promise<ImprovementRecord[]> {
  try {
    const file = Bun.file(HISTORY_FILE);

    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to load improvement history:", error);
    return [];
  }
}

/**
 * Get improvement statistics
 */
export async function getImprovementStats(): Promise<{
  total_improvements: number;
  avg_improvement_rate: number;
  total_cases_improved: number;
  total_cases_regressed: number;
  best_improvement: ImprovementRecord | null;
  worst_regression: ImprovementRecord | null;
}> {
  const history = await loadImprovementHistory();

  if (history.length === 0) {
    return {
      total_improvements: 0,
      avg_improvement_rate: 0,
      total_cases_improved: 0,
      total_cases_regressed: 0,
      best_improvement: null,
      worst_regression: null,
    };
  }

  // Calculate statistics
  const passRateDeltas = history.map((h) => h.delta["pass_rate_delta"] || 0);
  const avgImprovementRate =
    passRateDeltas.reduce((a, b) => a + b, 0) / passRateDeltas.length;

  const totalCasesImproved = history.reduce(
    (sum, h) => sum + h.cases_affected.improved.length,
    0,
  );
  const totalCasesRegressed = history.reduce(
    (sum, h) => sum + h.cases_affected.regressed.length,
    0,
  );

  // Find best and worst
  const sortedByImprovement = [...history].sort(
    (a, b) =>
      (b.delta["pass_rate_delta"] || 0) - (a.delta["pass_rate_delta"] || 0),
  );

  return {
    total_improvements: history.length,
    avg_improvement_rate: avgImprovementRate,
    total_cases_improved: totalCasesImproved,
    total_cases_regressed: totalCasesRegressed,
    best_improvement: sortedByImprovement[0] || null,
    worst_regression:
      sortedByImprovement[sortedByImprovement.length - 1] || null,
  };
}

/**
 * Save a prompt version
 */
export async function savePromptVersion(version: PromptVersion): Promise<void> {
  const filePath = `./evals/golden/prompts/system-prompt-v${version.version}.yaml`;

  // Simple YAML format
  const yaml = `
version: ${version.version}
created_at: ${version.created_at}
${version.parent_version ? `parent_version: ${version.parent_version}` : ""}
${version.change_description ? `change_description: ${version.change_description}` : ""}

content: |
${version.content
  .split("\n")
  .map((line) => "  " + line)
  .join("\n")}

metrics:
  golden_success_rate: ${version.metrics?.golden_success_rate || 0}
  avg_latency_ms: ${version.metrics?.avg_latency_ms || 0}
  total_evaluations: ${version.metrics?.total_evaluations || 0}
`;

  await Bun.write(filePath, yaml);
}

/**
 * Load a prompt version
 */
export async function loadPromptVersion(
  version: string,
): Promise<PromptVersion | null> {
  try {
    const filePath = `./evals/golden/prompts/system-prompt-v${version}.yaml`;
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return null;
    }

    const content = await file.text();
    // Simple parsing - in production, use a YAML parser
    const lines = content.split("\n");

    const promptVersion: PromptVersion = {
      version,
      content: "",
      created_at: "",
    };

    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("created_at:")) {
        promptVersion.created_at = line.split(": ")[1];
      } else if (line.startsWith("parent_version:")) {
        promptVersion.parent_version = line.split(": ")[1];
      } else if (line.startsWith("change_description:")) {
        promptVersion.change_description = line.split(": ")[1];
      } else if (line === "content: |") {
        inContent = true;
      } else if (inContent) {
        if (line.startsWith("  ")) {
          contentLines.push(line.slice(2));
        } else if (line === "") {
          contentLines.push("");
        } else {
          inContent = false;
        }
      }
    }

    promptVersion.content = contentLines.join("\n");
    return promptVersion;
  } catch (error) {
    console.error(`Failed to load prompt version ${version}:`, error);
    return null;
  }
}

/**
 * List all prompt versions
 */
export async function listPromptVersions(): Promise<string[]> {
  try {
    const files = await readdir("./evals/golden/prompts");
    const versions: string[] = [];

    for (const file of files) {
      const match = file.match(/system-prompt-v([\d.]+)\.yaml/);
      if (match) {
        versions.push(match[1]);
      }
    }

    return versions.sort((a, b) => {
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return bVal - aVal;
      }
      return 0;
    });
  } catch {
    return [];
  }
}

/**
 * Generate improvement report
 */
export async function generateImprovementReport(): Promise<string> {
  const stats = await getImprovementStats();
  const history = await loadImprovementHistory();

  const lines: string[] = [];
  lines.push("# Prompt Optimization Report");
  lines.push("");
  lines.push("## Summary Statistics");
  lines.push("");
  lines.push(`- **Total Improvements**: ${stats.total_improvements}`);
  lines.push(
    `- **Average Improvement Rate**: ${(stats.avg_improvement_rate * 100).toFixed(1)}%`,
  );
  lines.push(`- **Total Cases Improved**: ${stats.total_cases_improved}`);
  lines.push(`- **Total Cases Regressed**: ${stats.total_cases_regressed}`);
  lines.push("");

  if (stats.best_improvement) {
    lines.push("## Best Improvement");
    lines.push("");
    lines.push(
      `- **Prompt Version**: ${stats.best_improvement.prompt_version}`,
    );
    lines.push(
      `- **Pass Rate Delta**: +${(stats.best_improvement.delta["pass_rate_delta"] * 100).toFixed(1)}%`,
    );
    lines.push(
      `- **Cases Improved**: ${stats.best_improvement.cases_affected.improved.length}`,
    );
    lines.push("");
  }

  if (history.length > 0) {
    lines.push("## Recent Changes");
    lines.push("");

    for (const record of history.slice(-5).reverse()) {
      const passRateDelta = record.delta["pass_rate_delta"] || 0;
      const icon = passRateDelta >= 0 ? "📈" : "📉";
      lines.push(`### ${icon} ${record.prompt_version}`);
      lines.push(
        `- **Date**: ${new Date(record.timestamp).toLocaleDateString()}`,
      );
      lines.push(
        `- **Pass Rate Change**: ${passRateDelta >= 0 ? "+" : ""}${(passRateDelta * 100).toFixed(1)}%`,
      );
      lines.push(
        `- **Improved**: ${record.cases_affected.improved.length} cases`,
      );
      lines.push(
        `- **Regressed**: ${record.cases_affected.regressed.length} cases`,
      );
      lines.push("");
    }
  }

  return lines.join("\n");
}
