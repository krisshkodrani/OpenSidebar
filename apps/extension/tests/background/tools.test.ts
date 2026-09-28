import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import "../setup";
import { toolRegistry } from "../../src/background/tools/registry";
import { registerTools } from "../../src/background/tools";
import { ToolName, type ToolCall } from "../../src/types";
import {
  PERSONAL_PROFILE_STORAGE_KEY,
  PROFILE_ANALYZER_VERSION,
  hashProfileNotes,
} from "../../src/utils/personal-profile";

function toolCall(
  name: ToolName,
  args: Record<string, unknown> = {},
): ToolCall {
  return {
    id: `call-${name}`,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

// Register all tools once
beforeAll(() => {
  toolRegistry.clear();
  registerTools();
});

beforeEach(() => {
  (chrome.webNavigation as any).onCompleted = {
    addListener: (cb: (details: { tabId: number; frameId: number }) => void) =>
      setTimeout(() => cb({ tabId: 123, frameId: 0 }), 0),
    removeListener: () => {},
  };
  (chrome.webNavigation as any).onErrorOccurred = {
    addListener: () => {},
    removeListener: () => {},
  };
  (chrome.webNavigation as any).getAllFrames = undefined;
  (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
    id: 123,
    url: "https://example.com/start",
    title: "Start",
    groupId: -1,
  }));
  (chrome.tabs as any).update = vi.fn(async () => ({}));
  (chrome.tabs as any).goBack = vi.fn(async () => {});
  (chrome.scripting as any).executeScript = vi.fn(async () => [
    { result: undefined },
  ]);
  (chrome.tabs as any).sendMessage = vi.fn(
    async (tabId: number, message: any) => {
      if (message?.type === "DOM_READY_PROBE") {
        return { payload: { waitedMs: 10, elementCount: 4 } };
      }
      return { payload: { result: "ok", success: true } };
    },
  );
  (chrome.storage.sync as any).get = vi.fn(async () => ({ userSettings: {} }));
  (chrome.downloads as any).download = vi.fn(async () => 1);
  delete (chrome.downloads as any).onChanged;
  delete (chrome.downloads as any).search;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tool Registration", () => {
  test("generic list tools reject unsupported requests before changing the page", async () => {
    const cases = [
      [ToolName.APPLY_LIST_FILTER, { conditions: [{ field: "Status", operator: "contains", value: "open" }] }],
      [ToolName.APPLY_LIST_SORT, { sorts: [{ field: "Name" }, { field: "Date" }] }],
      [ToolName.APPLY_LIST_ACTION, { records: ["A-123"], action: "Delete", confirm: true }],
    ] as const;
    for (const [name, args] of cases) {
      const result = await toolRegistry.execute(toolCall(name, args), 123);
      expect(result).toContain("Error:");
    }
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("all ToolName enum values are registered once", () => {
    const defs = toolRegistry.getDefinitions();
    expect(defs.length).toBe(Object.values(ToolName).length);
  });

  test("every ToolName enum value has a registered definition", () => {
    const defs = toolRegistry.getDefinitions();
    const registeredNames = new Set(defs.map((d) => d.function.name));
    for (const name of Object.values(ToolName)) {
      expect(registeredNames.has(name)).toBe(true);
    }
  });

  test("does not register removed JobAgent MCP tools", () => {
    const registeredNames = new Set(
      toolRegistry.getDefinitions().map((d) => d.function.name),
    );
    expect(registeredNames.has("list_application_packages" as ToolName)).toBe(
      false,
    );
    expect(registeredNames.has("get_application_package" as ToolName)).toBe(
      false,
    );
    expect(registeredNames.has("suggest_form_answers" as ToolName)).toBe(false);
    expect(registeredNames.has("get_candidate_profile" as ToolName)).toBe(
      false,
    );
    expect(registeredNames.has("answer_candidate_question" as ToolName)).toBe(
      false,
    );
    expect(registeredNames.has("record_application_status" as ToolName)).toBe(
      false,
    );
    expect(registeredNames.has("submit_application" as ToolName)).toBe(false);
  });

  test("all definitions have type=function", () => {
    const defs = toolRegistry.getDefinitions();
    for (const def of defs) {
      expect(def.type).toBe("function");
    }
  });

  test("all definitions have required schema fields", () => {
    const defs = toolRegistry.getDefinitions();
    for (const def of defs) {
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters).toBeDefined();
      expect(def.function.parameters.type).toBe("object");
      expect(def.function.parameters.properties).toBeDefined();
      // Some tools (e.g. navigate) have no required fields
      if (def.function.parameters.required !== undefined) {
        expect(Array.isArray(def.function.parameters.required)).toBe(true);
      }
    }
  });

  test("click_element documents count for repeated same-control clicks", () => {
    const clickDef = toolRegistry
      .getDefinitions()
      .find((def) => def.function.name === ToolName.CLICK_ELEMENT);

    expect(clickDef?.function.description).toContain(
      "use count=N in one call",
    );
    expect(
      clickDef?.function.parameters.properties.count?.description,
    ).toContain("max 10");
  });

  test("inspect_table summarizes duplicate row candidates", async () => {
    document.body.innerHTML = `
      <table>
        <thead>
          <tr><th>Number</th><th>Problem statement</th><th>State</th></tr>
        </thead>
        <tbody>
          <tr><td>PRB0051146</td><td>Feeling get moment. #SERIES-25b45e1f-0</td><td>Assess</td></tr>
          <tr><td>PRB0051145</td><td>Feeling get moment. #SERIES-25b45e1f-0</td><td>Assess</td></tr>
        </tbody>
      </table>
    `;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "inspect-table-duplicates",
        type: "function",
        function: {
          name: ToolName.INSPECT_TABLE,
          arguments: JSON.stringify({ maxRows: 10 }),
        },
      },
      123,
    );

    expect(result).toContain("Duplicate candidates:");
    expect(result).toContain("Feeling get moment. #SERIES-25b45e1f-0");
    expect(result).toContain("records PRB0051146, PRB0051145");
    expect(result).toContain("apply_list_action");
  });

  test("navigate tool accepts url or query parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const nav = defs.find((d) => d.function.name === ToolName.NAVIGATE);
    expect(nav).toBeDefined();
    expect(nav!.function.parameters.properties).toHaveProperty("url");
    expect(nav!.function.parameters.properties).toHaveProperty("query");
  });

  test("search_knowledge_base extracts a numeric answer from a ranked article", async () => {
    document.body.innerHTML = `
      <main>
        <a href="/kb?id=kb_article_view&sys_kb_id=hire">Annual hiring overview</a>
        <p>Information about new hires, onboarding, and annual planning.</p>
        <a href="/kb?id=kb_article_view&sys_kb_id=benefits">Benefits overview</a>
        <p>General benefits information.</p>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("sys_kb_id=hire")) {
        return new Response(
          "<html><body><article>Our company typically makes 300 new hires each year.</article></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("<html><body>No matching results.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "Each year, how many new hires does the company typically make?",
            query: "new hires annual",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain("Knowledge base search result.");
    expect(result).toContain("Answer candidate: 300");
    expect(result).toContain('Completion hint: call done with summary "300"');
  });

  test("search_knowledge_base rejects numeric shell values without topical evidence", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="/kb?id=kb_article_view&sys_kb_id=shell">Email outage</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (
        value.includes("/api/now/table/kb_knowledge") &&
        value.includes("sys_id%3Dshell")
      ) {
        return new Response(
          JSON.stringify({
            result: [
              {
                number: "KB000",
                short_description: "Email outage",
                text: "<p>Widget value count is 0 for approvals. sys_domain is global. currentPage is 0.</p>",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("<html><body>Knowledge portal shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-shell-zero",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "What is the floor count for the main office building? Please answer with a numeric value.",
            query: "main office building floor count",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain(
      "No answer candidate found in the visible or linked knowledge results.",
    );
    expect(result).not.toContain("Answer candidate: 0");
  });

  test("search_knowledge_base extracts from the current knowledge article body", async () => {
    window.history.pushState({}, "", "/kb/en/article-8?id=kb_article_view");
    document.body.innerHTML = `
      <article>
        <h1>Hiring volume</h1>
        <p>The company typically makes 100 new hires each year.</p>
      </article>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>No matching results.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-current-article",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "Each year, how many new hires does the company typically make?",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain("Answer candidate: 100");
    expect(result).toContain("Evidence article:");
  });

  test("search_knowledge_base reads shadow-rendered knowledge search results", async () => {
    window.history.pushState({}, "", "/kb?id=kb_search&query=new%20hires");
    document.body.innerHTML = `<main><kb-search-results></kb-search-results></main>`;
    const host = document.querySelector("kb-search-results") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <section>
        <a href="?id=kb_article_view&sys_kb_id=article47">Article 47</a>
        <p>Article 47 General Knowledge Relevancy : 6.5775, collaboration, and growth.
        As we continue to expand our operations, the number of yearly hires is 100,
        reflecting sustained growth.</p>
      </section>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("<html><body>Knowledge portal shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-shadow-results",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "Each year, how many new hires does the company typically make?",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain("Answer candidate: 100");
    expect(result).toContain("Article 47");
  });

  test("inspect_chart reports Highcharts point counts and percentages", async () => {
    const originalHighcharts = (window as any).Highcharts;
    (window as any).Highcharts = {
      charts: [
        {
          title: { textStr: "Incidents by category" },
          options: { chart: { type: "bar" } },
          xAxis: [{ categories: ["Software", "(empty)"] }],
          series: [
            {
              name: "Incident",
              points: [
                {
                  category: "Software",
                  x: 0,
                  y: 63,
                  percent: 94.02985074626866,
                },
                { category: "(empty)", x: 1, y: 4, percent: 5.970149253731343 },
              ],
            },
          ],
          getDataRows: () => [
            ["Category", "Count", "Percent"],
            ["Software", 63, 94.02985074626866],
            ["(empty)", 4, 5.970149253731343],
          ],
        },
      ],
    };
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "inspect-chart",
          type: "function",
          function: {
            name: ToolName.INSPECT_CHART,
            arguments: JSON.stringify({ pattern: "(empty)" }),
          },
        },
        123,
      );

      expect(result).toContain("(empty)");
      expect(result).toContain("count=4");
      expect(result).toContain("percent=5.970149253731343");
      expect(result).toContain(
        "Numeric summary: min=(empty): 4; max=Software: 63; difference_to_max=59; order_extra_quantity_to_raise_min_to_max=59; final_target_quantity=63",
      );
    } finally {
      (window as any).Highcharts = originalHighcharts;
    }
  });

  test("inspect_chart returns chart points when the pattern matches only the chart title", async () => {
    const originalHighcharts = (window as any).Highcharts;
    (window as any).Highcharts = {
      charts: [
        {
          title: { textStr: "Catalog item fulfillment automation coverage" },
          options: { chart: { type: "pie" } },
          series: [
            {
              name: "Coverage",
              points: [
                { name: "Fully automated", y: 14 },
                { name: "Manual", y: 6 },
              ],
            },
          ],
        },
      ],
    };
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "inspect-chart-title",
          type: "function",
          function: {
            name: ToolName.INSPECT_CHART,
            arguments: JSON.stringify({
              pattern: "Catalog item fulfillment automation coverage",
            }),
          },
        },
        123,
      );

      expect(result).toContain("Catalog item fulfillment automation coverage");
      expect(result).toContain("Fully automated");
      expect(result).toContain("count=14");
      expect(result).toContain(
        "Numeric summary: min=Manual: 6; max=Fully automated: 14; difference_to_max=8; order_extra_quantity_to_raise_min_to_max=8; final_target_quantity=14",
      );
    } finally {
      (window as any).Highcharts = originalHighcharts;
    }
  });

  test("done tool requires summary parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const done = defs.find((d) => d.function.name === ToolName.DONE);
    expect(done).toBeDefined();
    expect(done!.function.parameters.required).toContain("summary");
  });

  test("close_tab has no required parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const closeTab = defs.find((d) => d.function.name === ToolName.CLOSE_TAB);
    expect(closeTab).toBeDefined();
    expect(closeTab!.function.parameters.required).toEqual([]);
  });

  test("press_key tool requires key parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const pressKey = defs.find((d) => d.function.name === ToolName.PRESS_KEY);
    expect(pressKey).toBeDefined();
    expect(pressKey!.function.parameters.required).toContain("key");
  });

  test("drag_and_drop tool requires sourceId and targetId", () => {
    const defs = toolRegistry.getDefinitions();
    const dnd = defs.find((d) => d.function.name === ToolName.DRAG_AND_DROP);
    expect(dnd).toBeDefined();
    expect(dnd!.function.parameters.required).toContain("sourceId");
    expect(dnd!.function.parameters.required).toContain("targetId");
  });

  test("hide_element tool requires id parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const hide = defs.find((d) => d.function.name === ToolName.HIDE_ELEMENT);
    expect(hide).toBeDefined();
    expect(hide!.function.parameters.required).toContain("id");
    expect(hide!.function.parameters.properties.id.type).toBe("integer");
  });

  test("scroll_page tool has y param and optional id/direction/amount", () => {
    const defs = toolRegistry.getDefinitions();
    const scroll = defs.find((d) => d.function.name === ToolName.SCROLL_PAGE);
    expect(scroll).toBeDefined();
    // Neither y nor direction is required — handler validates at runtime
    expect(scroll!.function.parameters.required).toEqual([]);
    expect(scroll!.function.parameters.properties.y).toBeDefined();
    expect(scroll!.function.parameters.properties.y.type).toBe("integer");
    expect(scroll!.function.parameters.properties.direction).toBeDefined();
    expect(scroll!.function.parameters.properties.amount).toBeDefined();
    expect(scroll!.function.parameters.properties.amount.type).toBe("integer");
    expect(scroll!.function.parameters.properties.id).toBeDefined();
    expect(scroll!.function.parameters.properties.id.type).toBe("integer");
  });

  test("escalate tool requires reason parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const escalate = defs.find((d) => d.function.name === ToolName.ESCALATE);
    expect(escalate).toBeDefined();
    expect(escalate!.function.parameters.required).toContain("reason");
    expect(escalate!.function.parameters.properties.reason.type).toBe("string");
    expect(escalate!.function.parameters.properties.reasonCode.type).toBe(
      "string",
    );
    expect(
      escalate!.function.parameters.properties.requiredCapability.enum,
    ).toContain("fill_text_fields");
  });

  test("escalate describes same-model reassessment and routes user decisions to clarify", () => {
    const defs = toolRegistry.getDefinitions();
    const escalate = defs.find((d) => d.function.name === ToolName.ESCALATE);
    expect(escalate).toBeDefined();
    expect(escalate!.function.description).toContain("current model");
    expect(escalate!.function.description).toContain("does not ask the user or switch models");
    expect(escalate!.function.description).toContain("use clarify instead");
  });

  test("clarify tool requires question parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const clarify = defs.find((d) => d.function.name === ToolName.CLARIFY);
    expect(clarify).toBeDefined();
    expect(clarify!.function.parameters.required).toContain("question");
    expect(clarify!.function.parameters.properties.question.type).toBe(
      "string",
    );
  });

  test("find_element description mentions tag ID", () => {
    const defs = toolRegistry.getDefinitions();
    const find = defs.find((d) => d.function.name === ToolName.FIND_ELEMENT);
    expect(find).toBeDefined();
    expect(find!.function.description).toContain("tag ID");
  });

  test("read_element requires id parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.READ_ELEMENT);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("id");
    expect(def!.function.parameters.properties.attribute).toBeDefined();
  });

  test("execute_js requires code parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.EXECUTE_JS);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("code");
  });

  test("upload_file requires id and url", () => {
    // url was schema-optional but runtime-required (the handler errors without
    // it) — the 2026-07-23 tools audit aligned the schema with the handler.
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.UPLOAD_FILE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("id");
    expect(def!.function.parameters.required).toContain("url");
    expect(def!.function.parameters.properties.url).toBeDefined();
  });

  test("go_back has no required parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.GO_BACK);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual([]);
  });

  test("list_tabs has no required parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.LIST_TABS);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual([]);
  });

  test("right_click requires id parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.RIGHT_CLICK);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("id");
  });

  test("set_checkbox requires id and checked parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SET_CHECKBOX);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("id");
    expect(def!.function.parameters.required).toContain("checked");
  });

  test("download_file requires url parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.DOWNLOAD_FILE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("url");
    expect(def!.function.parameters.properties.filename).toBeDefined();
  });

  test("download_file returns completion when Chrome reports a completed download", async () => {
    (chrome.downloads as any).download = vi.fn(async () => 42);
    (chrome.downloads as any).search = vi.fn(async () => [
      {
        id: 42,
        state: "complete",
        exists: true,
        filename: "C:\\Users\\tester\\Downloads\\File Alpha.pdf",
      },
    ]);
    (chrome.downloads as any).onChanged = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    const result = await toolRegistry.execute(
      toolCall(ToolName.DOWNLOAD_FILE, {
        url: "https://files.example.test/file-alpha.pdf",
      }),
      123,
    );

    expect(result).toBe(
      "Download completed (ID: 42, filename: File Alpha.pdf)",
    );
  });

  test("download_file keeps started result when completion is not observable", async () => {
    (chrome.downloads as any).download = vi.fn(async () => 43);

    const result = await toolRegistry.execute(
      toolCall(ToolName.DOWNLOAD_FILE, {
        url: "https://files.example.test/file-alpha.pdf",
      }),
      123,
    );

    expect(result).toBe("Download started (ID: 43)");
  });

  test("download_file reports an error when completed item is missing", async () => {
    (chrome.downloads as any).download = vi.fn(async () => 44);
    (chrome.downloads as any).search = vi.fn(async () => [
      {
        id: 44,
        state: "complete",
        exists: false,
        filename: "C:\\Users\\tester\\Downloads\\File Alpha.pdf",
      },
    ]);

    const result = await toolRegistry.execute(
      toolCall(ToolName.DOWNLOAD_FILE, {
        url: "https://files.example.test/file-alpha.pdf",
      }),
      123,
    );

    expect(result).toBe(
      "Error: Download interrupted (ID: 44, reason: file missing after completion)",
    );
  });

  test("get_cookies has no required parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.GET_COOKIES);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual([]);
    expect(def!.function.parameters.properties.url).toBeDefined();
  });

  test("set_cookie requires url, name, value", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SET_COOKIE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("url");
    expect(def!.function.parameters.required).toContain("name");
    expect(def!.function.parameters.required).toContain("value");
  });

  test("delete_cookie requires url and name", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.DELETE_COOKIE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("url");
    expect(def!.function.parameters.required).toContain("name");
  });

  test("search_history requires query", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SEARCH_HISTORY);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("query");
    expect(def!.function.parameters.properties.maxResults).toBeDefined();
  });

  test("inspect_hidden has no required parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.INSPECT_HIDDEN);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual([]);
    expect(def!.function.parameters.properties.pattern).toBeDefined();
    expect(def!.function.parameters.properties.maxResults).toBeDefined();
  });

  test("xray_page has no required parameters and mentions toggle", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.XRAY_PAGE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual([]);
    expect(Object.keys(def!.function.parameters.properties)).toHaveLength(0);
    expect(def!.function.description).toContain("Toggle");
    expect(def!.function.description).toContain("hidden");
  });

  test("update_notes requires note parameter", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.UPDATE_NOTES);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("note");
    expect(def!.function.parameters.properties.note.type).toBe("string");
    expect(def!.function.description).toContain("current run scratchpad");
  });

  test("get_profile_fields requires a fields array", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find(
      (d) => d.function.name === ToolName.GET_PROFILE_FIELDS,
    );
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("fields");
    expect(def!.function.parameters.properties.fields.type).toBe("array");
    expect(def!.function.description).toContain("Profile Digest");
  });

  test("get_profile_fields reads ready local Profile Digest facts", async () => {
    const notesMarkdown =
      "# About me\nMy name is John Doe.\nEmail: john.doe@example.com";
    (chrome.storage.local.get as any) = vi.fn(async () => ({
      [PERSONAL_PROFILE_STORAGE_KEY]: {
        version: 2,
        enabled: true,
        notesMarkdown,
        notesHash: hashProfileNotes(notesMarkdown),
        updatedAt: 1,
        analyzer: {
          provider: "fireworks",
          model: "accounts/fireworks/routers/kimi-k2p6-turbo",
          analyzerVersion: PROFILE_ANALYZER_VERSION,
          analyzedAt: 1,
        },
        digest: {
          schemaVersion: 1,
          notesHash: hashProfileNotes(notesMarkdown),
          analyzerVersion: PROFILE_ANALYZER_VERSION,
          items: [
            {
              id: "fact:full-name:test",
              label: "Full name",
              value: "John Doe",
              kind: "fact",
              confidence: "high",
            },
            {
              id: "fact:email:test",
              label: "Email",
              value: "john.doe@example.com",
              kind: "fact",
              confidence: "high",
            },
          ],
        },
      },
    }));

    const result = await toolRegistry.execute(
      {
        id: "tool-profile-fields",
        type: "function",
        function: {
          name: ToolName.GET_PROFILE_FIELDS,
          arguments: JSON.stringify({
            fields: ["full_name", "contact.email", "contact.phone"],
          }),
        },
      } as any,
      123,
    );

    expect(result).toContain("PROFILE DIGEST FACTS:");
    expect(result).toContain("- full_name: John Doe");
    expect(result).toContain("- contact.email: john.doe@example.com");
    expect(result).toContain("Missing: contact.phone");
  });

  test("type_text mirrors input in the main world after content execution", async () => {
    const result = await toolRegistry.execute(
      {
        id: "tool-type-main",
        type: "function",
        function: {
          name: ToolName.TYPE_TEXT,
          arguments: JSON.stringify({ id: 7, text: "hello" }),
        },
      } as any,
      123,
    );

    expect(result).toBe("ok");
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 123, frameIds: [0] },
        world: "MAIN",
        args: ["7", "hello"],
      }),
    );
  });

  test("type_text does not main-world mirror autocomplete inputs", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="customer_lookup"
                name="customer_lookup"
                role="combobox"
                value="existing"
            />
        `;
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "existing";
    const inputEvents: string[] = [];
    input.addEventListener("input", () => inputEvents.push(input.value));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      await details.func(...details.args);
      return [{ result: undefined }];
    });

    const result = await toolRegistry.execute(
      {
        id: "tool-type-reference-main",
        type: "function",
        function: {
          name: ToolName.TYPE_TEXT,
          arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
        },
      } as any,
      123,
    );

    expect(result).toBe("ok");
    expect(input.value).toBe("existing");
    expect(inputEvents).toEqual([]);
  });

  test("click_element does not mirror a successful content-script click", async () => {
    const result = await toolRegistry.execute(
      {
        id: "tool-click-main",
        type: "function",
        function: {
          name: ToolName.CLICK_ELEMENT,
          arguments: JSON.stringify({ id: 9 }),
        },
      } as any,
      123,
    );

    expect(result).toBe("ok");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("click_element recovers intercepted clicks through the main-world bridge", async () => {
    (chrome.tabs.sendMessage as any) = vi.fn(async () => ({
      payload: {
        result: "Click intercepted! Element [3] is covered by [56] <span>.",
        success: false,
      },
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async () => [
      { result: true },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "tool-click-intercepted-main",
        type: "function",
        function: {
          name: ToolName.CLICK_ELEMENT,
          arguments: JSON.stringify({ id: 3 }),
        },
      } as any,
      123,
    );

    expect(result).toContain("main-world event bridge");
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 123, allFrames: true },
        world: "MAIN",
        args: ["3"],
      }),
    );
  });

  test("click_element returns the interception when the main-world bridge times out", async () => {
    vi.useFakeTimers();
    (chrome.tabs.sendMessage as any) = vi.fn(async () => ({
      payload: {
        result: "Click intercepted! Element [3] is covered by [56] <span>.",
        success: false,
      },
    }));
    (chrome.scripting.executeScript as any) = vi.fn(
      () => new Promise(() => {}),
    );

    try {
      const pending = toolRegistry.execute(
        {
          id: "tool-click-intercepted-timeout",
          type: "function",
          function: {
            name: ToolName.CLICK_ELEMENT,
            arguments: JSON.stringify({ id: 3 }),
          },
        } as any,
        123,
      );

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toContain("Click intercepted!");
    } finally {
      vi.useRealTimers();
    }
  });

  test("go_back reports the destination URL after history navigation changes the page", async () => {
    let currentUrl = "https://example.com/step-3";
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
      id: 123,
      url: currentUrl,
      title: "History page",
      groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {
      currentUrl = "https://example.com/step-2";
    });

    const result = await toolRegistry.execute(
      {
        id: "tool-1",
        type: "function",
        function: {
          name: ToolName.GO_BACK,
          arguments: "{}",
        },
      } as any,
      123,
    );

    expect(result).toContain("Navigated back to https://example.com/step-2");
  });

  test("go_back returns an error when browser history stays on the same URL", async () => {
    const currentUrl = "https://example.com/step-2";
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
      id: 123,
      url: currentUrl,
      title: "History page",
      groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {});

    const result = await toolRegistry.execute(
      {
        id: "tool-2",
        type: "function",
        function: {
          name: ToolName.GO_BACK,
          arguments: "{}",
        },
      } as any,
      123,
    );

    expect(result).toContain("browser remained on https://example.com/step-2");
  }, 8000);

  test("go_back falls back to in-page history.back when tabs.goBack does not move", async () => {
    let currentUrl = "https://example.com/step-3";
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
      id: 123,
      url: currentUrl,
      title: "History page",
      groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {});
    (chrome.scripting as any).executeScript = vi.fn(async () => {
      currentUrl = "https://example.com/step-2";
      return [{ result: undefined }];
    });

    const result = await toolRegistry.execute(
      {
        id: "tool-2b",
        type: "function",
        function: {
          name: ToolName.GO_BACK,
          arguments: "{}",
        },
      } as any,
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(result).toContain("Navigated back to https://example.com/step-2");
  });

  test("go_back ignores transient about:blank and waits for the final destination URL", async () => {
    const urls = [
      "https://example.com/step-3",
      "about:blank",
      "https://example.com/step-2",
    ];
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
      id: 123,
      url: urls.length > 1 ? urls.shift() : urls[0],
      title: "History page",
      groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {});

    const result = await toolRegistry.execute(
      {
        id: "tool-3",
        type: "function",
        function: {
          name: ToolName.GO_BACK,
          arguments: "{}",
        },
      } as any,
      123,
    );

    expect(result).toContain("Navigated back to https://example.com/step-2");
    expect(result).not.toContain("about:blank");
  });

  test.each(["chrome-extension://test/sidepanel.html", "about:blank"])("go_back restores the source page when history reaches %s", async (strandedUrl) => {
    let currentUrl = "https://example.com/task";
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
      id: 123,
      url: currentUrl,
      title: "Task",
      groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {
      currentUrl = strandedUrl;
    });
    (chrome.tabs as any).update = vi.fn(async (_tabId: number, update: { url: string }) => {
      currentUrl = update.url;
      return { id: 123, url: currentUrl };
    });

    const result = await toolRegistry.execute(
      {
        id: "tool-4",
        type: "function",
        function: { name: ToolName.GO_BACK, arguments: "{}" },
      } as any,
      123,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
      url: "https://example.com/task",
    });
    expect(result).toContain("uncontrollable page");
    expect(result).toContain("Restored https://example.com/task");
  }, 10000);
});
