import { describe, test, expect } from "bun:test";
import { classifyMemoryType } from "../../src/offscreen/memory/classify";

describe("classifyMemoryType", () => {
  test("classifies procedural content as procedure", () => {
    const r1 = classifyMemoryType("Step 1: click the button. Then type the text.");
    expect(r1.type).toBe("procedure");
    expect(r1.confidence).toBe(0.8);

    const r2 = classifyMemoryType("How to log in: navigate to /login, type credentials");
    expect(r2.type).toBe("procedure");
  });

  test("classifies preference content as preference", () => {
    const r1 = classifyMemoryType("User always wants dark mode enabled");
    expect(r1.type).toBe("preference");
    expect(r1.confidence).toBe(0.8);

    const r2 = classifyMemoryType("Never use the old checkout flow");
    expect(r2.type).toBe("preference");

    const r3 = classifyMemoryType("User prefers Chrome over Firefox");
    expect(r3.type).toBe("preference");
  });

  test("classifies generic content as fact", () => {
    const r = classifyMemoryType("The login page is at https://example.com/login");
    expect(r.type).toBe("fact");
    expect(r.confidence).toBe(0.8);
  });

  test("explicit type overrides heuristic", () => {
    // Content looks like a procedure but explicit type says fact
    const r = classifyMemoryType("Step 1: click here. Then do that.", "fact");
    expect(r.type).toBe("fact");
    expect(r.confidence).toBe(1.0);
  });

  test("explicit type has confidence 1.0", () => {
    const r = classifyMemoryType("anything", "procedure");
    expect(r.confidence).toBe(1.0);
  });
});
