import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { DemoStore, cleanupActions, formatDemoForContext } from "../../src/background/demos/store";
import { DemoAction, Demonstration } from "../../src/types";

// Mock chrome.storage.local with an in-memory store
let mockStorage: Record<string, any> = {};
(global as any).chrome.storage.local = {
  get: async (key: string) => ({ [key]: mockStorage[key] }),
  set: async (obj: Record<string, any>) => {
    Object.assign(mockStorage, obj);
  },
  remove: async (keys: string[]) => {
    for (const k of keys) delete mockStorage[k];
  },
};

describe("DemoStore", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  test("saveDemonstration creates and persists a demo", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Login flow",
      description: "Log in to the site",
      actions: [
        {
          type: "click",
          timestamp: 1000,
          url: "https://example.com/login",
          element: {
            tagName: "button",
            text: "Sign In",
            attributes: {},
            domPath: "body>button",
            selector: "button",
          },
        },
        {
          type: "type",
          timestamp: 2000,
          url: "https://example.com/login",
          value: "user@example.com",
          element: {
            tagName: "input",
            text: "",
            attributes: { type: "email", placeholder: "Email" },
            domPath: "body>input",
            selector: 'input[type="email"]',
          },
        },
      ],
      url: "https://example.com/login",
    });

    expect(demo.id).toBeDefined();
    expect(demo.name).toBe("Login flow");
    expect(demo.actions.length).toBe(2);
    expect(demo.urlPattern).toContain("example.com");
    expect(demo.matchTokens.length).toBeGreaterThan(0);
    expect(demo.enabled).toBe(true);
    expect(demo.uses).toBe(0);

    // Verify persistence
    const listed = await store.listDemos();
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(demo.id);
  });

  test("deleteDemonstration removes a demo", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Test",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    const deleted = await store.deleteDemonstration(demo.id);
    expect(deleted).toBe(true);

    const listed = await store.listDemos();
    expect(listed.length).toBe(0);
  });

  test("deleteDemonstration returns false for missing id", async () => {
    const store = new DemoStore();
    const deleted = await store.deleteDemonstration("nonexistent");
    expect(deleted).toBe(false);
  });

  test("updateDemo modifies name and description", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Old Name",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    const updated = await store.updateDemo(demo.id, {
      name: "New Name",
      description: "Updated description",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(demo.updatedAt);
  });

  test("updateDemo toggles enabled", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Test",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    const updated = await store.updateDemo(demo.id, { enabled: false });
    expect(updated!.enabled).toBe(false);
  });

  test("matchDemo finds matching demo by URL + tokens", async () => {
    const store = new DemoStore();
    await store.saveDemonstration({
      name: "Login to example site",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com/login" }],
      url: "https://example.com/login",
    });

    const match = await store.matchDemo("login example", "https://example.com/login");
    expect(match).not.toBeNull();
    expect(match!.demo.name).toBe("Login to example site");
    expect(match!.score).toBeGreaterThan(0.4);
  });

  test("matchDemo returns null for wrong domain", async () => {
    const store = new DemoStore();
    await store.saveDemonstration({
      name: "Login flow",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    const match = await store.matchDemo("login", "https://other-site.com");
    expect(match).toBeNull();
  });

  test("matchDemo skips disabled demos", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Login flow",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    await store.updateDemo(demo.id, { enabled: false });
    const match = await store.matchDemo("login", "https://example.com");
    expect(match).toBeNull();
  });

  test("recordDemoUsage increments use count", async () => {
    const store = new DemoStore();
    const demo = await store.saveDemonstration({
      name: "Test",
      actions: [{ type: "click", timestamp: 1000, url: "https://example.com" }],
      url: "https://example.com",
    });

    await store.recordDemoUsage(demo.id);
    await store.recordDemoUsage(demo.id);

    const listed = await store.listDemos();
    expect(listed[0].uses).toBe(2);
  });

  test("clearAll removes all demos", async () => {
    const store = new DemoStore();
    await store.saveDemonstration({
      name: "A",
      actions: [{ type: "click", timestamp: 1000, url: "https://a.com" }],
      url: "https://a.com",
    });
    await store.saveDemonstration({
      name: "B",
      actions: [{ type: "click", timestamp: 2000, url: "https://b.com" }],
      url: "https://b.com",
    });

    await store.clearAll();
    const listed = await store.listDemos();
    expect(listed.length).toBe(0);
  });
});

describe("cleanupActions", () => {
  test("merges consecutive scrolls within 500ms", () => {
    const actions: DemoAction[] = [
      { type: "scroll", timestamp: 1000, url: "https://example.com", scrollDelta: 100 },
      { type: "scroll", timestamp: 1200, url: "https://example.com", scrollDelta: 150 },
      { type: "scroll", timestamp: 1400, url: "https://example.com", scrollDelta: 50 },
    ];
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].scrollDelta).toBe(300);
  });

  test("does not merge scrolls separated by more than 500ms", () => {
    const actions: DemoAction[] = [
      { type: "scroll", timestamp: 1000, url: "https://example.com", scrollDelta: 100 },
      { type: "scroll", timestamp: 2000, url: "https://example.com", scrollDelta: 150 },
    ];
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBe(2);
  });

  test("deduplicates rapid clicks on same element", () => {
    const element = {
      tagName: "button",
      text: "Submit",
      attributes: {},
      domPath: "body>button",
      selector: "#submit",
    };
    const actions: DemoAction[] = [
      { type: "click", timestamp: 1000, url: "https://example.com", element },
      { type: "click", timestamp: 1100, url: "https://example.com", element },
      { type: "click", timestamp: 1200, url: "https://example.com", element },
    ];
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBe(1);
  });

  test("keeps clicks on different elements", () => {
    const actions: DemoAction[] = [
      {
        type: "click",
        timestamp: 1000,
        url: "https://example.com",
        element: { tagName: "button", text: "A", attributes: {}, domPath: "body>button:nth-of-type(1)", selector: "#a" },
      },
      {
        type: "click",
        timestamp: 1100,
        url: "https://example.com",
        element: { tagName: "button", text: "B", attributes: {}, domPath: "body>button:nth-of-type(2)", selector: "#b" },
      },
    ];
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBe(2);
  });

  test("removes no-op actions", () => {
    const actions: DemoAction[] = [
      { type: "scroll", timestamp: 1000, url: "https://example.com", scrollDelta: 0 },
      { type: "type", timestamp: 2000, url: "https://example.com", value: "" },
      { type: "click", timestamp: 3000, url: "https://example.com" },
    ];
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBe(1); // Only the click remains
  });

  test("caps at 200 actions", () => {
    const actions: DemoAction[] = [];
    for (let i = 0; i < 250; i++) {
      actions.push({ type: "click", timestamp: i * 1000, url: "https://example.com" });
    }
    const cleaned = cleanupActions(actions);
    expect(cleaned.length).toBeLessThanOrEqual(200);
  });
});

describe("formatDemoForContext", () => {
  test("formats a demo as readable steps", () => {
    const demo: Demonstration = {
      id: "test-id",
      name: "Login flow",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      urlPattern: "https://example.com",
      matchTokens: ["login", "flow"],
      uses: 0,
      enabled: true,
      actions: [
        {
          type: "click",
          timestamp: 1000,
          url: "https://example.com",
          element: { tagName: "button", text: "Sign In", attributes: {}, domPath: "", selector: "" },
        },
        {
          type: "type",
          timestamp: 2000,
          url: "https://example.com",
          value: "user@example.com",
          element: { tagName: "input", text: "", attributes: { placeholder: "Email" }, domPath: "", selector: "" },
        },
        {
          type: "press_key",
          timestamp: 3000,
          url: "https://example.com",
          key: "Enter",
        },
      ],
    };

    const text = formatDemoForContext(demo);
    expect(text).toContain("Reference Demonstration");
    expect(text).toContain("Login flow");
    expect(text).toContain("Sign In");
    expect(text).toContain("user@example.com");
    expect(text).toContain("Press Enter");
  });

  test("truncates long demos", () => {
    const actions: DemoAction[] = [];
    for (let i = 0; i < 100; i++) {
      actions.push({
        type: "click",
        timestamp: i * 1000,
        url: "https://example.com",
        element: {
          tagName: "button",
          text: `Very long button text for step number ${i} that takes up token space`,
          attributes: {},
          domPath: "",
          selector: "",
        },
      });
    }

    const demo: Demonstration = {
      id: "test-id",
      name: "Long demo",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      urlPattern: "https://example.com",
      matchTokens: ["long"],
      uses: 0,
      enabled: true,
      actions,
    };

    const text = formatDemoForContext(demo);
    expect(text).toContain("more steps");
    // Should be under ~500 tokens (~2000 chars)
    expect(text.length).toBeLessThan(3000);
  });
});
