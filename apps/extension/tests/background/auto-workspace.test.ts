import { describe, expect, test } from "vitest";
import {
  isWorkspaceGroupTitle,
  parseWorkspaceGroupNumber,
} from "../../src/background/workspaces/manager";
import {
  colorForStatus,
  truncateTaskTitle,
} from "../../src/background/workspaces/tab-group-appearance";
import { AgentStatus } from "../../src/types";

describe("workspace group policy", () => {
  test("recognizes only exact generated workspace titles", () => {
    expect(parseWorkspaceGroupNumber("OS 1")).toBe(1);
    expect(parseWorkspaceGroupNumber("OpenSidebar 42")).toBe(42);
    expect(isWorkspaceGroupTitle("OS Project")).toBe(false);
    expect(isWorkspaceGroupTitle("OS 1 notes")).toBe(false);
    expect(isWorkspaceGroupTitle("My OpenSidebar 1")).toBe(false);
  });

  test("truncates task titles at a readable word boundary", () => {
    expect(truncateTaskTitle("  Short   task  ")).toBe("Short task");
    expect(
      truncateTaskTitle("Review every account in the quarterly report", 24),
    ).toBe("Review every account in...");
  });

  test("maps lifecycle status and outcomes to Chrome group colors", () => {
    expect(colorForStatus(AgentStatus.THINKING)).toBe("cyan");
    expect(colorForStatus(AgentStatus.ACTING)).toBe("purple");
    expect(colorForStatus(AgentStatus.PAUSED)).toBe("yellow");
    expect(colorForStatus(AgentStatus.ERROR)).toBe("red");
    expect(colorForStatus(AgentStatus.IDLE, "completed")).toBe("green");
    expect(colorForStatus(AgentStatus.IDLE, "partial")).toBe("orange");
    expect(colorForStatus(AgentStatus.IDLE, "stopped")).toBe("yellow");
  });
});
