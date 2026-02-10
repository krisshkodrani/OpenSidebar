/**
 * OpenSidebar Evaluation System
 *
 * Headless evaluation framework with golden dataset support
 * and automated prompt optimization.
 */

// Core types and interfaces
export * from "./core/types.js";

// Golden dataset management
export {
  loadGoldenCase,
  loadAllGoldenCases,
  filterGoldenCases,
  getGoldenDatasetStats,
  saveGoldenCase,
} from "./core/loader.js";

// Evaluation runner
export {
  EvaluationRunner,
  runEvaluations,
  type RunnerOptions,
} from "./core/runner.js";

// Metrics calculation
export {
  calculateToolAccuracy,
  calculateTextSimilarity,
  textMatchesPattern,
  calculateStepEfficiency,
  validateOutcome,
  calculateOverallScore,
  calculateSummary,
} from "./core/metrics.js";

// Reporting
export {
  generateReport,
  generateComparisonReport,
  printToConsole,
} from "./core/reporter.js";

// Failure analysis
export {
  analyzeFailure,
  analyzeMultipleFailures,
} from "./optimizer/analyzer.js";

// Prompt suggestions
export {
  generatePromptSuggestions,
  applySuggestion,
  rankSuggestions,
  estimateSuggestionRisk,
  type SuggesterOptions,
} from "./optimizer/suggester.js";

// Improvement tracking
export {
  trackImprovement,
  loadImprovementHistory,
  getImprovementStats,
  generateImprovementReport,
  savePromptVersion,
  loadPromptVersion,
  listPromptVersions,
  type ImprovementRecord,
} from "./optimizer/tracker.js";
