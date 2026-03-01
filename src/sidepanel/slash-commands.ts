/**
 * Slash Command Parser — maps chat input like "/click 5" to ManualToolExecuteMessage payloads.
 *
 * Pure functions: no side effects, no chrome APIs, no React.
 */

import { ToolName, ManualCommand } from "../types";

// --- Types ---

export interface ParsedCommand {
  command: ManualCommand;
  toolName?: ToolName;
  args?: Record<string, unknown>;
  objective?: string;
  recordName?: string;
}

export interface CommandHint {
  name: string;
  syntax: string;
  description: string;
}

// --- Command Table ---

interface CommandDef {
  command: ManualCommand;
  syntax: string;
  description: string;
  parse: (tokens: string[]) => ParsedCommand | string; // string = error
}

const COMMAND_TABLE: Record<string, CommandDef> = {
  click: {
    command: "tool",
    syntax: "/click <id>",
    description: "Click element by tag ID",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (isNaN(id)) return "Usage: /click <id> — element tag ID required";
      return {
        command: "tool",
        toolName: ToolName.CLICK_ELEMENT,
        args: { id },
      };
    },
  },
  type: {
    command: "tool",
    syntax: "/type <id> <text>",
    description: "Type text into element",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (isNaN(id)) return "Usage: /type <id> <text>";
      const text = tokens.slice(1).join(" ");
      if (!text) return "Usage: /type <id> <text> — text required";
      return {
        command: "tool",
        toolName: ToolName.TYPE_TEXT,
        args: { id, text },
      };
    },
  },
  scroll: {
    command: "tool",
    syntax: "/scroll <up|down> [amount]",
    description: "Scroll page up or down",
    parse: (tokens) => {
      const direction = tokens[0]?.toLowerCase();
      if (!direction || !["up", "down", "top", "bottom"].includes(direction)) {
        return "Usage: /scroll <up|down|top|bottom> [amount]";
      }
      const args: Record<string, unknown> = { direction };
      const amount = parseInt(tokens[1], 10);
      if (!isNaN(amount)) args.amount = amount;
      return { command: "tool", toolName: ToolName.SCROLL_PAGE, args };
    },
  },
  select: {
    command: "tool",
    syntax: "/select <id> <value>",
    description: "Select option in dropdown",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (isNaN(id)) return "Usage: /select <id> <value>";
      const value = tokens.slice(1).join(" ");
      if (!value) return "Usage: /select <id> <value> — value required";
      return {
        command: "tool",
        toolName: ToolName.SELECT_OPTION,
        args: { id, value },
      };
    },
  },
  hover: {
    command: "tool",
    syntax: "/hover <id>",
    description: "Hover over element",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (isNaN(id)) return "Usage: /hover <id>";
      return {
        command: "tool",
        toolName: ToolName.HOVER_ELEMENT,
        args: { id },
      };
    },
  },
  key: {
    command: "tool",
    syntax: "/key <key> [+modifier]",
    description: "Press a keyboard key",
    parse: (tokens) => {
      if (!tokens[0]) return "Usage: /key <key> [+modifier]";
      const parts = tokens
        .join(" ")
        .split("+")
        .map((s) => s.trim());
      const key = parts[0];
      const args: Record<string, unknown> = { key };
      if (parts.length > 1) args.modifiers = parts.slice(1);
      return { command: "tool", toolName: ToolName.PRESS_KEY, args };
    },
  },
  find: {
    command: "tool",
    syntax: "/find <text>",
    description: "Find element by text",
    parse: (tokens) => {
      const text = tokens.join(" ");
      if (!text) return "Usage: /find <text>";
      return {
        command: "tool",
        toolName: ToolName.FIND_ELEMENT,
        args: { text },
      };
    },
  },
  navigate: {
    command: "tool",
    syntax: "/navigate <url>",
    description: "Navigate to URL",
    parse: (tokens) => {
      const url = tokens[0];
      if (!url) return "Usage: /navigate <url>";
      return { command: "tool", toolName: ToolName.NAVIGATE, args: { url } };
    },
  },
  back: {
    command: "tool",
    syntax: "/back",
    description: "Go back in history",
    parse: () => ({ command: "tool", toolName: ToolName.GO_BACK, args: {} }),
  },
  read: {
    command: "tool",
    syntax: "/read [id]",
    description: "Read page or element content",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (!isNaN(id)) {
        return {
          command: "tool",
          toolName: ToolName.READ_ELEMENT,
          args: { id },
        };
      }
      return { command: "tool", toolName: ToolName.READ_PAGE, args: {} };
    },
  },
  hide: {
    command: "tool",
    syntax: "/hide <id>",
    description: "Hide element from page",
    parse: (tokens) => {
      const id = parseInt(tokens[0], 10);
      if (isNaN(id)) return "Usage: /hide <id>";
      return { command: "tool", toolName: ToolName.HIDE_ELEMENT, args: { id } };
    },
  },
  dismiss: {
    command: "dismiss",
    syntax: "/dismiss",
    description: "Dismiss modals and popups",
    parse: () => ({ command: "dismiss" }),
  },
  js: {
    command: "tool",
    syntax: "/js <code>",
    description: "Execute JavaScript on page",
    parse: (tokens) => {
      const code = tokens.join(" ");
      if (!code) return "Usage: /js <code>";
      return { command: "tool", toolName: ToolName.EXECUTE_JS, args: { code } };
    },
  },
  tool: {
    command: "tool",
    syntax: "/tool <name> <json>",
    description: "Execute any tool with JSON args",
    parse: (tokens) => {
      const name = tokens[0];
      if (!name) return "Usage: /tool <name> <json_args>";
      const jsonStr = tokens.slice(1).join(" ") || "{}";
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(jsonStr);
      } catch {
        return `Invalid JSON: ${jsonStr}`;
      }
      return { command: "tool", toolName: name as ToolName, args };
    },
  },
  perceive: {
    command: "perceive",
    syntax: "/perceive [objective]",
    description: "Run vision perception on current page",
    parse: (tokens) => {
      const objective = tokens.join(" ") || undefined;
      return { command: "perceive", objective };
    },
  },
  snapshot: {
    command: "snapshot",
    syntax: "/snapshot",
    description: "Show tagged elements list",
    parse: () => ({ command: "snapshot" }),
  },
  screenshot: {
    command: "screenshot",
    syntax: "/screenshot",
    description: "Capture and show screenshot",
    parse: () => ({ command: "screenshot" }),
  },
  record: {
    command: "record",
    syntax: "/record [name]",
    description: "Toggle trace recording (start/stop)",
    parse: (tokens) => {
      const recordName = tokens.join(" ") || undefined;
      return { command: "record", recordName };
    },
  },
  tags: {
    command: "tags",
    syntax: "/tags",
    description: "Toggle element tag overlay",
    parse: () => ({ command: "tags" }),
  },
  help: {
    command: "help",
    syntax: "/help",
    description: "List all slash commands",
    parse: () => ({ command: "help" }),
  },
};

// --- Public API ---

/** Check if input starts with a slash command */
export function isSlashCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;
  const name = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
  return name in COMMAND_TABLE;
}

/** Parse a slash command string. Returns ParsedCommand on success, error string on failure. */
export function parseSlashCommand(input: string): ParsedCommand | string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return "Not a slash command";

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0].toLowerCase();
  const tokens = parts.slice(1);

  const def = COMMAND_TABLE[name];
  if (!def)
    return `Unknown command: /${name}. Type /help for available commands.`;

  return def.parse(tokens);
}

/** Get autocomplete hints for a partial command string */
export function getCommandCompletions(partial: string): CommandHint[] {
  const trimmed = partial.trim();
  if (!trimmed.startsWith("/")) return [];

  const prefix = trimmed.slice(1).toLowerCase().split(/\s+/)[0];

  return Object.entries(COMMAND_TABLE)
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, def]) => ({
      name: `/${name}`,
      syntax: def.syntax,
      description: def.description,
    }));
}

/** Get the full help text listing all commands */
export function getHelpText(): string {
  const lines = Object.values(COMMAND_TABLE).map(
    (def) => `${def.syntax.padEnd(30)} ${def.description}`,
  );
  return ["Available commands:", "", ...lines].join("\n");
}
