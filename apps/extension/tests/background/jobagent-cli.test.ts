/**
 * JobAgent CLI — offline unit tests for the verb surface's pure parts.
 *
 * The verbs themselves are thin HTTP calls over routes already covered by
 * jobagent-console-server.test.ts; what needs its own coverage is the layer
 * a skill actually depends on: argument parsing (a misparsed `--promote`
 * silently changes what gets frozen) and the rendering helpers (an agent
 * reads this output as data).
 */
import { describe, expect, test } from "vitest";

import { parseArgs, verbs } from "../../../../scripts/jobagent-console/cli";
import {
  at,
  fields,
  table,
  took,
} from "../../../../scripts/jobagent-console/cli-format";

describe("parseArgs", () => {
  test("separates positionals from the three flag forms", () => {
    const args = parseArgs([
      "acme-ai-engineer",
      "--promote",
      "--mode=submit",
      "--questions",
      "q.json",
    ]);
    expect(args.positional).toEqual(["acme-ai-engineer"]);
    expect(args.flags).toEqual({
      promote: true,
      mode: "submit",
      questions: "q.json",
    });
  });

  test("a bare trailing flag is true, not the next flag's name", () => {
    expect(parseArgs(["--follow", "--json"]).flags).toEqual({
      follow: true,
      json: true,
    });
  });

  test("empty argv yields no positionals and no flags", () => {
    expect(parseArgs([])).toEqual({ positional: [], flags: {} });
  });
});

describe("verb surface", () => {
  test("every documented pipeline stage has a verb with help text", () => {
    for (const name of [
      "status",
      "queue",
      "show",
      "criteria",
      "answers",
      "draft",
      "approve-kit",
      "discover",
      "fill",
      "submit",
      "approvals",
      "decide",
      "serve",
    ]) {
      expect(verbs[name], `missing verb ${name}`).toBeDefined();
      expect(verbs[name].help.length).toBeGreaterThan(0);
    }
  });

  test("submit and decide advertise the human gate", () => {
    expect(verbs.submit.help).toContain("approval");
    expect(verbs.decide.help).toContain("human gate");
  });
});

describe("rendering", () => {
  test("table aligns columns and renders gaps as em dashes", () => {
    const rendered = table(
      [
        { name: "acme", status: "ready" },
        { name: "a-much-longer-name", status: undefined },
      ],
      ["name", "status"],
    );
    const [header, rule, first, second] = rendered.split("\n");
    expect(header.startsWith("name")).toBe(true);
    expect(rule).toContain("---");
    expect(first).toContain("acme");
    expect(second).toContain("—");
    // Column two starts at the same offset on every row.
    expect(first.indexOf("ready")).toBe(header.indexOf("status"));
  });

  test("table renders the empty hint rather than a bare header", () => {
    expect(table([], ["name"], "(no packages)")).toBe("(no packages)");
  });

  test("fields aligns keys and stringifies arrays", () => {
    expect(fields({ a: 1, longer: ["x", "y"] })).toBe("a       1\nlonger  x, y");
  });

  test("took reports running, seconds, then minutes", () => {
    expect(took(0)).toBe("running");
    expect(took(0, 54_000)).toBe("54s");
    expect(took(0, 125_000)).toBe("2m05s");
  });

  test("at renders a stable timestamp and tolerates undefined", () => {
    expect(at(0)).toBe("1970-01-01 00:00:00");
    expect(at(undefined)).toBe("—");
  });
});
