import { describe, expect, test } from "vitest";

import { ToolName } from "../../src/types";
import {
  restrictDelegatedWriterModel,
  restrictDelegatedWriterTool,
} from "../../src/background/orchestrator/llm-model-overrides";

describe("delegated model-role restrictions", () => {
  test("removes the Writer model and compose tool when Writer is not allowed", () => {
    expect(
      restrictDelegatedWriterModel(
        { writerModel: "provider/writer" },
        ["planner", "executor", "verifier"],
      ),
    ).toMatchObject({ writerModel: undefined });

    const tools = restrictDelegatedWriterTool(
      new Set([ToolName.DOWNLOAD_FILE]),
      ["planner", "executor", "verifier"],
    );
    expect(tools).toContain(ToolName.DOWNLOAD_FILE);
    expect(tools).toContain(ToolName.COMPOSE_TEXT);
  });

  test("preserves Writer capabilities when Writer is explicitly allowed", () => {
    const overrides = { writerModel: "provider/writer" };
    expect(
      restrictDelegatedWriterModel(overrides, [
        "planner",
        "executor",
        "verifier",
        "writer",
      ]),
    ).toBe(overrides);
    expect(
      restrictDelegatedWriterTool(new Set(), [
        "planner",
        "executor",
        "verifier",
        "writer",
      ]),
    ).not.toContain(ToolName.COMPOSE_TEXT);
  });
});
