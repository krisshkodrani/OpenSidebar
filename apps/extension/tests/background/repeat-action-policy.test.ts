import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  assessRepeatAction,
  rememberRepeatAction,
  type RecentToolCall,
} from "../../src/background/agent/repeat-action-policy";

describe("repeat action policy", () => {
  test("skips tracking exempt tools", () => {
    expect(
      assessRepeatAction({
        toolName: ToolName.READ_PAGE,
        argsKey: "{}",
        recentToolCalls: [],
        isExempt: false,
        allowFinalClickBypass: () => false,
      }),
    ).toEqual({ action: "skip_tracking" });
  });

  test("allows tracked actions before the repeat threshold", () => {
    expect(
      assessRepeatAction({
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        recentToolCalls: [
          { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
        ],
        isExempt: false,
        allowFinalClickBypass: () => false,
      }),
    ).toEqual({ action: "allow" });
  });

  test("blocks the third matching tracked action", () => {
    const decision = assessRepeatAction({
      toolName: ToolName.CLICK_ELEMENT,
      argsKey: '{"id":1}',
      recentToolCalls: [
        { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
        { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
      ],
      isExempt: false,
      allowFinalClickBypass: () => false,
    });

    expect(decision).toMatchObject({
      action: "block",
      repeatCount: 3,
    });
    expect(decision).toHaveProperty(
      "message",
      expect.stringContaining("Repeated click_element without progress"),
    );
  });

  test("allows a final-click bypass at the repeat threshold", () => {
    expect(
      assessRepeatAction({
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        recentToolCalls: [
          { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
          { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
        ],
        isExempt: false,
        allowFinalClickBypass: () => true,
      }),
    ).toEqual({ action: "allow_final_click_bypass" });
  });

  test("only evaluates final-click bypass after the repeat threshold", () => {
    let bypassChecks = 0;

    assessRepeatAction({
      toolName: ToolName.CLICK_ELEMENT,
      argsKey: '{"id":1}',
      recentToolCalls: [],
      isExempt: false,
      allowFinalClickBypass: () => {
        bypassChecks++;
        return false;
      },
    });

    expect(bypassChecks).toBe(0);
  });

  test("remembers tracked actions within the configured window", () => {
    const recentToolCalls: RecentToolCall[] = [
      { tool: ToolName.TYPE_TEXT, argsKey: "old" },
    ];

    rememberRepeatAction(
      recentToolCalls,
      ToolName.CLICK_ELEMENT,
      '{"id":1}',
      1,
    );

    expect(recentToolCalls).toEqual([
      { tool: ToolName.CLICK_ELEMENT, argsKey: '{"id":1}' },
    ]);
  });
});
