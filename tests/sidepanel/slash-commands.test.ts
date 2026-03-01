import { describe, test, expect } from "vitest";
import "../setup";
import {
  isSlashCommand,
  parseSlashCommand,
  getCommandCompletions,
  getHelpText,
} from "../../src/sidepanel/slash-commands";
import { ToolName } from "../../src/types";

describe("isSlashCommand", () => {
  test("returns true for valid commands", () => {
    expect(isSlashCommand("/click 5")).toBe(true);
    expect(isSlashCommand("/type 3 hello")).toBe(true);
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/perceive")).toBe(true);
    expect(isSlashCommand("/snapshot")).toBe(true);
    expect(isSlashCommand("/screenshot")).toBe(true);
    expect(isSlashCommand("/record test")).toBe(true);
    expect(isSlashCommand("/tags")).toBe(true);
    expect(isSlashCommand("/dismiss")).toBe(true);
    expect(isSlashCommand("/scroll down")).toBe(true);
    expect(isSlashCommand("/navigate https://example.com")).toBe(true);
    expect(isSlashCommand("/back")).toBe(true);
    expect(isSlashCommand("/tool click_element {}")).toBe(true);
  });

  test("returns false for non-commands", () => {
    expect(isSlashCommand("hello")).toBe(false);
    expect(isSlashCommand("click 5")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
    expect(isSlashCommand("/unknown")).toBe(false);
    expect(isSlashCommand("/xyz stuff")).toBe(false);
  });

  test("handles leading/trailing whitespace", () => {
    expect(isSlashCommand("  /click 5  ")).toBe(true);
    expect(isSlashCommand("  /help  ")).toBe(true);
  });
});

describe("parseSlashCommand", () => {
  test("parses /click <id>", () => {
    const result = parseSlashCommand("/click 5");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 5 },
    });
  });

  test("parses /type <id> <text>", () => {
    const result = parseSlashCommand("/type 3 hello world");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.TYPE_TEXT,
      args: { id: 3, text: "hello world" },
    });
  });

  test("parses /scroll <direction>", () => {
    const result = parseSlashCommand("/scroll down");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.SCROLL_PAGE,
      args: { direction: "down" },
    });
  });

  test("parses /scroll <direction> <amount>", () => {
    const result = parseSlashCommand("/scroll up 500");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.SCROLL_PAGE,
      args: { direction: "up", amount: 500 },
    });
  });

  test("parses /select <id> <value>", () => {
    const result = parseSlashCommand("/select 7 Option A");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.SELECT_OPTION,
      args: { id: 7, value: "Option A" },
    });
  });

  test("parses /hover <id>", () => {
    const result = parseSlashCommand("/hover 12");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.HOVER_ELEMENT,
      args: { id: 12 },
    });
  });

  test("parses /key <key>", () => {
    const result = parseSlashCommand("/key Enter");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.PRESS_KEY,
      args: { key: "Enter" },
    });
  });

  test("parses /key with modifier", () => {
    const result = parseSlashCommand("/key a+Control");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.PRESS_KEY,
      args: { key: "a", modifiers: ["Control"] },
    });
  });

  test("parses /find <text>", () => {
    const result = parseSlashCommand("/find Submit button");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.FIND_ELEMENT,
      args: { text: "Submit button" },
    });
  });

  test("parses /navigate <url>", () => {
    const result = parseSlashCommand("/navigate https://example.com");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.NAVIGATE,
      args: { url: "https://example.com" },
    });
  });

  test("parses /back", () => {
    const result = parseSlashCommand("/back");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.GO_BACK,
      args: {},
    });
  });

  test("parses /read (no args — reads page)", () => {
    const result = parseSlashCommand("/read");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.READ_PAGE,
      args: {},
    });
  });

  test("parses /read <id> (reads element)", () => {
    const result = parseSlashCommand("/read 5");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.READ_ELEMENT,
      args: { id: 5 },
    });
  });

  test("parses /hide <id>", () => {
    const result = parseSlashCommand("/hide 8");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.HIDE_ELEMENT,
      args: { id: 8 },
    });
  });

  test("parses /dismiss", () => {
    const result = parseSlashCommand("/dismiss");
    expect(result).toEqual({ command: "dismiss" });
  });

  test("parses /js <code>", () => {
    const result = parseSlashCommand("/js document.title");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.EXECUTE_JS,
      args: { code: "document.title" },
    });
  });

  test("parses /tool escape hatch with JSON", () => {
    const result = parseSlashCommand('/tool click_element {"id": 5}');
    expect(result).toEqual({
      command: "tool",
      toolName: "click_element",
      args: { id: 5 },
    });
  });

  test("parses /tool with no JSON (defaults to {})", () => {
    const result = parseSlashCommand("/tool go_back");
    expect(result).toEqual({
      command: "tool",
      toolName: "go_back",
      args: {},
    });
  });

  test("parses /perceive with no objective", () => {
    const result = parseSlashCommand("/perceive");
    expect(result).toEqual({
      command: "perceive",
      objective: undefined,
    });
  });

  test("parses /perceive with objective", () => {
    const result = parseSlashCommand("/perceive Find the login form");
    expect(result).toEqual({
      command: "perceive",
      objective: "Find the login form",
    });
  });

  test("parses /snapshot", () => {
    expect(parseSlashCommand("/snapshot")).toEqual({ command: "snapshot" });
  });

  test("parses /screenshot", () => {
    expect(parseSlashCommand("/screenshot")).toEqual({ command: "screenshot" });
  });

  test("parses /record with name", () => {
    const result = parseSlashCommand("/record test-session");
    expect(result).toEqual({
      command: "record",
      recordName: "test-session",
    });
  });

  test("parses /record with no name", () => {
    const result = parseSlashCommand("/record");
    expect(result).toEqual({
      command: "record",
      recordName: undefined,
    });
  });

  test("parses /tags", () => {
    expect(parseSlashCommand("/tags")).toEqual({ command: "tags" });
  });

  test("parses /help", () => {
    expect(parseSlashCommand("/help")).toEqual({ command: "help" });
  });

  // --- Error Cases ---

  test("returns error for unknown command", () => {
    const result = parseSlashCommand("/foobar");
    expect(typeof result).toBe("string");
    expect(result).toContain("Unknown command");
  });

  test("returns error for /click with no id", () => {
    const result = parseSlashCommand("/click");
    expect(typeof result).toBe("string");
    expect(result).toContain("Usage");
  });

  test("returns error for /type with no text", () => {
    const result = parseSlashCommand("/type 3");
    expect(typeof result).toBe("string");
    expect(result).toContain("Usage");
  });

  test("returns error for /scroll with invalid direction", () => {
    const result = parseSlashCommand("/scroll left");
    expect(typeof result).toBe("string");
    expect(result).toContain("Usage");
  });

  test("returns error for /tool with invalid JSON", () => {
    const result = parseSlashCommand("/tool click_element {bad json}");
    expect(typeof result).toBe("string");
    expect(result).toContain("Invalid JSON");
  });

  test("returns error for non-slash input", () => {
    const result = parseSlashCommand("hello world");
    expect(typeof result).toBe("string");
    expect(result).toContain("Not a slash command");
  });

  test("is case-insensitive for command name", () => {
    const result = parseSlashCommand("/CLICK 5");
    expect(result).toEqual({
      command: "tool",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 5 },
    });
  });
});

describe("getCommandCompletions", () => {
  test("returns completions for partial command", () => {
    const hints = getCommandCompletions("/cl");
    expect(hints.length).toBe(1);
    expect(hints[0].name).toBe("/click");
  });

  test("returns multiple completions for ambiguous prefix", () => {
    const hints = getCommandCompletions("/s");
    const names = hints.map((h) => h.name);
    expect(names).toContain("/scroll");
    expect(names).toContain("/select");
    expect(names).toContain("/snapshot");
    expect(names).toContain("/screenshot");
  });

  test("returns all commands for just /", () => {
    const hints = getCommandCompletions("/");
    expect(hints.length).toBeGreaterThan(10);
  });

  test("returns empty for non-slash input", () => {
    expect(getCommandCompletions("hello")).toEqual([]);
    expect(getCommandCompletions("")).toEqual([]);
  });

  test("each hint has name, syntax, description", () => {
    const hints = getCommandCompletions("/h");
    for (const hint of hints) {
      expect(hint.name).toBeTruthy();
      expect(hint.syntax).toBeTruthy();
      expect(hint.description).toBeTruthy();
    }
  });
});

describe("getHelpText", () => {
  test("lists all commands", () => {
    const text = getHelpText();
    expect(text).toContain("/click");
    expect(text).toContain("/type");
    expect(text).toContain("/perceive");
    expect(text).toContain("/help");
    expect(text).toContain("/record");
    expect(text).toContain("/snapshot");
    expect(text).toContain("Available commands");
  });
});
