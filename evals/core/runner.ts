/**
 * Evaluation Runner
 *
 * Orchestrates running evaluations against golden dataset cases.
 * Supports mock memory for testing memory-dependent scenarios.
 */

import { AgentLoop } from "../../src/background/agent/loop.js";
import { registerTools, toolRegistry } from "../../src/background/tools/index.js";
import { AgentStatus, ToolName, DomSnapshot } from "../../src/types/index.js";
import { getApiKey, loadSettingsFromEnv } from "../utils/settings.js";
import { MockMemoryBridge } from "../utils/mock-memory.js";
import {
  parseHtmlToTaggedElements,
  extractViewportTextFromHtml,
} from "../utils/dom-parser.js";
import type {
  GoldenCase,
  EvaluationResult,
  ActualToolCall,
  ActualOutcome,
  EvaluationConfig,
  MockMemoryEntry,
} from "./types.js";
import {
  calculateToolAccuracy,
  calculateTextSimilarity,
  validateOutcome,
} from "./metrics.js";
import { JudgeModel } from "./judge.js";

export interface RunnerOptions {
  model?: string;
  timeoutMs?: number;
  onProgress?: (completed: number, total: number, currentCase: string) => void;
  mockMode?: boolean;
  enableMockMemory?: boolean;
  enableJudge?: boolean;
}

/**
 * Main evaluation runner class
 */
export class EvaluationRunner {
  private options: RunnerOptions;
  private apiKey?: string;
  private judge?: JudgeModel;

  constructor(options: RunnerOptions = {}) {
    this.options = {
      timeoutMs: 60000,
      mockMode: false,
      enableMockMemory: true,
      enableJudge: true,
      ...options,
    };
  }

  /**
   * Initialize the runner with API credentials
   */
  async initialize(): Promise<void> {
    if (this.options.mockMode) {
      return;
    }

    // Register tool definitions so the LLM receives them in requests
    toolRegistry.clear();
    registerTools();

    try {
      const { apiKey } = await getApiKey();
      this.apiKey = apiKey;

      // Create judge if enabled (skipped in mock mode)
      // Judge always uses openai/gpt-5-mini via OpenRouter
      if (this.options.enableJudge) {
        const openRouterKey = await this.getOpenRouterKey();
        if (openRouterKey) {
          this.judge = new JudgeModel(openRouterKey);
        } else {
          console.warn("Judge disabled: OPENROUTER_API_KEY required for judge (uses openai/gpt-5-mini)");
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize runner: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Get OpenRouter API key for the judge model.
   * Checks .env file first, then environment variables.
   */
  private async getOpenRouterKey(): Promise<string | undefined> {
    const envSettings = await loadSettingsFromEnv();
    return envSettings.openRouterApiKey || process.env.OPENROUTER_API_KEY || undefined;
  }

  /**
   * Run evaluation on a single golden case
   */
  async runCase(testCase: GoldenCase): Promise<EvaluationResult> {
    const startTime = Date.now();
    const actualToolCalls: ActualToolCall[] = [];
    let actualText = "";
    let actualOutcome: ActualOutcome = { success: false };
    const errors: string[] = [];

    try {
      if (this.options.mockMode) {
        // In mock mode, replay expected tool calls to validate scoring pipeline
        const mockResult = this.simulateAgentResponse(testCase);
        actualToolCalls.push(...mockResult.toolCalls);
        actualText = mockResult.text;
        actualOutcome = mockResult.outcome;
      } else {
        // Real mode: Run actual agent with LLM
        if (!this.apiKey) {
          await this.initialize();
        }

        // Setup mock memory if provided
        const mockMemory =
          this.options.enableMockMemory && testCase.mock_memory
            ? new MockMemoryBridge(testCase.mock_memory)
            : null;

        const result = await this.runRealAgent(testCase, mockMemory);
        actualToolCalls.push(...result.toolCalls);
        actualText = result.text;
        actualOutcome = result.outcome;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      actualOutcome = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Calculate metrics
    const duration = Date.now() - startTime;
    const metrics = this.calculateMetrics(
      testCase,
      actualToolCalls,
      actualText,
      actualOutcome,
    );

    // Build partial result for judge evaluation
    const partialResult: EvaluationResult = {
      case_id: testCase.id,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      status: "passed", // placeholder, will be determined below
      metrics,
      details: {
        actual_tool_calls: actualToolCalls,
        expected_tool_calls: testCase.expected.tool_calls,
        actual_text: actualText,
        expected_text: testCase.expected.assistant_text,
        actual_outcome: actualOutcome,
        expected_outcome: testCase.expected.outcome,
        errors,
      },
    };

    // Run judge evaluation if enabled and not mock mode
    if (this.judge && !this.options.mockMode) {
      try {
        const verdict = await this.judge.evaluate(testCase, partialResult);
        const judgeScore =
          (verdict.task_completion + verdict.tool_selection + verdict.efficiency) / 3;
        metrics.judge_score = Math.round(judgeScore * 100) / 100;
        metrics.judge_pass = verdict.overall_pass;
        partialResult.details.judge_verdict = verdict;
      } catch {
        // Judge failure is non-fatal; continue with algorithmic scoring only
      }
    }

    // Determine overall status (now includes judge signal)
    partialResult.status = this.determineStatus(metrics, errors);

    return partialResult;
  }

  /**
   * Build a DomSnapshot from the test case HTML using the dom-parser
   */
  private buildSnapshotFromCase(testCase: GoldenCase): DomSnapshot {
    const elements = parseHtmlToTaggedElements(testCase.input.dom_snapshot);
    const viewportText = extractViewportTextFromHtml(
      testCase.input.dom_snapshot,
    );

    return {
      url: testCase.input.url,
      title: "Evaluation",
      elements,
      viewport: testCase.input.viewport || { width: 1280, height: 720 },
      viewportText,
      scroll: { x: 0, y: 0, maxY: 0 },
    };
  }

  /**
   * Run the real agent with LLM, intercepting tool execution at the
   * content-script boundary via chrome.tabs.sendMessage mock.
   */
  private async runRealAgent(
    testCase: GoldenCase,
    mockMemory: MockMemoryBridge | null,
  ): Promise<{
    toolCalls: ActualToolCall[];
    text: string;
    outcome: ActualOutcome;
  }> {
    return new Promise((resolve, reject) => {
      const toolCalls: ActualToolCall[] = [];
      let finalText = "";
      let isComplete = false;

      // Build snapshot from HTML
      const snapshot = this.buildSnapshotFromCase(testCase);

      // Save and replace chrome.tabs.sendMessage to intercept tool execution
      const originalSendMessage = (globalThis as any).chrome?.tabs?.sendMessage;

      (globalThis as any).chrome.tabs.sendMessage = async (
        tabId: number,
        message: any,
      ) => {
        if (message.type === "DOM_SNAPSHOT_REQUEST") {
          return {
            payload: {
              snapshot,
              durationMs: 1,
            },
          };
        }

        if (message.type === "TOOL_EXECUTE") {
          const toolName = message.payload.toolName as ToolName;
          const args = message.payload.args;

          // Record the tool call
          toolCalls.push({
            tool: toolName,
            params: args,
            success: true,
          });

          // Handle memory tools via mock memory bridge
          if (toolName === ToolName.MEMORY_SEARCH && mockMemory) {
            const searchResults = await mockMemory.search(args.query, 5);
            if (searchResults.length === 0) {
              return {
                payload: {
                  result: "No relevant memories found.",
                  success: true,
                  navigated: false,
                },
              };
            }
            return {
              payload: {
                result:
                  "Found memories:\n" +
                  searchResults
                    .map(
                      (r) =>
                        `- [${r.entry.category}] ${r.entry.content} (Score: ${r.score.toFixed(2)})`,
                    )
                    .join("\n"),
                success: true,
                navigated: false,
              },
            };
          }

          if (toolName === ToolName.MEMORY_ADD && mockMemory) {
            const id = await mockMemory.add(
              args.content,
              args.category || "general",
              "evals://test",
            );
            return {
              payload: {
                result: `Memory saved (ID: ${id}) from evals://test`,
                success: true,
                navigated: false,
              },
            };
          }

          // Generate mock result strings for content script tools
          let result: string;
          switch (toolName) {
            case ToolName.CLICK_ELEMENT: {
              const el = snapshot.elements.find((e) => e.tag === args.id);
              result = el
                ? `Clicked [${args.id}] ${el.tagName} "${el.text.slice(0, 40)}"`
                : `No element with tag [${args.id}]`;
              break;
            }
            case ToolName.TYPE_TEXT:
              result = `Typed "${args.text}" into [${args.id}]${args.pressEnter ? " and pressed Enter" : ""}`;
              break;
            case ToolName.SCROLL_PAGE:
              result = `Scrolled ${args.direction} by 500px`;
              break;
            case ToolName.READ_PAGE: {
              const lines = [
                `Page: Evaluation`,
                `URL: ${testCase.input.url}`,
                "",
                "Interactive elements:",
              ];
              for (const el of snapshot.elements) {
                const attrs = Object.entries(el.attributes)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join(" ");
                lines.push(
                  `  [${el.tag}] <${el.tagName}${attrs ? " " + attrs : ""}> "${el.text}"`,
                );
              }
              if (snapshot.viewportText) {
                lines.push("", "Page text:", snapshot.viewportText);
              }
              result = lines.join("\n");
              break;
            }
            case ToolName.NAVIGATE:
              result = `Navigated to ${args.url}. Call read_page to see the new content.`;
              break;
            case ToolName.HOVER_ELEMENT:
              result = `Hovered over element [${args.id}]`;
              break;
            case ToolName.FIND_ELEMENT:
              result = `Found "${args.text}"`;
              break;
            default:
              result = `${toolName} executed with params: ${JSON.stringify(args)}`;
          }

          return {
            payload: {
              result,
              success: true,
              navigated:
                toolName === ToolName.NAVIGATE ||
                (toolName === ToolName.CLICK_ELEMENT &&
                  snapshot.elements.find(
                    (e) =>
                      e.tag === args.id && e.tagName === "a",
                  ) !== undefined),
            },
          };
        }

        // Fallback
        return { payload: { result: "OK", success: true } };
      };

      // Override memory tool executors to use mock memory instead of offscreen bridge
      if (mockMemory) {
        toolRegistry.setExecutor(ToolName.MEMORY_SEARCH, async (args) => {
          const results = await mockMemory.search(args.query as string, 5);
          if (results.length === 0) return "No relevant memories found.";
          return "Found memories:\n" + results.map(r =>
            `- [${r.entry.category}] ${r.entry.content} (Score: ${r.score.toFixed(2)})`
          ).join("\n");
        });

        toolRegistry.setExecutor(ToolName.MEMORY_ADD, async (args) => {
          const id = await mockMemory.add(
            args.content as string,
            (args.category as string) || "general",
            "evals://test"
          );
          return `Memory saved (ID: ${id}) from evals://test`;
        });
      }

      // Set timeout
      const timeout = setTimeout(() => {
        if (!isComplete) {
          // Restore original mock
          if (originalSendMessage) {
            (globalThis as any).chrome.tabs.sendMessage = originalSendMessage;
          }
          reject(
            new Error(`Evaluation timed out after ${this.options.timeoutMs}ms`),
          );
        }
      }, this.options.timeoutMs);

      // Create agent loop
      const agent = new AgentLoop(this.apiKey!, {
        onStatusUpdate: (status, detail) => {
          if (status === AgentStatus.ERROR) {
            clearTimeout(timeout);
            if (originalSendMessage) {
              (globalThis as any).chrome.tabs.sendMessage = originalSendMessage;
            }
            reject(new Error(detail));
          }
          if (status === AgentStatus.IDLE) {
            // Agent finished
            isComplete = true;
          }
        },
        onMessage: (text, _calls) => {
          if (text) {
            finalText = text;
          }
        },
      });

      // Start agent — it runs its own tool loop via executeContentTool -> chrome.tabs.sendMessage
      agent
        .start(testCase.input.user_query, 123, snapshot)
        .then(() => {
          clearTimeout(timeout);
          if (originalSendMessage) {
            (globalThis as any).chrome.tabs.sendMessage = originalSendMessage;
          }

          // Check if a done tool was called
          const hasDone = toolCalls.some((tc) => tc.tool === ToolName.DONE);

          resolve({
            toolCalls,
            text: finalText,
            outcome: {
              success: hasDone || toolCalls.length > 0,
              final_url: testCase.input.url,
            },
          });
        })
        .catch((error) => {
          clearTimeout(timeout);
          if (originalSendMessage) {
            (globalThis as any).chrome.tabs.sendMessage = originalSendMessage;
          }
          reject(error);
        });
    });
  }

  /**
   * Run evaluation on multiple golden cases
   */
  async runCases(
    cases: GoldenCase[],
    options?: { concurrent?: number },
  ): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    // Process cases sequentially to avoid conflicts
    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[i];

      // Report progress
      this.options.onProgress?.(i, cases.length, testCase.id);

      // Run evaluation
      const result = await this.runCase(testCase);
      results.push(result);

      // Report progress after completion
      this.options.onProgress?.(i + 1, cases.length, testCase.id);
    }

    return results;
  }

  /**
   * Simulate agent response (mock mode).
   * Replays the golden case's expected tool calls to validate the scoring pipeline.
   * Running `bun evals --mock` should produce 100% pass rate.
   */
  private simulateAgentResponse(testCase: GoldenCase): {
    toolCalls: ActualToolCall[];
    text: string;
    outcome: ActualOutcome;
  } {
    const toolCalls: ActualToolCall[] = [];

    // Replay expected tool calls (excluding optional ones)
    if (testCase.expected.tool_calls) {
      for (const expected of testCase.expected.tool_calls) {
        if (expected.optional) continue;
        toolCalls.push({
          tool: expected.tool,
          params: { ...expected.params },
          success: true,
        });
      }
    }

    return {
      toolCalls,
      text: testCase.expected.assistant_text || "",
      outcome: {
        success: testCase.expected.outcome?.success ?? true,
        final_url: testCase.input.url,
      },
    };
  }

  /**
   * Calculate metrics for a result
   */
  private calculateMetrics(
    testCase: GoldenCase,
    actualToolCalls: ActualToolCall[],
    actualText: string,
    actualOutcome: ActualOutcome,
  ): EvaluationResult["metrics"] {
    const metrics: EvaluationResult["metrics"] = {
      steps_taken: actualToolCalls.length,
      expected_steps: testCase.metadata.expected_steps,
    };

    // Tool accuracy
    if (testCase.expected.tool_calls) {
      metrics.tool_accuracy = calculateToolAccuracy(
        testCase.expected.tool_calls,
        actualToolCalls,
      );
    }

    // Text similarity
    if (testCase.expected.assistant_text) {
      metrics.text_similarity = calculateTextSimilarity(
        testCase.expected.assistant_text,
        actualText,
      );
    }

    // Outcome match
    if (testCase.expected.outcome) {
      const outcomeValidation = validateOutcome(
        testCase.expected.outcome,
        actualOutcome,
      );
      metrics.outcome_match = outcomeValidation.valid;
    }

    return metrics;
  }

  /**
   * Determine overall pass/fail status.
   * Priority: errors > outcome_match > judge_pass > tool_accuracy > default
   * The judge acts as a "second opinion" that's more nuanced than algorithmic checks.
   */
  private determineStatus(
    metrics: EvaluationResult["metrics"],
    errors: string[],
  ): EvaluationResult["status"] {
    if (errors.length > 0) {
      return "error";
    }

    // Primary: outcome match is the strongest signal
    if (metrics.outcome_match === true) {
      return "passed";
    }

    // Judge pass overrides when outcome is not explicitly set
    if (metrics.judge_pass === true) {
      return "passed";
    }

    if (metrics.outcome_match === false) {
      return "failed";
    }

    if (metrics.judge_pass === false) {
      return "failed";
    }

    // Fallback: tool accuracy (lower threshold since alternative paths exist)
    if (metrics.tool_accuracy !== undefined) {
      return metrics.tool_accuracy >= 0.6 ? "passed" : "failed";
    }

    // Default to passed if no errors
    return "passed";
  }
}

/**
 * Run evaluations with configuration
 */
export async function runEvaluations(
  cases: GoldenCase[],
  config: EvaluationConfig,
  options?: RunnerOptions,
): Promise<EvaluationResult[]> {
  const runner = new EvaluationRunner(options);
  await runner.initialize();
  return runner.runCases(cases, { concurrent: config.max_concurrent });
}
