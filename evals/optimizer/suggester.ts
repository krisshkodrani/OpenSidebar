/**
 * Prompt Suggester
 *
 * Uses LLM to suggest prompt improvements based on failure analysis.
 */

import type {
  PromptSuggestion,
  FailureAnalysis,
  EvaluationResult,
} from "../core/types.js";
import { loadSettingsFromEnv } from "../utils/settings.js";

const SUGGESTER_PROMPT_TEMPLATE = `You are an expert prompt engineer specializing in browser automation agents.

Your task is to analyze failures in an agent's performance and suggest specific improvements to the system prompt.

## Current System Prompt

\`\`\`
{current_prompt}
\`\`\`

## Recent Failures

{failures}

## Analysis

{analysis}

## Your Task

Based on the failures above, suggest 3-5 specific improvements to the system prompt.

For each suggestion:
1. Provide a clear title
2. Explain the specific change to make
3. Show the current prompt excerpt that needs changing
4. Provide the proposed new text
5. Estimate the expected impact (which cases will it fix, confidence level)

Format your response as a JSON array of suggestions:

\`\`\`json
[
  {
    "title": "Clear title of the suggestion",
    "description": "Detailed explanation of the change and why it will help",
    "current_excerpt": "The current text in the prompt",
    "proposed_change": "The new text to replace it with",
    "affected_cases": ["case-id-1", "case-id-2"],
    "expected_improvement": 0.85,
    "confidence": "high"
  }
]
\`\`\`

Guidelines:
- Be specific and actionable
- Focus on the most impactful changes first
- Ensure suggestions are grounded in the actual failures
- Don't suggest changes that are too vague or general
- Consider the trade-offs (will this change hurt other cases?)`;

export interface SuggesterOptions {
  apiKey?: string;
  model?: string;
  provider?: "openai" | "cerebras";
}

/**
 * Generate prompt suggestions based on failure analysis
 */
export async function generatePromptSuggestions(
  currentPrompt: string,
  failures: FailureAnalysis[],
  options: SuggesterOptions = {},
): Promise<PromptSuggestion[]> {
  // Format failures for the prompt
  const failuresText = failures
    .map((f, i) => {
      return `
Failure ${i + 1}: ${f.case_id}
- Type: ${f.failure_type}
- Severity: ${f.severity}
- Root Cause: ${f.root_cause}
- Expected: ${f.expected}
- Actual: ${f.actual}
- Issues: ${f.prompt_issues.map((issue) => issue.description).join(", ")}
- Suggestions: ${f.suggestions.join(", ")}
`;
    })
    .join("\n");

  // Format analysis
  const analysisText = generateAnalysisSummary(failures);

  // Build prompt
  const prompt = SUGGESTER_PROMPT_TEMPLATE.replace(
    "{current_prompt}",
    currentPrompt,
  )
    .replace("{failures}", failuresText)
    .replace("{analysis}", analysisText);

  // Call LLM
  try {
    const suggestions = await callLLM(prompt, options);
    return suggestions.map((s, i) => ({
      id: `suggestion-${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
      ...s,
      applied: false,
    }));
  } catch (error) {
    console.error("Failed to generate suggestions:", error);
    return [];
  }
}

/**
 * Generate summary of failure analysis
 */
function generateAnalysisSummary(failures: FailureAnalysis[]): string {
  const typeCounts: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};

  for (const failure of failures) {
    // Count failure types
    typeCounts[failure.failure_type] =
      (typeCounts[failure.failure_type] || 0) + 1;

    // Count prompt issues
    for (const issue of failure.prompt_issues) {
      issueCounts[issue.description] =
        (issueCounts[issue.description] || 0) + 1;
    }
  }

  const summary = [
    `Total failures: ${failures.length}`,
    "",
    "Failure types:",
    ...Object.entries(typeCounts).map(
      ([type, count]) => `  - ${type}: ${count}`,
    ),
    "",
    "Common prompt issues:",
    ...Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue, count]) => `  - ${issue}: ${count} occurrences`),
  ];

  return summary.join("\n");
}

/**
 * Call LLM to get suggestions
 */
async function callLLM(
  prompt: string,
  options: SuggesterOptions,
): Promise<Omit<PromptSuggestion, "id" | "timestamp" | "applied">[]> {
  // Try to get API key from options, env, or .env file
  let apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    // Try loading from .env file
    const envSettings = await loadSettingsFromEnv();
    apiKey = envSettings.openRouterApiKey || envSettings.cerebrasApiKey;
  }

  if (!apiKey) {
    throw new Error(
      "API key required for prompt suggestions. Set OPENAI_API_KEY environment variable " +
        "or add OPENROUTER_API_KEY/CEREBRAS_API_KEY to .env file",
    );
  }

  const provider = options.provider || "openai";
  const model = options.model || "gpt-4";

  let response: Response;

  if (provider === "openai") {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert prompt engineer. Respond only with valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });
  } else {
    throw new Error(`Provider ${provider} not yet implemented`);
  }

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || "";

  // Extract JSON from response
  const jsonMatch =
    content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\[([\s\S]*)\]/);

  if (!jsonMatch) {
    throw new Error("Could not parse JSON from LLM response");
  }

  const jsonStr = jsonMatch[1] || jsonMatch[0];
  return JSON.parse(jsonStr);
}

/**
 * Apply a suggestion to the current prompt
 */
export function applySuggestion(
  currentPrompt: string,
  suggestion: PromptSuggestion,
): string {
  // Simple string replacement
  // In production, you might want more sophisticated merging
  const newPrompt = currentPrompt.replace(
    suggestion.current_prompt_excerpt,
    suggestion.proposed_change,
  );

  // Mark as applied
  suggestion.applied = true;
  suggestion.applied_at = new Date().toISOString();

  return newPrompt;
}

/**
 * Rank suggestions by expected impact
 */
export function rankSuggestions(
  suggestions: PromptSuggestion[],
  criteria:
    | "confidence"
    | "affected_cases"
    | "expected_improvement" = "expected_improvement",
): PromptSuggestion[] {
  return [...suggestions].sort((a, b) => {
    switch (criteria) {
      case "confidence":
        const confOrder = { high: 3, medium: 2, low: 1 };
        return confOrder[b.impact.confidence] - confOrder[a.impact.confidence];

      case "affected_cases":
        return b.impact.affected_cases.length - a.impact.affected_cases.length;

      case "expected_improvement":
      default:
        return b.impact.expected_improvement - a.impact.expected_improvement;
    }
  });
}

/**
 * Estimate risk of applying a suggestion
 */
export function estimateSuggestionRisk(
  suggestion: PromptSuggestion,
  allResults: EvaluationResult[],
): "low" | "medium" | "high" {
  // High risk if:
  // - Affects many passing cases
  // - Makes broad changes to the prompt
  // - Low confidence

  const affectedCount = suggestion.impact.affected_cases.length;
  const changeSize = suggestion.proposed_change.length;
  const confidence = suggestion.impact.confidence;

  if (confidence === "low" || changeSize > 500) {
    return "high";
  }

  if (affectedCount > 10 || changeSize > 200) {
    return "medium";
  }

  return "low";
}
