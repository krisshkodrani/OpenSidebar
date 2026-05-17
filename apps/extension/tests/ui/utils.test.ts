import { describe, expect, test } from "vitest";

import { cn } from "../../src/lib/utils";

describe("cn", () => {
  test("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2 text-slate-500", false && "hidden", ["px-4", "text-slate-900"])).toBe(
      "px-4 text-slate-900",
    );
  });
});
