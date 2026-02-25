import { describe, expect, test } from "vitest";
import { analyzeTraceContractCompliance } from "../../evals/contract-compliance";

describe("trace role contract compliance", () => {
  test("passes when model tier and tools match contract", () => {
    const turns = [
      {
        turnNumber: 1,
        llmRequest: { model: "openai/gpt-oss-120b" },
        toolExecutions: [{ toolName: "read_page" }, { toolName: "done" }],
        events: [
          {
            type: "execution_contract",
            data: {
              role: "executor",
              modelTier: "fast",
              initialModel: "openai/gpt-oss-120b",
              allowedTools: ["read_page", "done"],
            },
          },
        ],
      },
    ];

    const violations = analyzeTraceContractCompliance("s1", turns as any);
    expect(violations).toHaveLength(0);
  });

  test("flags model tier mismatch and tool outside contract", () => {
    const turns = [
      {
        turnNumber: 1,
        llmRequest: { model: "z-ai/glm-4.7" },
        toolExecutions: [{ toolName: "navigate" }],
        events: [
          {
            type: "execution_contract",
            data: {
              role: "executor",
              modelTier: "fast",
              initialModel: "z-ai/glm-4.7",
              allowedTools: ["read_page", "done"],
            },
          },
        ],
      },
    ];

    const violations = analyzeTraceContractCompliance("s2", turns as any);
    expect(violations.some((v) => v.type === "model_tier_mismatch")).toBe(true);
    expect(violations.some((v) => v.type === "tool_outside_contract")).toBe(true);
  });
});

