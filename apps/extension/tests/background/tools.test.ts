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
import { ToolName } from "../../src/types";

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tool Registration", () => {
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

  test("registers JobAgent MCP tools without submit_application", () => {
    const registeredNames = new Set(
      toolRegistry.getDefinitions().map((d) => d.function.name),
    );
    expect(registeredNames.has(ToolName.LIST_APPLICATION_PACKAGES)).toBe(true);
    expect(registeredNames.has(ToolName.GET_APPLICATION_PACKAGE)).toBe(true);
    expect(registeredNames.has(ToolName.SUGGEST_FORM_ANSWERS)).toBe(true);
    expect(registeredNames.has(ToolName.GET_CANDIDATE_PROFILE)).toBe(true);
    expect(registeredNames.has(ToolName.ANSWER_CANDIDATE_QUESTION)).toBe(true);
    expect(registeredNames.has(ToolName.RECORD_APPLICATION_STATUS)).toBe(true);
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

  test("navigate blocks web search when allowed origins are set", async () => {
    (chrome.storage.sync as any).get = vi.fn(async () => ({
      userSettings: {
        allowedNavigationOrigins: ["https://workarenapublic18.service-now.com"],
      },
    }));
    (chrome.search as any).query = vi.fn(async () => {});

    const result = await toolRegistry.execute(
      {
        id: "nav-search",
        type: "function",
        function: {
          name: ToolName.NAVIGATE,
          arguments: JSON.stringify({
            query: "Configuration Database Instances HBase",
          }),
        },
      },
      123,
    );

    expect(result).toContain("External web search is blocked");
    expect(chrome.search.query).not.toHaveBeenCalled();
  });

  test("navigate blocks off-origin URL when allowed origins are set", async () => {
    (chrome.storage.sync as any).get = vi.fn(async () => ({
      userSettings: {
        allowedNavigationOrigins: ["https://workarenapublic18.service-now.com"],
      },
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const result = await toolRegistry.execute(
      {
        id: "nav-url",
        type: "function",
        function: {
          name: ToolName.NAVIGATE,
          arguments: JSON.stringify({
            url: "https://www.google.com/search?q=x",
          }),
        },
      },
      123,
    );

    expect(result).toContain("External navigation blocked");
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test("navigate allows in-origin URL when allowed origins are set", async () => {
    (chrome.storage.sync as any).get = vi.fn(async () => ({
      userSettings: {
        allowedNavigationOrigins: ["https://workarenapublic18.service-now.com"],
      },
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const result = await toolRegistry.execute(
      {
        id: "nav-url",
        type: "function",
        function: {
          name: ToolName.NAVIGATE,
          arguments: JSON.stringify({
            url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
          }),
        },
      },
      123,
    );

    expect(result).toContain(
      "Navigated to https://workarenapublic18.service-now.com/now/nav/ui/home",
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
    });
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
      "No answer candidate found in the ranked knowledge results.",
    );
    expect(result).not.toContain("Answer candidate: 0");
  });

  test("search_knowledge_base ranks ServiceNow table fallback records locally", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = "<main><p>Knowledge home</p></main>";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        const isBroadFallback = value.includes("workflow_state%3Dpublished");
        return new Response(
          JSON.stringify({
            result: isBroadFallback
              ? [
                  {
                    sys_id: "unrelated",
                    number: "KB001",
                    short_description: "Benefits overview",
                    text: "<p>Benefits are updated each year.</p>",
                  },
                  {
                    sys_id: "hiring",
                    number: "KB002",
                    short_description: "Annual hiring plan",
                    text: "<p>The company typically makes 425 new hires each year.</p>",
                  },
                ]
              : [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
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
        id: "knowledge-search-table",
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

    expect(result).toContain("Answer candidate: 425");
    expect(result).toContain("Evidence article: KB002 Annual hiring plan");
  });

  test("search_knowledge_base rejects employee budget numbers for hiring questions", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = "<main><p>Knowledge home</p></main>";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                sys_id: "training",
                number: "KB001",
                short_description: "Employee training budget",
                text: "<p>The annual spending on employee training programs is $250,000.</p>",
              },
              {
                sys_id: "hiring",
                number: "KB002",
                short_description: "Annual hiring plan",
                text: "<p>The company typically makes 100 new hires each year.</p>",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
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
        id: "knowledge-search-budget-reject",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "Each year, how many new hires does the company typically make?",
            query: "hiring statistics workforce employees company size",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain("Answer candidate: 100");
    expect(result).not.toContain("Answer candidate: 250,000");
  });

  test("search_knowledge_base searches discovered scoped knowledge bases", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="?id=kb_search&kb_knowledge_base=company">Company Protocols</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (
        value.includes("kb_knowledge_base=company") &&
        value.includes("query=")
      ) {
        return new Response(
          `<html><body>
            <a href="/kb?id=kb_article_view&sys_kb_id=company-hiring">Annual hiring plan</a>
            <p>The company typically makes 100 new hires each year.</p>
          </body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (value.includes("sys_kb_id=company-hiring")) {
        return new Response(
          "<html><body><article>The company typically makes 100 new hires each year.</article></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
        id: "knowledge-search-scoped-kb",
        type: "function",
        function: {
          name: ToolName.SEARCH_KNOWLEDGE_BASE,
          arguments: JSON.stringify({
            question:
              "Each year, how many new hires does the company typically make?",
            query: "new hires",
            answerType: "number",
          }),
        },
      },
      123,
    );

    expect(result).toContain("Answer candidate: 100");
    expect(result).toContain("Annual hiring plan");
  });

  test("search_knowledge_base reads ServiceNow article link text through table API", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="/kb?id=kb_article_view&sys_kb_id=article47">Article 47</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (
        value.includes("/api/now/table/kb_knowledge") &&
        value.includes("sys_id%3Darticle47")
      ) {
        return new Response(
          JSON.stringify({
            result: [
              {
                number: "KB047",
                short_description: "Article 47",
                text: "<p>The company typically makes 512 new hires each year.</p>",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("<html><body>Article shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-article-api",
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

    expect(result).toContain("Answer candidate: 512");
    expect(result).toContain("Evidence article: KB047 Article 47");
  });

  test("search_knowledge_base falls back to direct ServiceNow record API for article links", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="/kb?id=kb_article_view&sys_kb_id=article48">Article 48</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (
        value.includes("/api/now/table/kb_knowledge?") &&
        value.includes("sys_id%3Darticle48")
      ) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (value.includes("/api/now/table/kb_knowledge/article48?")) {
        return new Response(
          JSON.stringify({
            result: {
              number: "KB048",
              short_description: "Article 48",
              text: "<p>Our company typically makes 625 new hires each year.</p>",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("<html><body>Article shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-direct-article-api",
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

    expect(result).toContain("Answer candidate: 625");
    expect(result).toContain("Evidence article: KB048 Article 48");
  });

  test("search_knowledge_base falls back to legacy ServiceNow article HTML", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="/kb?id=kb_article_view&sys_kb_id=article49">Article 49</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: value.includes("/article49?") ? 404 : 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (value.includes("/kb_view.do?sys_kb_id=article49")) {
        return new Response(
          "<html><body><article>The company typically makes 710 new hires each year.</article></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("<html><body>Article shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-legacy-article-html",
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

    expect(result).toContain("Answer candidate: 710");
    expect(result).toContain("Evidence article: Knowledge article article49");
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

  test("search_knowledge_base reads ServiceNow sys_id article links", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="/kb_knowledge.do?sys_id=article50">Edit Article</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (
        value.includes("/api/now/table/kb_knowledge?") &&
        value.includes("sys_id%3Darticle50")
      ) {
        return new Response(
          JSON.stringify({
            result: [
              {
                number: "KB050",
                short_description: "Hiring volume",
                text: "<p>The company typically makes 830 new hires each year.</p>",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("<html><body>Article shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "knowledge-search-sys-id-link",
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

    expect(result).toContain("Answer candidate: 830");
    expect(result).toContain("Evidence article: KB050 Hiring volume");
  });

  test("search_knowledge_base extracts numeric answers from result snippets when article fetch is a shell", async () => {
    window.history.pushState({}, "", "/kb?id=kb_search&query=new%20hires");
    document.body.innerHTML = `
      <main>
        <div class="search-results">
          <div class="search-result-card">
            <div class="result-title">
              <a href="/kb?sys_kb_id=article8&id=kb_article_view&sysparm_rank=1">Article 8</a>
            </div>
            <p>Article 8 General Knowledge Relevancy : 9.9089 Onboarding: Ensuring a smooth and welcoming onboarding process for new hires. Training and Development. Benefits overview. Employee support. Career planning. Internal mobility. Orientation guidance. HR policies. Learning paths. Mentorship options. Wellness programs. Performance management. Recruitment support. Benefits administration. Employee relations. Compensation notes. Time off policies. Career development. Internal transfers. HR contacts. Diversity programs. Company updates. Employee portal help. New joiner checklist. Manager guidance. Department overview. Support contacts. General employment information. This earlier result is long enough to push later results beyond a naive snippet boundary.</p>
          </div>
          <div class="search-result-card">
            <div class="result-title">
              <a href="/kb?sys_kb_id=article40&id=kb_article_view&sysparm_rank=2">Article 40</a>
            </div>
            <p>Article 40 General Knowledge Relevancy : 9.8701 part of our orientation process for new hires, and we continue to support diverse perspectives in all departments.</p>
          </div>
          <div class="search-result-card">
          <div class="result-title">
            <a href="/kb?sys_kb_id=article47&id=kb_article_view&sysparm_rank=3">Article 47</a>
          </div>
          <p>Article 47 General Knowledge Relevancy : 6.5775, collaboration, and growth. As we continue to expand our operations and break new ground in the technology of yearly hires is 100, reflecting our sustained growth.</p>
          </div>
        </div>
      </main>
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
        id: "knowledge-search-snippet-answer",
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
    expect(result).toContain("Article URL:");
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

  test("search_knowledge_base tries canonical ServiceNow portal article routes", async () => {
    window.history.pushState({}, "", "/kb/en?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="?id=kb_article_view&sys_kb_id=article47">Article 47</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (value.includes("/kb/en/article-47?")) {
        return new Response(
          "<html><body><article>As we expand, the technology team yearly hires is 100, reflecting sustained growth.</article></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
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
        id: "knowledge-search-canonical-article",
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
    expect(result).toContain("/kb/en/article-47?");
  });

  test("search_knowledge_base resolves ServiceNow article-number results through classic routes", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `
      <main>
        <a href="?id=kb_article_view&sys_kb_id=article47">Article 47</a>
      </main>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/table/kb_knowledge")) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (value.includes("sysparm_article=KB0010047")) {
        return new Response(
          "<html><body><article>Careers and opportunities. The average number of yearly hires is 100, reflecting sustained growth.</article></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
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
        id: "knowledge-search-classic-article-number",
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
    expect(result).toContain("KB0010047");
  });

  test("search_knowledge_base reads ServiceNow Service Portal search JSON", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `<main><h1>Knowledge Home</h1></main>`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/sp/page") && value.includes("kb_search")) {
        return new Response(
          JSON.stringify({
            result: {
              containers: [
                {
                  rows: [
                    {
                      widgets: [
                        {
                          data: {
                            results: [
                              {
                                title: "Article 47",
                                snippet:
                                  "Careers and opportunities. The average number of yearly hires is 100, reflecting sustained growth.",
                              },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
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
        id: "knowledge-search-service-portal-json",
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

    expect(result).toContain("Answer candidate: 100");
    expect(result).toContain("Service Portal knowledge search");
  });

  test("search_knowledge_base preserves structured Service Portal result snippets", async () => {
    window.history.pushState({}, "", "/kb?id=kb_home");
    document.body.innerHTML = `<main><h1>Knowledge Home</h1></main>`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const value = String(url);
      if (value.includes("/api/now/sp/page") && value.includes("kb_search")) {
        return new Response(
          JSON.stringify({
            result: {
              data: {
                results: [
                  {
                    title: "Article 47",
                    sys_id: "b0d93d962b227210de74f462fe91bf7a",
                    snippet:
                      "Company growth planning says the number of yearly hires is 100, reflecting sustained growth.",
                  },
                ],
              },
            },
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
        id: "knowledge-search-structured-service-portal-result",
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

    expect(result).toContain("Answer candidate: 100");
    expect(result).toContain("sys_kb_id=b0d93d962b227210de74f462fe91bf7a");
  });

  test("open_servicenow_module resolves and opens a ServiceNow module", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45a4f1329f1221001e021a1cf67fcfe5";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: {
                value: "45a4f1329f1221001e021a1cf67fcfe5",
                display_value: "45a4f1329f1221001e021a1cf67fcfe5",
              },
              title: { value: "HBase", display_value: "HBase" },
              application: {
                value: "app1",
                display_value: "Configuration",
              },
              name: {
                value: "cmdb_ci_db_hbase_instance",
                display_value: "cmdb_ci_db_hbase_instance",
              },
              table: {
                value: "cmdb_ci_db_hbase_instance",
                display_value: "cmdb_ci_db_hbase_instance",
              },
              link_type: { value: "LIST", display_value: "List" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const execution = await toolRegistry.executeDetailed(
      {
        id: "open-module",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );
    const result = execution.result;

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/now/table/sys_app_module?"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Opened ServiceNow module.");
    expect(result).toContain("Application: Configuration");
    expect(result).toContain("Module: HBase");
    expect(result).toContain(`Target URL: ${targetUrl}`);
    expect(execution.evidence?.map((event) => event.type)).toEqual(
      expect.arrayContaining(["navigation_reached", "goal_state_verified"]),
    );
    expect(execution.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: ToolName.OPEN_SERVICENOW_MODULE,
          confidence: "high",
          supportsTaskGoal: true,
        }),
      ]),
    );
  });

  test("open_servicenow_module can resolve without navigating", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: { value: "abc123", display_value: "abc123" },
              title: { value: "Problems", display_value: "Problems" },
              application: { value: "app1", display_value: "Problem" },
              table: { value: "problem", display_value: "problem" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const result = await toolRegistry.execute(
      {
        id: "resolve-module",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Problem",
            path: ["Problems"],
            run: false,
          }),
        },
      },
      123,
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(result).toContain("Resolved ServiceNow module.");
    expect(result).toContain("Target URL:");
  });

  test("open_servicenow_module falls back to page ServiceNow lookup when background lookup is unauthorized", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45a4f1329f1221001e021a1cf67fcfe5";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response("", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          result: [
            {
              sys_id: {
                value: "45a4f1329f1221001e021a1cf67fcfe5",
                display_value: "45a4f1329f1221001e021a1cf67fcfe5",
              },
              title: { value: "HBase", display_value: "HBase" },
              application: {
                value: "app1",
                display_value: "Configuration",
              },
              table: {
                value: "cmdb_ci_db_hbase_instance",
                display_value: "cmdb_ci_db_hbase_instance",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.args?.[0] === "sys_app_module") {
        return [{ result: await details.func(...details.args), frameId: 0 }];
      }
      return [
        {
          frameId: 0,
          result: { ok: false, reason: "navigator_candidate_not_found" },
        },
      ];
    });

    const result = await toolRegistry.execute(
      {
        id: "open-module-page-fallback",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(fetchCount).toBe(2);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Opened ServiceNow module.");
    expect(result).toContain("Application: Configuration");
  });

  test("open_servicenow_module falls back to navigator search when metadata lookup is unavailable", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Failed to fetch"),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    document.body.innerHTML = `
      <button aria-label="All" aria-expanded="true">All</button>
      <nav>
        <section>Configuration Database Instances
          <a href="${target}">HBase</a>
        </section>
      </nav>
    `;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.args?.[0] === "sys_app_module") {
        return [
          { frameId: 0, result: { ok: false, reason: "lookup_timeout" } },
        ];
      }
      return [{ frameId: 0, result: await details.func(...details.args) }];
    });

    const result = await toolRegistry.execute(
      {
        id: "open-module-navigator-fallback",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain(
      "Opened ServiceNow module via navigator fallback.",
    );
    expect(result).toContain("Winning path: navigator_href");
    expect(result).toContain("Navigator query: existing navigator");
    expect(result).toContain("Metadata:");
    expect(result).toContain("Navigator:");
  });

  test("open_servicenow_module opens Reports View/Run through stable route", async () => {
    const targetUrl =
      "https://workarenapublic18.service-now.com/report_home.do?jvar_selected_tab=myReports";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("metadata should not be required"),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async () => []);

    const result = await toolRegistry.execute(
      {
        id: "open-reports-view-run-direct",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Reports",
            path: ["View/Run"],
          }),
        },
      },
      123,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Winning path: reports_view_run_direct");
    expect(result).toContain(
      "Target: report_home.do?jvar_selected_tab=myReports",
    );
  });

  test("open_servicenow_module uses an already-open ServiceNow navigator module href", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Failed to fetch"),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    document.body.innerHTML = `
      <button aria-label="All" aria-expanded="true">All</button>
      <input aria-label="Search" placeholder="Search" />
      <div id="servicenow-nav-host"></div>
    `;
    const host = document.querySelector("#servicenow-nav-host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <input aria-label="Filter" placeholder="Filter" />
      <nav>
        <section>Configuration Database Instances
          <a href="${target}">HBase</a>
        </section>
      </nav>
    `;
    const allButton = document.querySelector("button") as HTMLButtonElement;
    const hbaseLink = shadow.querySelector("a") as HTMLAnchorElement;
    const allClick = vi.fn();
    const hbaseClick = vi.fn((event: Event) => event.preventDefault());
    allButton.addEventListener("click", allClick);
    hbaseLink.addEventListener("click", hbaseClick);

    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.args?.[0] === "sys_app_module") {
        return [
          { frameId: 0, result: { ok: false, reason: "lookup_timeout" } },
        ];
      }
      return [{ frameId: 0, result: await details.func(...details.args) }];
    });

    const result = await toolRegistry.execute(
      {
        id: "open-module-open-navigator-fallback",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(allClick).not.toHaveBeenCalled();
    expect(hbaseClick).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain(
      "Opened ServiceNow module via navigator fallback.",
    );
    expect(result).toContain("Navigator query: existing navigator");
  });

  test("open_servicenow_module emits evidence when the requested module is already open", async () => {
    const currentUrl =
      "https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do%3Fsysparm_userpref_module%3Dd20";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not query metadata"));
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: currentUrl,
      title: "Classic | Unified Navigation App | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          title: "Elements Filters | ServiceNow",
          url: currentUrl,
          target: currentUrl,
          headings: ["Elements Filters Context Menu"],
        },
      },
    ]);

    const execution = await toolRegistry.executeDetailed(
      {
        id: "open-module-already-open",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Performance Analytics",
            path: ["Breakdowns", "Elements Filters"],
          }),
        },
      },
      123,
    );

    const metadataCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/now/table/sys_app_module"),
    );
    expect(metadataCalls).toHaveLength(0);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(execution.result).toContain("ServiceNow module is already open.");
    expect(execution.result).toContain("Winning path: current_page");
    expect(execution.evidence?.map((event) => event.type)).toEqual(
      expect.arrayContaining(["navigation_reached", "goal_state_verified"]),
    );
  });

  test("open_servicenow_module commits navigator when metadata is slow", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ result: [] }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              ),
            100,
          ),
        ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    document.body.innerHTML = `
      <button aria-label="All" aria-expanded="true">All</button>
      <nav>
        <section>Configuration Database Instances
          <a href="${target}">HBase</a>
        </section>
      </nav>
    `;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { frameId: 0, result: await details.func(...details.args) },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "open-module-fast-navigator",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Winning path: navigator_href");
    expect(result).toContain("Metadata: pending");
  });

  test("open_servicenow_module tries the application name as a navigator filter", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Failed to fetch"),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    document.body.innerHTML = `
      <button aria-label="All" aria-expanded="true">All</button>
      <input aria-label="Filter" placeholder="Filter" />
      <nav id="navigator"></nav>
    `;
    const filter = document.querySelector("input") as HTMLInputElement;
    const navigator = document.querySelector("#navigator") as HTMLElement;
    filter.addEventListener("input", () => {
      if (
        filter.value === "Configuration" &&
        navigator.childElementCount === 0
      ) {
        navigator.innerHTML = `
          <section>Configuration Database Instances
            <a href="${target}">HBase</a>
          </section>
        `;
      }
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.args?.[0] === "sys_app_module") {
        return [
          { frameId: 0, result: { ok: false, reason: "lookup_timeout" } },
        ];
      }
      return [{ frameId: 0, result: await details.func(...details.args) }];
    });

    const result = await toolRegistry.execute(
      {
        id: "open-module-app-query",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Navigator query: Configuration");
    expect(result).toContain("Winning path: navigator_href");
  });

  test("open_servicenow_module uses tagged ServiceNow navigator snapshots", async () => {
    const target = "pa_filters_list.do?sysparm_userpref_module=d20";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Failed to fetch"),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.args?.[0] === "sys_app_module") {
        return [
          { frameId: 0, result: { ok: false, reason: "lookup_timeout" } },
        ];
      }
      return [
        {
          frameId: 0,
          result: {
            title: "Home | ServiceNow",
            url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
            target: "",
            headings: [],
          },
        },
      ];
    });

    let allOpened = false;
    let filtered = false;
    const elementBase = {
      rect: { x: 0, y: 0, width: 100, height: 20 },
      isVisible: true,
      isDisabled: false,
    };
    const snapshot = () => ({
      title: "ServiceNow",
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      visibleContent: filtered
        ? "Performance Analytics Breakdowns Elements Filters"
        : allOpened
          ? "All menu filter"
          : "All",
      pageContent: filtered
        ? "Performance Analytics\nBreakdowns\nElements Filters"
        : allOpened
          ? "All menu filter"
          : "All",
      viewport: { width: 1200, height: 800 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 800 },
      elements: [
        {
          ...elementBase,
          tag: 2,
          tagName: "input",
          role: "textbox",
          text: "",
          attributes: { placeholder: "Search", "aria-label": "Search" },
        },
        {
          ...elementBase,
          tag: 4,
          tagName: "div",
          role: "button",
          text: "All",
          attributes: { role: "button", "aria-label": "All" },
        },
        ...(allOpened
          ? [
              {
                ...elementBase,
                tag: 20,
                tagName: "input",
                role: "textbox",
                text: filtered ? "Performance Analytics" : "",
                attributes: {
                  placeholder: "Filter",
                  "aria-label": "Filter",
                },
              },
            ]
          : []),
        ...(filtered
          ? [
              {
                ...elementBase,
                tag: 185,
                tagName: "a",
                role: "link",
                text: "Elements Filters",
                attributes: {
                  href: target,
                  "aria-label": "Elements Filters",
                },
              },
            ]
          : []),
      ],
    });
    (chrome.tabs as any).sendMessage = vi.fn(
      async (_tabId: number, message: any) => {
        if (message?.type === "DOM_READY_PROBE") {
          return { payload: { waitedMs: 10, elementCount: 3 } };
        }
        if (message?.type === "DOM_SNAPSHOT_REQUEST") {
          return { payload: { snapshot: snapshot(), durationMs: 5 } };
        }
        if (message?.type === "TOOL_EXECUTE") {
          let result = "";
          if (message.payload.toolName === ToolName.CLICK_ELEMENT) {
            if (message.payload.args.id === 4) {
              allOpened = true;
              result = 'Clicked [4] div "All"';
            } else {
              expect(message.payload.args).toEqual({ id: 185 });
              result = 'Clicked [185] a "Elements Filters"';
            }
          } else {
            expect(message.payload.toolName).toBe(ToolName.TYPE_TEXT);
            expect(message.payload.args).toEqual({
              id: 20,
              text: "Performance Analytics",
            });
            filtered = true;
            result = 'Typed "Performance Analytics"';
          }
          return { payload: { result } };
        }
        return { payload: { result: "ok", success: true } };
      },
    );

    const result = await toolRegistry.execute(
      {
        id: "open-module-snapshot-navigator",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Performance Analytics",
            path: ["Breakdowns", "Elements Filters"],
          }),
        },
      },
      123,
    );

    expect(chrome.tabs.update).not.toHaveBeenCalledWith(123, {
      url: targetUrl,
    });
    expect(result).toContain(
      "Opened ServiceNow module via navigator fallback.",
    );
    expect(result).toContain("Winning path: navigator_click");
    expect(result).toContain("Navigator query: Performance Analytics");
    expect(result).toContain("Candidate: Elements Filters");
  });

  test("open_servicenow_module commits metadata when it resolves before navigator", async () => {
    const target =
      "cmdb_ci_db_hbase_instance_list.do?sysparm_userpref_module=45a4f1329f1221001e021a1cf67fcfe5";
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: {
                value: "45a4f1329f1221001e021a1cf67fcfe5",
                display_value: "45a4f1329f1221001e021a1cf67fcfe5",
              },
              title: { value: "HBase", display_value: "HBase" },
              application: {
                value: "app1",
                display_value: "Configuration",
              },
              table: {
                value: "cmdb_ci_db_hbase_instance",
                display_value: "cmdb_ci_db_hbase_instance",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve([
                {
                  frameId: 0,
                  result: {
                    ok: false,
                    reason: "navigator_candidate_not_found",
                  },
                },
              ]),
            100,
          ),
        ),
    );

    const result = await toolRegistry.execute(
      {
        id: "open-module-fast-metadata",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({
            application: "Configuration",
            path: ["Database Instances", "HBase"],
          }),
        },
      },
      123,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Winning path: metadata");
    expect(result).toContain("Navigator: pending");
  });

  test("open_servicenow_module rejects non-ServiceNow origins", async () => {
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://example.com/start",
      title: "Start",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const result = await toolRegistry.execute(
      {
        id: "open-module",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({ path: ["HBase"] }),
        },
      },
      123,
    );

    expect(result).toContain("not_servicenow_origin");
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test("open_servicenow_module returns candidate diagnostics when unresolved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: { value: "abc123", display_value: "abc123" },
              title: { value: "Incidents", display_value: "Incidents" },
              application: { value: "app1", display_value: "Incident" },
              table: { value: "incident", display_value: "incident" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
      title: "Home | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));

    const result = await toolRegistry.execute(
      {
        id: "open-module",
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify({ path: ["Missing Module"] }),
        },
      },
      123,
    );

    expect(result).toContain("no_confident_module_match");
    expect(result).toContain("Top candidates:");
    expect(result).toContain("Incident > Incidents");
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test("apply_list_filter navigates to the structured ServiceNow list query", async () => {
    const query =
      "caller_id=abc123^ORcategory=inquiry^ORstate=1^ORassigned_toISEMPTY";
    const target = `incident_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: { value: "abc123", display_value: "abc123" },
              name: { value: "Margaret Grey", display_value: "Margaret Grey" },
              first_name: { value: "Margaret", display_value: "Margaret" },
              last_name: { value: "Grey", display_value: "Grey" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/incident_list.do",
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async () => [
      {
        frameId: 9,
        result: {
          ok: true,
          platform: "servicenow",
          table: "incident",
          query,
          targetUrl,
          conditions: [
            {
              label: "Caller",
              field: "caller_id",
              operator: "is",
              displayValue: "Margaret Grey",
              predicate: "caller_id=abc123",
            },
            {
              label: "Assigned to",
              field: "assigned_to",
              operator: "is empty",
              displayValue: "",
              predicate: "assigned_toISEMPTY",
            },
          ],
        },
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "OR",
            conditions: [
              { field: "Caller", operator: "is", value: "Margaret Grey" },
              { field: "Assigned to", operator: "is", value: "" },
            ],
          }),
        },
      },
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 123, allFrames: true },
        world: "MAIN",
        args: [
          expect.objectContaining({
            table: "incident",
            referenceValueOverrides: [
              expect.objectContaining({
                field: "Caller",
                referenceTable: "sys_user",
                displayValue: "Margaret Grey",
                sysId: "abc123",
              }),
            ],
          }),
        ],
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/now/table/sys_user?"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied incident list filter.");
    expect(result).toContain(`sysparm_query=${query}`);
  });

  test("apply_list_filter maps contains operators to ServiceNow LIKE predicates", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/now/nav/ui/classic/params/target/incident_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Incidents | ServiceNow";
    document.body.innerHTML = "";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter-contains",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            conditions: [
              {
                field: "Short description",
                operator: "contains",
                value: "#SERIES-abc123",
              },
            ],
          }),
        },
      },
      123,
    );

    const query = "short_descriptionLIKE#SERIES-abc123";
    const target = `incident_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic17.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).toContain("Short description contains");
  });

  test("apply_list_filter encodes incident choice and reference filters from a list URL without table DOM", async () => {
    const serviceNowUrl =
      "https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/incident_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Incidents | ServiceNow";
    document.body.innerHTML = "";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              sys_id: { value: "group123", display_value: "group123" },
              name: { value: "Service Desk", display_value: "Service Desk" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "AND",
            conditions: [
              { field: "Priority", operator: "is", value: "2 - High" },
              { field: "Category", operator: "is", value: "Hardware" },
              { field: "State", operator: "is", value: "Closed" },
              {
                field: "Assignment group",
                operator: "is",
                value: "Service Desk",
              },
            ],
          }),
        },
      },
      123,
    );

    const query =
      "priority=2^category=hardware^state=7^assignment_group=group123";
    const target = `incident_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/now/table/sys_user_group?"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied incident list filter.");
    expect(result).toContain(`sysparm_query=${query}`);
  });

  test("apply_list_filter encodes incident priority labels before validation", async () => {
    const serviceNowUrl =
      "https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/incident_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Incidents | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/now/table/sys_user?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                sys_id: { value: "user123", display_value: "user123" },
                name: {
                  value: "System Administrator",
                  display_value: "System Administrator",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/now/table/sys_dictionary?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                element: "category",
                column_label: "Category",
                internal_type: "string",
                reference: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "OR",
            conditions: [
              {
                field: "Caller",
                operator: "is",
                value: "System Administrator",
              },
              {
                field: "Category",
                operator: "is",
                value: "Inquiry / Help",
              },
              { field: "Priority", operator: "is", value: "4 - Low" },
            ],
          }),
        },
      },
      123,
    );

    const query = "caller_id=user123^ORcategory=inquiry^ORpriority=4";

    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).not.toContain("category=Inquiry / Help");
    expect(result).not.toContain("priority=4 - Low");
  });

  test("apply_list_filter prefers exact field names over duplicate ServiceNow labels", async () => {
    const serviceNowUrl =
      "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/change_request_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Change Requests | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/now/table/sys_dictionary?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                element: "assigned_to",
                column_label: "Assigned to",
                internal_type: "reference",
                reference: "sys_user",
              },
              {
                element: "phase_state",
                column_label: "State",
                internal_type: "choice",
                reference: "",
              },
              {
                element: "state",
                column_label: "State",
                internal_type: "choice",
                reference: "",
              },
              {
                element: "short_description",
                column_label: "Short description",
                internal_type: "string",
                reference: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Change Requests | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "OR",
            conditions: [
              { field: "Assigned to", operator: "is", value: "Bow Ruggeri" },
              { field: "State", operator: "is", value: "Review" },
              { field: "Model", operator: "is", value: "" },
              {
                field: "Short description",
                operator: "is",
                value: "Apply patches 10.2.0.1 to 10.2.0.3",
              },
            ],
          }),
        },
      },
      123,
    );

    const query =
      "assigned_to=Bow Ruggeri^ORstate=review^ORchg_modelISEMPTY^ORshort_description=Apply patches 10.2.0.1 to 10.2.0.3";

    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).not.toContain("phase_state=review");
    expect(result).not.toContain("unknown_field:Model");
  });

  test("apply_list_filter maps problem statement to short_description without matching state", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/now/nav/ui/classic/params/target/problem_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Problems | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/now/table/sys_dictionary?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                element: "state",
                column_label: "State",
                internal_type: "choice",
                reference: "",
              },
              {
                element: "short_description",
                column_label: "Problem statement",
                internal_type: "string",
                reference: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Problems | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-problem-statement-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            conditions: [
              {
                field: "Problem statement",
                operator: "contains",
                value: "#SERIES-abc",
              },
            ],
            table: "problem",
          }),
        },
      },
      123,
    );

    expect(result).toContain("sysparm_query=short_descriptionLIKE#SERIES-abc");
    expect(result).not.toContain("stateLIKE");
  });

  test("apply_list_filter resolves catalog choice labels and title references", async () => {
    const serviceNowUrl =
      "https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/sc_cat_item_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Catalog Items | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/now/table/sys_dictionary?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                element: "type",
                column_label: "Type",
                internal_type: "string",
                reference: "",
              },
              {
                element: "category",
                column_label: "Category",
                internal_type: "reference",
                reference: "sc_category",
              },
              {
                element: "name",
                column_label: "Name",
                internal_type: "string",
                reference: "",
              },
              {
                element: "short_description",
                column_label: "Short description",
                internal_type: "string",
                reference: "",
              },
              {
                element: "active",
                column_label: "Active",
                internal_type: "boolean",
                reference: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.includes("/api/now/table/sys_choice?") &&
        decodeURIComponent(url).includes("element=type")
      ) {
        return new Response(
          JSON.stringify({
            result: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/now/table/sc_cat_item?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                type: { value: "item", display_value: "Item" },
                category: {
                  value: "app-access",
                  display_value: "Application and Account Access",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/now/table/sc_category?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                sys_id: "catalog-processing",
                title: "Catalog Processing",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Catalog Items | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "OR",
            conditions: [
              { field: "Type", operator: "is", value: "Item" },
              {
                field: "Category",
                operator: "is",
                value: "Application and Account Access",
              },
              { field: "Name", operator: "is", value: "Request zoom webinar" },
              {
                field: "Short description",
                operator: "is",
                value: "Request to book a zoom webinar",
              },
              { field: "Active", operator: "is", value: "true" },
            ],
          }),
        },
      },
      123,
    );

    const query =
      "type=item^ORcategory=app-access^ORname=Request zoom webinar^ORshort_description=Request to book a zoom webinar^ORactive=true";

    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).not.toContain("type=Item");
    expect(result).not.toContain("category=Application and Account Access");
  });

  test("apply_list_filter resolves inherited hardware asset fields from a list URL", async () => {
    const serviceNowUrl =
      "https://workarenapublic15.service-now.com/now/nav/ui/classic/params/target/alm_hardware_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Hardware | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/now/table/cmdb_model_category?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                sys_id: {
                  value: "computer-cat",
                  display_value: "computer-cat",
                },
                name: { value: "Computer", display_value: "Computer" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/now/table/sys_choice?")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                value: { value: "secondary", display_value: "secondary" },
                label: { value: "Secondary", display_value: "Secondary" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Hardware | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-filter",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_FILTER,
          arguments: JSON.stringify({
            join: "AND",
            table: "alm_hardware_list",
            conditions: [
              { field: "Asset function", operator: "is", value: "Secondary" },
              { field: "Model category", operator: "is", value: "Computer" },
              { field: "Assigned to", operator: "is empty", value: "" },
            ],
          }),
        },
      },
      123,
    );

    const query =
      "asset_function=secondary^model_category=computer-cat^assigned_toISEMPTY";
    const target = `alm_hardware_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic15.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied alm_hardware list filter.");
    expect(result).toContain(`sysparm_query=${query}`);
  });

  test("apply_list_sort navigates to the structured ServiceNow list sort query", async () => {
    const query = "ORDERBYDESCnumber^ORDERBYDESCcalendar_duration";
    const target = `incident_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/now/nav/ui/classic/params/target/incident_list.do",
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async () => [
      {
        frameId: 9,
        result: {
          ok: true,
          platform: "servicenow",
          table: "incident",
          query,
          targetUrl,
          sorts: [
            {
              label: "Number",
              field: "number",
              direction: "desc",
              predicate: "ORDERBYDESCnumber",
            },
            {
              label: "Duration",
              field: "calendar_duration",
              direction: "desc",
              predicate: "ORDERBYDESCcalendar_duration",
            },
          ],
        },
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-sort",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_SORT,
          arguments: JSON.stringify({
            sorts: [
              { field: "Number", direction: "descending" },
              { field: "Duration", direction: "descending" },
            ],
          }),
        },
      },
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 123, allFrames: true },
        world: "MAIN",
        args: [
          expect.objectContaining({
            table: "incident",
            sorts: [
              { field: "Number", direction: "descending" },
              { field: "Duration", direction: "descending" },
            ],
          }),
        ],
      }),
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied incident list sorting.");
    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).toContain("ORDERBYDESCcalendar_duration");
  });

  test("apply_list_sort resolves hidden hardware asset fields from a list URL", async () => {
    const serviceNowUrl =
      "https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/alm_hardware_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Hardware | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Hardware | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-sort",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_SORT,
          arguments: JSON.stringify({
            sorts: [
              { field: "Substate", direction: "ascending" },
              { field: "Vendor", direction: "ascending" },
              { field: "Cost", direction: "ascending" },
            ],
          }),
        },
      },
      123,
    );

    const query = "ORDERBYsubstatus^ORDERBYvendor^ORDERBYcost";
    const target = `alm_hardware_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied alm_hardware list sorting.");
    expect(result).toContain(`sysparm_query=${query}`);
  });

  test("apply_list_sort resolves inherited ServiceNow task fields on change request lists", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/now/nav/ui/classic/params/target/change_request_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Change Requests | ServiceNow";
    document.body.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              element: "chg_model",
              column_label: "Model",
              internal_type: "reference",
              reference: "chg_model",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Change Requests | ServiceNow",
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async () => ({}));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-sort",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_SORT,
          arguments: JSON.stringify({
            sorts: [
              { field: "Closed by", direction: "ascending" },
              { field: "Description", direction: "descending" },
            ],
          }),
        },
      },
      123,
    );

    const query = "ORDERBYclosed_by^ORDERBYDESCdescription";
    const target = `change_request_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
    const targetUrl = `https://workarenapublic17.service-now.com/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;

    expect(chrome.tabs.update).toHaveBeenCalledWith(123, { url: targetUrl });
    expect(result).toContain("Applied change_request list sorting.");
    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).not.toContain("unknown_field:Closed by");
  });

  test("apply_list_action selects ServiceNow rows and confirms a visible action", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/incident_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Incidents | ServiceNow";
    document.body.innerHTML = `
            <select id="action-select">
              <option value="">Actions on selected rows...</option>
              <option value="delete">Delete</option>
            </select>
            <table class="data_list_table">
              <tbody>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>INC0010001</td>
                  <td>Keep this row</td>
                </tr>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>INC0010002</td>
                  <td>Delete this row</td>
                </tr>
              </tbody>
            </table>
        `;
    document.querySelector("#action-select")?.addEventListener("change", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = `<button id="confirm-delete">Delete</button>`;
      document.body.append(dialog);
    });
    const confirmClicks: string[] = [];
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.id === "confirm-delete") confirmClicks.push("delete");
    });

    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Incidents | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-action",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_ACTION,
          arguments: JSON.stringify({
            records: ["INC0010002"],
            action: "Delete",
          }),
        },
      },
      123,
    );

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox']",
    );
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(
      (document.querySelector("#action-select") as HTMLSelectElement).value,
    ).toBe("delete");
    expect(confirmClicks).toEqual(["delete"]);
    expect(result).toContain('Applied ServiceNow list action "Delete"');
    expect(result).toContain("Selected rows: INC0010002");
    expect(result).toContain("Confirmed dialog: true");
  });

  test("apply_list_action discovers ServiceNow rows without tbody wrappers", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/problem_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Problems | ServiceNow";
    document.body.innerHTML = `
            <select id="action-select">
              <option value="">Actions on selected rows...</option>
              <option value="duplicate">Mark as Duplicate</option>
            </select>
            <table class="data_list_table">
              <tr>
                <td><input type="checkbox" /></td>
                <td>PRB0050163</td>
                <td>Similar air bag fish. #SERIES-abc</td>
              </tr>
              <tr>
                <td><input type="checkbox" /></td>
                <td>PRB0050160</td>
                <td>Night second source. #SERIES-abc</td>
              </tr>
            </table>
        `;

    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Problems | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-action-direct-rows",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_ACTION,
          arguments: JSON.stringify({
            records: ["PRB0050160"],
            action: "Mark as Duplicate",
            table: "problem",
            confirm: false,
          }),
        },
      },
      123,
    );

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox']",
    );
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(
      (document.querySelector("#action-select") as HTMLSelectElement).value,
    ).toBe("duplicate");
    expect(result).toContain(
      'Applied ServiceNow list action "Mark as Duplicate"',
    );
    expect(result).toContain("Selected rows: PRB0050160");
  });

  test("apply_list_action fills a related ServiceNow reference before confirming", async () => {
    const serviceNowUrl =
      "https://workarenapublic17.service-now.com/problem_list.do";
    window.location.href = serviceNowUrl;
    document.title = "Problems | ServiceNow";
    document.body.innerHTML = `
            <select id="action-select">
              <option value="">Actions on selected rows...</option>
              <option value="duplicate">Mark as Duplicate</option>
            </select>
            <table class="data_list_table">
              <tr>
                <td><input type="checkbox" /></td>
                <td>PRB0050163</td>
                <td>Similar air bag fish. #SERIES-abc</td>
              </tr>
              <tr>
                <td><input type="checkbox" /></td>
                <td>PRB0050160</td>
                <td>Similar air bag fish. #SERIES-abc</td>
              </tr>
            </table>
        `;
    document.querySelector("#action-select")?.addEventListener("change", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = `
          <label for="sys_display.problem.duplicate_of">Duplicate of</label>
          <input id="problem.duplicate_of" name="problem.duplicate_of" type="hidden" />
          <input id="sys_display.problem.duplicate_of" name="sys_display.problem.duplicate_of" type="search" />
          <button id="confirm-duplicate">OK</button>
        `;
      document.body.append(dialog);
    });
    const setValueCalls: any[] = [];
    (window as any).g_form = {
      setValue: vi.fn((field: string, sysId: string, display: string) => {
        setValueCalls.push([field, sysId, display]);
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: [{ sys_id: "target-sys-id", number: "PRB0050163" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );

    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: serviceNowUrl,
      title: "Problems | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (options: any) => [
      {
        frameId: 0,
        result: await options.func(options.args[0]),
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "apply-action-related-record",
        type: "function",
        function: {
          name: ToolName.APPLY_LIST_ACTION,
          arguments: JSON.stringify({
            records: ["PRB0050160"],
            action: "Mark as Duplicate",
            relatedRecord: "PRB0050163",
            relatedField: "Duplicate of",
            table: "problem",
          }),
        },
      },
      123,
    );

    expect(setValueCalls).toEqual([
      ["duplicate_of", "target-sys-id", "PRB0050163"],
    ]);
    expect(
      (
        document.querySelector(
          "#sys_display\\.problem\\.duplicate_of",
        ) as HTMLInputElement
      ).value,
    ).toBe("PRB0050163");
    expect(result).toContain("Related record: duplicate_of = PRB0050163");
    expect(result).toContain("Confirmed dialog: true");
  });

  test("configure_catalog_item fills catalog controls and clicks submit", async () => {
    document.title = "Standard Laptop | ServiceNow";
    document.body.innerHTML = `
            <input id="sysparm_quantity" name="sysparm_quantity" type="hidden" value="1" />
            <label for="quantity">Quantity</label>
            <select id="quantity">
                <option value="1">1</option>
                <option value="10">10</option>
            </select>
            <label for="acrobat">Adobe Acrobat</label>
            <input id="acrobat" type="checkbox" />
            <label for="photoshop">Adobe Photoshop</label>
            <input id="photoshop" type="checkbox" checked />
            <label for="software">Additional software requirements</label>
            <textarea id="software"></textarea>
            <label for="duration">How long do you need it for ?</label>
            <select id="duration">
                <option value="1_day">1 day</option>
                <option value="1_week">1 week</option>
            </select>
            <button id="order">Order Now</button>
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const orderButton = document.getElementById("order")!;
    let committedQuantity = "1";
    orderButton.addEventListener("click", () => {
      orderButton.setAttribute("data-clicked", "true");
      orderButton.setAttribute("data-submitted-quantity", committedQuantity);
    });
    document.getElementById("duration")!.addEventListener("change", () => {
      (document.getElementById("quantity") as HTMLSelectElement).value = "1";
    });
    document.getElementById("quantity")!.addEventListener("change", () => {
      const value = (document.getElementById("quantity") as HTMLSelectElement)
        .value;
      setTimeout(() => {
        committedQuantity = value;
      }, 100);
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/order_status.do?sys_id=req123",
      title: "Order Status | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            quantity: "10",
            textFields: [
              {
                field: "Additional software requirements",
                value: "Trello, Salesforce",
              },
            ],
            optionFields: [
              {
                field: "How long do you need it for ?",
                value: "1 week",
              },
            ],
            checkboxes: [
              { label: "Adobe Acrobat", checked: true },
              { label: "Adobe Photoshop", checked: false },
            ],
            submit: true,
            submitButton: "Order Now",
          }),
        },
      },
      123,
    );

    expect(
      (document.getElementById("quantity") as HTMLSelectElement).value,
    ).toBe("10");
    expect(
      (document.getElementById("sysparm_quantity") as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (document.getElementById("acrobat") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("photoshop") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (document.getElementById("software") as HTMLTextAreaElement).value,
    ).toBe("Trello, Salesforce");
    expect(
      (document.getElementById("duration") as HTMLSelectElement).value,
    ).toBe("1_week");
    expect(orderButton.getAttribute("data-clicked")).toBe("true");
    expect(orderButton.getAttribute("data-submitted-quantity")).toBe("10");
    expect(result).toContain("Configured catalog item.");
    expect(result).toContain("How long do you need it for ?=1 week");
    expect(result).toContain("Clicked submit control");
    rectSpy.mockRestore();
  });

  test("configure_catalog_item sets the only dropdown with a matching option when the label is hidden", async () => {
    document.title = "Loaner Laptop | ServiceNow";
    document.body.innerHTML = `
            <select id="IO:f3776a9ac0a8010a003825c7b4d9066d">
                <option value="1 day">1 day</option>
                <option value="1 month">1 month</option>
                <option value="1 week">1 week</option>
                <option value="2 weeks">2 weeks</option>
            </select>
        `;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/catalog_item",
      title: "Loaner Laptop | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            optionFields: [
              {
                field: "How long do you need it for ?",
                value: "1 week",
              },
            ],
          }),
        },
      },
      123,
    );

    expect(
      (
        document.getElementById(
          "IO:f3776a9ac0a8010a003825c7b4d9066d",
        ) as HTMLSelectElement
      ).value,
    ).toBe("1 week");
    expect(result).toContain("Configured catalog item.");
    expect(result).toContain("How long do you need it for ?=1 week");
  });

  test("configure_catalog_item refuses to submit a mismatched expected item", async () => {
    document.title = "Development Laptop (PC) | ServiceNow";
    document.body.innerHTML = `
            <h1>Development Laptop (PC)</h1>
            <label for="quantity">Quantity</label>
            <input id="quantity" name="quantity" value="1" />
            <button id="order">Order Now</button>
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const orderButton = document.getElementById("order")!;
    orderButton.addEventListener("click", () => {
      orderButton.setAttribute("data-clicked", "true");
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/catalog_item",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            expectedItem: "Developer Laptop (Mac)",
            quantity: "6",
            submit: true,
            submitButton: "Order Now",
          }),
        },
      },
      123,
    );

    expect(
      (document.getElementById("quantity") as HTMLInputElement).value,
    ).toBe("6");
    expect(orderButton.getAttribute("data-clicked")).toBeNull();
    expect(result).toContain("Catalog item configuration incomplete.");
    expect(result).toContain(
      "Catalog item mismatch: expected Developer Laptop (Mac); visible Development Laptop (PC).",
    );
    rectSpy.mockRestore();
  });

  test("configure_catalog_item resolves unassociated ServiceNow variable labels by page order", async () => {
    document.title = "Loaner Laptop | ServiceNow";
    document.body.innerHTML = `
            <div class="question_text">When do you need it ?</div>
            <div class="variable_control">
                <input id="IO:f3776a9ac0a8010a003825c7b49b6068" name="IO:f3776a9ac0a8010a003825c7b49b6068" />
            </div>
            <div class="question_text">How long do you need it for ?</div>
            <div class="variable_control">
                <select id="IO:f3776a9ac0a8010a003825c7b4d9066d" name="IO:f3776a9ac0a8010a003825c7b4d9066d">
                    <option value="1 day">1 day</option>
                    <option value="1 week">1 week</option>
                </select>
            </div>
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/catalog_item",
      title: "Loaner Laptop | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            textFields: [
              {
                field: "When do you need it ?",
                value: "On time for the next meeting",
              },
            ],
            optionFields: [
              {
                field: "How long do you need it for ?",
                value: "1 week",
              },
            ],
          }),
        },
      },
      123,
    );

    expect(
      (
        document.getElementById(
          "IO:f3776a9ac0a8010a003825c7b49b6068",
        ) as HTMLInputElement
      ).value,
    ).toBe("On time for the next meeting");
    expect(
      (
        document.getElementById(
          "IO:f3776a9ac0a8010a003825c7b4d9066d",
        ) as HTMLSelectElement
      ).value,
    ).toBe("1 week");
    expect(result).toContain("Configured catalog item.");
    expect(result).toContain(
      'When do you need it ?="On time for the next meeting"',
    );
    expect(result).toContain("How long do you need it for ?=1 week");
    rectSpy.mockRestore();
  });

  test("configure_catalog_item resolves radio-like catalog option groups by page order", async () => {
    document.title = "Development Laptop (PC) | ServiceNow";
    document.body.innerHTML = `
            <div class="question_text">What size solid state drive do you want?</div>
            <input id="IO:ssd_250" name="IO:ssd" type="radio" value="250" style="display:none" />
            <label type="radio" name="IO:ssd" checked="true">250 GB</label>
            <input id="IO:ssd_500" name="IO:ssd" type="radio" value="500" style="display:none" />
            <label type="radio" name="IO:ssd" checked="false">500 GB [add $300.00]</label>
            <input id="IO:ssd_checked_radio" name="IO:ssd_checked_radio" type="hidden" value="" />
            <div class="question_text">Please specify an operating system</div>
            <input id="IO:os_windows8" name="IO:os" type="radio" value="law, around, book" style="display:none" />
            <label type="radio" name="IO:os" checked="false">Windows 8</label>
            <input id="IO:os_windows8_canonical" name="IO:os" type="radio" value="windows8" style="display:none" />
            <label type="radio" name="IO:os" checked="false">Windows 8</label>
            <input id="IO:os_ubuntu" name="IO:os" type="radio" value="ubuntu" style="display:none" checked />
            <label type="radio" name="IO:os" checked="true">Ubuntu [subtract $100.00]</label>
            <input id="IO:os_checked_radio" name="IO:os_checked_radio" type="hidden" value="" />
            <label for="quantity">Quantity</label>
            <select id="quantity" name="quantity">
                <option value="1">1</option>
                <option value="2">2</option>
            </select>
            <button id="order" type="button">Order Now</button>
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      setValue: vi.fn((field: string, value: string) => {
        values[field] = value;
      }),
    };
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/catalog_item",
      title: "Development Laptop (PC) | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            optionFields: [
              {
                field: "What size solid state drive do you want?",
                value: "250",
              },
              {
                field: "Please specify an operating system",
                value: "Windows 8",
              },
            ],
            submit: true,
            submitButton: "Order Now",
          }),
        },
      },
      123,
    );

    expect(
      (document.getElementById("IO:ssd_250") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("IO:ssd_checked_radio") as HTMLInputElement)
        .value,
    ).toBe("IO:ssd_250");
    expect(
      (document.getElementById("IO:os_windows8") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (document.getElementById("IO:os_windows8_canonical") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (document.getElementById("IO:os_checked_radio") as HTMLInputElement)
        .value,
    ).toBe("IO:os_windows8_canonical");
    expect(values["IO:ssd"]).toBe("250");
    expect(values["IO:os"]).toBe("windows8");
    expect(result).toContain("Configured catalog item.");
    expect(result).toContain("What size solid state drive do you want?=250");
    expect(result).toContain("Please specify an operating system=Windows 8");
    (window as any).g_form = originalGForm;
    rectSpy.mockRestore();
  });

  test("configure_catalog_item commits ServiceNow checkbox variables through g_form", async () => {
    document.title = "Developer Laptop (Mac) | ServiceNow";
    document.body.innerHTML = `
            <label id="ni.IO:acrobat_label" type="checkbox" checked="false" control="ni.IO:acrobat" name="ni.IO:acrobat">Adobe Acrobat</label>
            <input id="ni.IO:acrobat" name="ni.IO:acrobat" type="checkbox" />
            <input id="IO:acrobat" name="IO:acrobat" type="hidden" value="false" />
            <label id="ni.IO:photoshop_label" type="checkbox" checked="true" control="ni.IO:photoshop" name="ni.IO:photoshop">Adobe Photoshop</label>
            <input id="ni.IO:photoshop" name="ni.IO:photoshop" type="checkbox" checked />
            <input id="IO:photoshop" name="IO:photoshop" type="hidden" value="true" />
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      setValue: vi.fn((field: string, value: string) => {
        values[field] = value;
      }),
    };
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/catalog_item",
      title: "Developer Laptop (Mac) | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            checkboxes: [
              { label: "Adobe Acrobat", checked: true },
              { label: "Adobe Photoshop", checked: false },
            ],
          }),
        },
      },
      123,
    );

    expect(values["IO:acrobat"]).toBe("true");
    expect(values["IO:photoshop"]).toBe("false");
    expect(
      (document.getElementById("ni.IO:acrobat") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("IO:acrobat") as HTMLInputElement).value,
    ).toBe("true");
    expect(
      (document.getElementById("IO:photoshop") as HTMLInputElement).value,
    ).toBe("false");
    expect(
      document.getElementById("ni.IO:photoshop_label")!.getAttribute("checked"),
    ).toBe("false");
    expect(result).toContain("Adobe Acrobat=checked");
    expect(result).toContain("Adobe Photoshop=unchecked");
    (window as any).g_form = originalGForm;
    rectSpy.mockRestore();
  });

  test("configure_servicenow_form fills fields by label and clicks submit", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <label for="incident.contact_type">Channel</label>
            <select id="incident.contact_type" name="incident.contact_type">
                <option value="">-- None --</option>
                <option value="phone">Phone</option>
            </select>
            <button id="sysverb_insert">Submit</button>
    `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    const originalGsftSubmit = (window as any).gsftSubmit;
    const gsftSubmit = vi.fn();
    (window as any).gsftSubmit = gsftSubmit;
    (window as any).g_form = {
      getFieldNames: () => ["short_description", "contact_type"],
      getControl: (field: string) =>
        document.querySelector(`[name="incident.${field}"]`),
      getLabelOf: (field: string) =>
        field === "short_description" ? "Short description" : "Channel",
      getValue: (field: string) => values[field] || "",
      getDisplayValue: () => "INC0034429",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(`[name="incident.${field}"]`) as
          | HTMLInputElement
          | HTMLSelectElement
          | null;
        if (control) control.value = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "Create INC0034430 | Incident | ServiceNow";
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const execution = await toolRegistry.executeDetailed(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
                { field: "Channel", value: "Phone" },
              ],
              submit: true,
            }),
          },
        },
        123,
      );
      const result = execution.result;

      expect(values.short_description).toBe("EMAIL Server Down Again");
      expect(values.contact_type).toBe("phone");
      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(gsftSubmit).not.toHaveBeenCalled();
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).not.toContain("Mismatches:");
      expect(result).toContain("Submit method: click (sysverb_insert)");
      expect(result).toContain("Submitted ServiceNow form record: INC0034429");
      expect(execution.evidence?.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "fill_attempted",
          "field_value_observed",
          "submit_attempted",
          "submit_succeeded",
          "record_identity_observed",
        ]),
      );
    } finally {
      (window as any).g_form = originalGForm;
      if (originalGsftSubmit === undefined) {
        delete (window as any).gsftSubmit;
      } else {
        (window as any).gsftSubmit = originalGsftSubmit;
      }
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form runs form script in the current record frame", async () => {
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: "Create INC0034429 | Incident | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (_details: any) => [
      {
        frameId: 0,
        result: {
          matched: true,
          ok: true,
          url: "https://workarenapublic16.service-now.com/incident.do",
          title: "Create INC0034429 | Incident | ServiceNow",
          configured: [
            "Short description (short_description) = Email system down",
          ],
          mismatches: [],
          submitClicked: false,
          tableName: "incident",
          fieldCount: 3,
        },
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-servicenow-form-frame",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_SERVICENOW_FORM,
          arguments: JSON.stringify({
            fields: [
              { field: "Short description", value: "Email system down" },
            ],
            submit: false,
          }),
        },
      },
      123,
    );

    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(
      (chrome.scripting.executeScript as any).mock.calls[0][0].target,
    ).toEqual({ tabId: 123 });
    expect(result).toContain("Configured ServiceNow form.");
  });

  test("configure_servicenow_form targets the ServiceNow record child frame", async () => {
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/problem.do",
      title: "Create PRB0034429 | Problem | ServiceNow",
      groupId: -1,
    }));
    (chrome.webNavigation as any).getAllFrames = vi.fn(async () => [
      {
        frameId: 0,
        url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/problem.do",
      },
      {
        frameId: 5,
        url: "https://workarenapublic16.service-now.com/problem.do",
      },
    ]);
    (chrome.scripting.executeScript as any) = vi.fn(async () => [
      {
        frameId: 5,
        result: {
          matched: true,
          ok: true,
          url: "https://workarenapublic16.service-now.com/problem.do",
          title: "Create PRB0034429 | Problem | ServiceNow",
          configured: [
            "Problem statement (short_description) = Email system down",
          ],
          mismatches: [],
          submitClicked: false,
          tableName: "problem",
          fieldCount: 3,
        },
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-servicenow-form-child-frame",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_SERVICENOW_FORM,
          arguments: JSON.stringify({
            fields: [
              { field: "Problem statement", value: "Email system down" },
            ],
            submit: false,
          }),
        },
      },
      123,
    );

    expect(
      (chrome.scripting.executeScript as any).mock.calls[0][0].target,
    ).toEqual({ tabId: 123, frameIds: [5] });
    expect(result).toContain("Configured ServiceNow form.");
  });

  test("configure_servicenow_form returns an error when the injected script stalls", async () => {
    (chrome.scripting.executeScript as any) = vi.fn(
      () => new Promise(() => {}),
    );
    vi.useFakeTimers();

    try {
      const resultPromise = toolRegistry.execute(
        {
          id: "configure-servicenow-form-timeout",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Short description", value: "Stalled form" }],
              submit: false,
            }),
          },
        },
        123,
      );

      await vi.advanceTimersByTimeAsync(25_000);

      await expect(resultPromise).resolves.toContain(
        "Error configuring ServiceNow form: configure_servicenow_form script timed out after 25000ms",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("configure_servicenow_form does not report submission while still on the same create record", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <button id="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["short_description"],
      getControl: (field: string) =>
        document.querySelector(`[name="incident.${field}"]`),
      getLabelOf: () => "Short description",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="incident.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const execution = await toolRegistry.executeDetailed(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
              ],
              submit: true,
            }),
          },
        },
        123,
      );
      const result = execution.result;

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("ServiceNow form configuration incomplete.");
      expect(result).toContain(
        "submit did not leave the create form for INC0034429",
      );
      expect(result).not.toContain("Submitted ServiceNow form record:");
      expect(execution.evidence?.map((event) => event.type)).toContain(
        "uncertainty_detected",
      );
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form falls back to ServiceNow submit API when click leaves an uncommitted form", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    const staleSysId = "11111111111111111111111111111111";
    const submittedSysId = "22222222222222222222222222222222";
    const serialNumber = "SN-5e7a307c-8d84-4bff-b23f-0e9a2d18fb29";
    (window as any).happyDOM.setURL(`${origin}/alm_hardware.do`);
    document.title = "New Record | Hardware | ServiceNow";
    document.body.innerHTML = `
            <form id="hardware-form">
                <label for="alm_hardware.serial_number">Serial number</label>
                <input id="alm_hardware.serial_number" name="alm_hardware.serial_number" />
                <button id="sysverb_insert" value="sysverb_insert">Submit</button>
            </form>
        `;
    const values: Record<string, string> = {};
    let fallbackSubmitted = false;
    const originalGForm = (window as any).g_form;
    const originalGsftSubmit = (window as any).gsftSubmit;
    const originalFetch = globalThis.fetch;
    (window as any).g_form = {
      getTableName: () => "alm_hardware",
      getUniqueValue: () => staleSysId,
      getFormElement: () => document.getElementById("hardware-form"),
      getFieldNames: () => ["serial_number"],
      getControl: (field: string) =>
        document.querySelector(`[name="alm_hardware.${field}"]`),
      getLabelOf: () => "Serial number",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="alm_hardware.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    (window as any).gsftSubmit = vi.fn(() => {
      fallbackSubmitted = true;
      document.title = "Hardware | ServiceNow";
      (window as any).happyDOM.setURL(`${origin}/welcome.do`);
    });
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      const result =
        fallbackSubmitted && text.includes("serial_number%3D")
          ? [{ sys_id: submittedSysId }]
          : [];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: window.location.href,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...(details.args || [])), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-native-submit-fallback",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Serial number", value: serialNumber }],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect((window as any).gsftSubmit).toHaveBeenCalledOnce();
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain(
        "Fallback submit method: gsftSubmit (sysverb_insert)",
      );
      expect(result).toContain(
        `Submitted ServiceNow form sys_id: ${submittedSysId}`,
      );
      const expectedUrl = `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        `alm_hardware.do?sys_id=${submittedSysId}`,
      )}`;
      expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
        url: expectedUrl,
      });
      expect(result).toContain(
        `Opened submitted ServiceNow record: ${expectedUrl}`,
      );
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      if (originalGsftSubmit === undefined) {
        delete (window as any).gsftSubmit;
      } else {
        (window as any).gsftSubmit = originalGsftSubmit;
      }
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form reports ServiceNow submit diagnostics", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "New Record | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <label for="incident.vendor">Vendor</label>
            <input id="incident.vendor" name="incident.vendor" />
            <button id="sysverb_insert">Submit</button>
        `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => document.body.textContent || "",
    });
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getTableName: () => "incident",
      getFieldNames: () => ["short_description", "vendor"],
      getControl: (field: string) =>
        document.querySelector(`[name="incident.${field}"]`),
      getLabelOf: (field: string) =>
        field === "vendor" ? "Vendor" : "Short description",
      getMissingFields: () => ["vendor"],
      getValue: (field: string) => values[field] || "",
      isMandatory: (field: string) => field === "vendor",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="incident.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      const message = document.createElement("div");
      message.className = "outputmsg_text";
      message.textContent =
        "The following mandatory fields are not filled in: Vendor";
      document.body.append(message);
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...(details.args || [])), frameId: 0 },
    ]);

    try {
      const execution = await toolRegistry.executeDetailed(
        {
          id: "configure-servicenow-form-diagnostics",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
              ],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(execution.result).toContain(
        "ServiceNow form configuration incomplete.",
      );
      expect(execution.result).toContain("Submit diagnostics:");
      expect(execution.result).toContain(
        "Missing mandatory fields: Vendor (vendor)",
      );
      expect(execution.result).toContain(
        "The following mandatory fields are not filled in: Vendor",
      );
      expect(execution.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "uncertainty_detected",
            detail: expect.objectContaining({
              reason: "servicenow_submit_diagnostics",
            }),
          }),
        ]),
      );
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form does not report submission when same create record is wrapped by classic nav", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    (window as any).happyDOM.setURL(`${origin}/incident.do`);
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <button id="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["short_description"],
      getControl: (field: string) =>
        document.querySelector(`[name="incident.${field}"]`),
      getLabelOf: () => "Short description",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="incident.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        "incident.do",
      )}`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
              ],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("ServiceNow form configuration incomplete.");
      expect(result).toContain(
        "submit did not leave the create form for INC0034429",
      );
      expect(result).not.toContain("Submitted ServiceNow form record:");
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form prefers configured Number field over create title record", async () => {
    const origin = "https://workarenapublic15.service-now.com";
    (window as any).happyDOM.setURL(`${origin}/change_request.do`);
    document.title = "Create CHG0040878 | Change Request | ServiceNow";
    document.body.innerHTML = `
            <label for="change_request.number">Number</label>
            <input id="change_request.number" name="change_request.number" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["number"],
      getControl: (field: string) =>
        document.querySelector(`[name="change_request.${field}"]`),
      getLabelOf: () => "Number",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="change_request.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "Create CHG0040879 | Change Request | ServiceNow";
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        "change_request.do",
      )}`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Number", value: "CHG0000021" }],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("Submitted ServiceNow form record: CHG0000021");
      expect(result).not.toContain(
        "Submitted ServiceNow form record: CHG0040878",
      );
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form reads current Number field on submit-only calls", async () => {
    const origin = "https://workarenapublic15.service-now.com";
    (window as any).happyDOM.setURL(`${origin}/change_request.do`);
    document.title = "Create CHG0040884 | Change Request | ServiceNow";
    document.body.innerHTML = `
            <label for="change_request.number">Number</label>
            <input id="change_request.number" name="change_request.number" value="CHG0000021" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = { number: "CHG0000021" };
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["number"],
      getControl: (field: string) =>
        document.querySelector(`[name="change_request.${field}"]`),
      getLabelOf: () => "Number",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
      },
    };
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "Create CHG0040885 | Change Request | ServiceNow";
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        "change_request.do",
      )}`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [],
              submit: true,
              submitButton: "Submit",
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("Submitted ServiceNow form record: CHG0000021");
      expect(result).not.toContain(
        "Submitted ServiceNow form record: CHG0040884",
      );
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form opens the submitted ServiceNow record after insert redirects to a generic page", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    (window as any).happyDOM.setURL(`${origin}/incident.do`);
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    const originalFetch = (window as any).fetch;
    (window as any).g_form = {
      getTableName: () => "incident",
      getFieldNames: () => ["short_description"],
      getControl: (field: string) =>
        document.querySelector(`[name="incident.${field}"]`),
      getLabelOf: () => "Short description",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="incident.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    (window as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: [{ sys_id: "73d10c4693a8035065c5ff87dd03d644" }],
      }),
    }));
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "ServiceNow";
      (window as any).happyDOM.setURL(`${origin}/welcome.do`);
    });
    let currentUrl = `${origin}/welcome.do`;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: currentUrl,
      title: document.title,
      groupId: -1,
    }));
    (chrome.tabs as any).update = vi.fn(async (_tabId: number, update: any) => {
      currentUrl = update.url;
      document.title = "INC0034429 | Incident | ServiceNow";
      return { id: 123, url: currentUrl, title: document.title, groupId: -1 };
    });
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
              ],
              submit: true,
            }),
          },
        },
        123,
      );

      const expectedUrl = `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        "incident.do?sys_id=73d10c4693a8035065c5ff87dd03d644",
      )}`;
      expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
        url: expectedUrl,
      });
      expect(result).toContain("Submitted ServiceNow form record: INC0034429");
      expect(result).toContain(
        `Opened submitted ServiceNow record: ${expectedUrl}`,
      );
      expect(result).toContain(
        "Current title: INC0034429 | Incident | ServiceNow",
      );
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).fetch = originalFetch;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form reports sys_id-only submitted records", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    const sysId = "abcdef0123456789abcdef0123456789";
    (window as any).happyDOM.setURL(`${origin}/sys_user.do`);
    document.title = "Create User | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_user.user_name">User ID</label>
            <input id="sys_user.user_name" name="sys_user.user_name" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    const originalFetch = globalThis.fetch;
    (window as any).g_form = {
      getTableName: () => "sys_user",
      getUniqueValue: () => sysId,
      getFieldNames: () => ["user_name"],
      getControl: (field: string) =>
        document.querySelector(`[name="sys_user.${field}"]`),
      getLabelOf: () => "User ID",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="sys_user.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: [{ sys_id: sysId }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "ServiceNow";
      (window as any).happyDOM.setURL(`${origin}/welcome.do`);
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/welcome.do`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const execution = await toolRegistry.executeDetailed(
        {
          id: "configure-servicenow-sys-id-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "User ID", value: "3765002066203434277" }],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(execution.result).toContain("Configured ServiceNow form.");
      expect(execution.result).toContain(
        `Submitted ServiceNow form sys_id: ${sysId}`,
      );
      const expectedUrl = `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        `sys_user.do?sys_id=${sysId}`,
      )}`;
      expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
        url: expectedUrl,
      });
      expect(execution.result).toContain(
        `Opened submitted ServiceNow record: ${expectedUrl}`,
      );
      expect(execution.result).not.toContain("Mismatches:");
      expect(execution.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "record_identity_observed",
            detail: expect.objectContaining({ table: "sys_user", sysId }),
          }),
        ]),
      );
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form resolves submitted sys_id from identity fields", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    const staleSysId = "11111111111111111111111111111111";
    const submittedSysId = "22222222222222222222222222222222";
    const serialNumber = "SN-2c5b8b2d-2b29-42af-b10c-33623d625244";
    (window as any).happyDOM.setURL(`${origin}/alm_hardware.do`);
    document.title = "New Record | Hardware | ServiceNow";
    document.body.innerHTML = `
            <label for="alm_hardware.serial_number">Serial number</label>
            <input id="alm_hardware.serial_number" name="alm_hardware.serial_number" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    const originalFetch = globalThis.fetch;
    (window as any).g_form = {
      getTableName: () => "alm_hardware",
      getUniqueValue: () => staleSysId,
      getFieldNames: () => ["serial_number"],
      getControl: (field: string) =>
        document.querySelector(`[name="alm_hardware.${field}"]`),
      getLabelOf: () => "Serial number",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="alm_hardware.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      const result = text.includes("serial_number%3D")
        ? [{ sys_id: submittedSysId }]
        : [];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "ServiceNow";
      (window as any).happyDOM.setURL(`${origin}/welcome.do`);
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/welcome.do`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-sys-id-field-resolution",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Serial number", value: serialNumber }],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain(
        `Submitted ServiceNow form sys_id: ${submittedSysId}`,
      );
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form does not treat serial number as a record number", async () => {
    const origin = "https://workarenapublic16.service-now.com";
    const sysId = "abcdef0123456789abcdef0123456789";
    const serialNumber = "SN-2b466749-54f8-4b3c-abb9-eb111bd99269";
    (window as any).happyDOM.setURL(`${origin}/alm_hardware.do`);
    document.title = "New Record | Hardware | ServiceNow";
    document.body.innerHTML = `
            <label for="alm_hardware.serial_number">Serial number</label>
            <input id="alm_hardware.serial_number" name="alm_hardware.serial_number" />
            <button id="sysverb_insert" value="sysverb_insert">Submit</button>
        `;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    const originalFetch = globalThis.fetch;
    (window as any).g_form = {
      getTableName: () => "alm_hardware",
      getUniqueValue: () => sysId,
      getFieldNames: () => ["serial_number"],
      getControl: (field: string) =>
        document.querySelector(`[name="alm_hardware.${field}"]`),
      getLabelOf: () => "Serial number",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        const control = document.querySelector(
          `[name="alm_hardware.${field}"]`,
        ) as HTMLInputElement | null;
        if (control) control.value = value;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: [{ sys_id: sysId }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;
    const submitButton = document.getElementById("sysverb_insert")!;
    submitButton.addEventListener("click", () => {
      submitButton.setAttribute("data-clicked", "true");
      document.title = "ServiceNow";
      (window as any).happyDOM.setURL(`${origin}/welcome.do`);
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: `${origin}/welcome.do`,
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-serial-number-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Serial number", value: serialNumber }],
              submit: true,
            }),
          },
        },
        123,
      );

      expect(submitButton.getAttribute("data-clicked")).toBe("true");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain(`Submitted ServiceNow form sys_id: ${sysId}`);
      expect(result).not.toContain("Submitted ServiceNow form record: ABB9");
      const expectedUrl = `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(
        `alm_hardware.do?sys_id=${sysId}`,
      )}`;
      expect(chrome.tabs.update).toHaveBeenCalledWith(123, {
        url: expectedUrl,
      });
      expect(result).toContain(
        `Opened submitted ServiceNow record: ${expectedUrl}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form commits ServiceNow reference fields with sys_id backing values", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.incident.caller_id">Caller</label>
            <input
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.incident.caller_id",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const values: Record<string, string> = {};
    const sysId = "0123456789abcdef0123456789abcdef";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["caller_id"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "sys_user" }),
      getLabelOf: () => "Caller",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string, display: string) => {
        values[field] = value;
        hiddenInput.value = value;
        displayInput.value = display === "Asus G Series" ? "G Series" : display;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: sysId, name: "Joe Employee" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Caller", value: "Joe Employee" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/now/table/sys_user?"),
        expect.objectContaining({ credentials: "same-origin" }),
      );
      expect(values.caller_id).toBe(sysId);
      expect(hiddenInput.value).toBe(sysId);
      expect(displayInput.value).toBe("Joe Employee");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain("Caller (caller_id) = Joe Employee");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form accepts resolved reference display aliases", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/alm_hardware.do",
    );
    document.title = "Create Hardware Asset | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.alm_hardware.model">Model</label>
            <input
                id="sys_display.alm_hardware.model"
                name="sys_display.alm_hardware.model"
                role="combobox"
            />
            <input id="alm_hardware.model" name="alm_hardware.model" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.alm_hardware.model",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "alm_hardware.model",
    ) as HTMLInputElement;
    displayInput.addEventListener("change", () => {
      if (displayInput.value === "Asus G Series") {
        displayInput.value = "G Series";
      }
    });
    const values: Record<string, string> = {};
    const sysId = "fedcba9876543210fedcba9876543210";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["model"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "cmdb_model" }),
      getLabelOf: () => "Model",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string, display: string) => {
        values[field] = value;
        hiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: sysId, display_name: "Asus G Series" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/alm_hardware.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-alias-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Model", value: "Asus G Series" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(values.model).toBe(sysId);
      expect(hiddenInput.value).toBe(sysId);
      expect(displayInput.value).toBe("G Series");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain("Model (model) = G Series");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form rejects reference display values without committed sys_id", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/sys_user.do",
    );
    document.title = "New Record | User | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.sys_user.department">Department</label>
            <input
                id="sys_display.sys_user.department"
                name="sys_display.sys_user.department"
                role="combobox"
            />
            <input id="sys_user.department" name="sys_user.department" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.sys_user.department",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "sys_user.department",
    ) as HTMLInputElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["department"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "cmn_department" }),
      getLabelOf: () => "Department",
      getValue: () => "",
      setValue: () => {},
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/sys_user.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-display-only-rejected",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Department", value: "IT" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(displayInput.value).toBe("IT");
      expect(result).toContain("ServiceNow form configuration incomplete.");
      expect(result).toContain("Mismatches:");
      expect(result).toContain(
        "Department (department) = IT; expected IT; reference value not resolved",
      );
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form resolves ServiceNow references with single-field lookup", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/sys_user.do",
    );
    document.title = "New Record | User | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.sys_user.department">Department</label>
            <input
                id="sys_display.sys_user.department"
                name="sys_display.sys_user.department"
                role="combobox"
            />
            <input id="sys_user.department" name="sys_user.department" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.sys_user.department",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "sys_user.department",
    ) as HTMLInputElement;
    const departmentSysId = "0123456789abcdef0123456789abcdef";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["department"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "cmn_department" }),
      getLabelOf: () => "Department",
      getValue: () => hiddenInput.value,
      setValue: (_field: string, value: string, display: string) => {
        hiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      const result = text.includes("sysparm_query=name%3DIT")
        ? [{ sys_id: departmentSysId, name: "IT" }]
        : [];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/sys_user.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-single-field-lookup",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Department", value: "IT" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(hiddenInput.value).toBe(departmentSysId);
      expect(displayInput.value).toBe("IT");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain("Department (department) = IT");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form treats suggestion lookups as text fields", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create INC0035910 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.short_description">Short description</label>
            <input id="incident.short_description" name="incident.short_description" />
            <a
                id="lookup.incident.short_description"
                name="lookup.incident.short_description"
                role="button"
                title="Suggestion"
            >Suggestion</a>
        `;
    const input = document.getElementById(
      "incident.short_description",
    ) as HTMLInputElement;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["short_description"],
      getControl: () => input,
      getLabelOf: () => "Short description",
      getValue: () => input.value,
      setValue: (_field: string, value: string) => {
        input.value = value;
      },
    };
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...(details.args || [])), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-suggestion-text-field",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Short description",
                  value: "EMAIL Server Down Again",
                },
              ],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(input.value).toBe("EMAIL Server Down Again");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain(
        "Short description (short_description) = EMAIL Server Down Again",
      );
      expect(result).not.toContain("reference value not resolved");
      expect(result).not.toContain("Mismatches:");
    } finally {
      (window as any).g_form = originalGForm;
    }
  });

  test("configure_servicenow_form resolves common department reference fields", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/sys_user.do",
    );
    document.title = "New Record | User | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.sys_user.department">Department</label>
            <input
                id="sys_display.sys_user.department"
                name="sys_display.sys_user.department"
                role="combobox"
            />
            <input id="sys_user.department" name="sys_user.department" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.sys_user.department",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "sys_user.department",
    ) as HTMLInputElement;
    const departmentSysId = "fedcba9876543210fedcba9876543210";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["department"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getLabelOf: () => "Department",
      getValue: () => hiddenInput.value,
      setValue: (_field: string, value: string, display: string) => {
        hiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      const result = text.includes("sysparm_query=name%3DIT")
        ? [{ sys_id: departmentSysId, name: "IT" }]
        : [];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/sys_user.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-common-department-reference",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Department", value: "IT" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(hiddenInput.value).toBe(departmentSysId);
      expect(displayInput.value).toBe("IT");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain("Department (department) = IT");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form trusts hidden reference sys_id over display getValue", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/sys_user.do",
    );
    document.title = "New Record | User | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.sys_user.department">Department</label>
            <input
                id="sys_display.sys_user.department"
                name="sys_display.sys_user.department"
                role="combobox"
            />
            <input id="sys_user.department" name="sys_user.department" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.sys_user.department",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "sys_user.department",
    ) as HTMLInputElement;
    const departmentSysId = "abcdefabcdefabcdefabcdefabcdefab";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["department"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "cmn_department" }),
      getLabelOf: () => "Department",
      getValue: () => "IT",
      setValue: (_field: string, value: string, display: string) => {
        hiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      const result = text.includes("sysparm_query=name%3DIT")
        ? [{ sys_id: departmentSysId, name: "IT" }]
        : [];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/sys_user.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-hidden-sys-id",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Department", value: "IT" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(hiddenInput.value).toBe(departmentSysId);
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form commits reference sys_id to real hidden input before sys_original", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="sys_display.incident.caller_id">Caller</label>
            <input
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="sys_original.incident.caller_id" name="sys_original.incident.caller_id" type="hidden" />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
        `;
    const displayInput = document.getElementById(
      "sys_display.incident.caller_id",
    ) as HTMLInputElement;
    const originalHiddenInput = document.getElementById(
      "sys_original.incident.caller_id",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const sysId = "0123456789abcdef0123456789abcdef";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["caller_id"],
      getControl: () => hiddenInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "sys_user" }),
      getLabelOf: () => "Caller",
      getValue: () => originalHiddenInput.value || "Joe Employee",
      setValue: (_field: string, value: string, display: string) => {
        originalHiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: sysId, name: "Joe Employee" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-reference-real-hidden",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Caller", value: "Joe Employee" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(hiddenInput.value).toBe(sysId);
      expect(originalHiddenInput.value).toBe(sysId);
      expect(displayInput.value).toBe("Joe Employee");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form reveals ServiceNow form sections before filling hidden fields", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/alm_hardware.do",
    );
    document.title = "Create Hardware Asset | ServiceNow";
    document.body.innerHTML = `
            <span id="tab-general" role="tab">*General</span>
            <span id="tab-financial" role="tab">*Financial</span>
            <section id="section-financial" style="display: none">
                <label for="sys_display.alm_hardware.vendor">Vendor</label>
                <input
                    id="sys_display.alm_hardware.vendor"
                    name="sys_display.alm_hardware.vendor"
                    role="combobox"
                />
                <input id="alm_hardware.vendor" name="alm_hardware.vendor" type="hidden" />
            </section>
        `;
    const financialTab = document.getElementById("tab-financial")!;
    const financialSection = document.getElementById("section-financial")!;
    financialTab.addEventListener("click", () => {
      financialTab.setAttribute("data-clicked", "true");
      financialSection.setAttribute("style", "display: block");
    });
    const displayInput = document.getElementById(
      "sys_display.alm_hardware.vendor",
    ) as HTMLInputElement;
    const hiddenInput = document.getElementById(
      "alm_hardware.vendor",
    ) as HTMLInputElement;
    const values: Record<string, string> = {};
    const sysId = "0123456789abcdef0123456789abcdef";
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_tabs2Sections = {
      tabIDs: ["alm_hardware.general", "alm_hardware.financial"],
      tabsTabs: [
        { element: document.getElementById("tab-general") },
        { element: financialTab },
      ],
    };
    (window as any).g_form = {
      getFieldNames: () => ["vendor"],
      getControl: () => hiddenInput,
      getElement: () => displayInput,
      getDisplayBox: () => displayInput,
      getGlideUIElement: () => ({ reference: "core_company" }),
      getLabelOf: () => "Vendor",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string, display: string) => {
        values[field] = value;
        hiddenInput.value = value;
        displayInput.value = display;
      },
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: sysId, name: "Asus" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/alm_hardware.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-hidden-section-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [{ field: "Vendor", value: "Asus" }],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(financialTab.getAttribute("data-clicked")).toBe("true");
      expect(values.vendor).toBe(sysId);
      expect(hiddenInput.value).toBe(sysId);
      expect(displayInput.value).toBe("Asus");
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).toContain("Vendor (vendor) = Asus");
      expect(result).not.toContain("Mismatches:");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      delete (window as any).g_tabs2Sections;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_servicenow_form does not treat textarea metadata as a reference field", async () => {
    (window as any).happyDOM.setURL(
      "https://workarenapublic16.service-now.com/incident.do",
    );
    document.title = "Create INC0034429 | Incident | ServiceNow";
    document.body.innerHTML = `
            <label for="incident.description">Description</label>
            <textarea id="incident.description" name="incident.description"></textarea>
        `;
    const textarea = document.getElementById(
      "incident.description",
    ) as HTMLTextAreaElement;
    const values: Record<string, string> = {};
    const originalGForm = (window as any).g_form;
    (window as any).g_form = {
      getFieldNames: () => ["description"],
      getControl: () => textarea,
      getGlideUIElement: () => ({ reference: "incident" }),
      getLabelOf: () => "Description",
      getValue: (field: string) => values[field] || "",
      setValue: (field: string, value: string) => {
        values[field] = value;
        textarea.value = value;
      },
    };
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic16.service-now.com/incident.do",
      title: document.title,
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "configure-servicenow-textarea-form",
          type: "function",
          function: {
            name: ToolName.CONFIGURE_SERVICENOW_FORM,
            arguments: JSON.stringify({
              fields: [
                {
                  field: "Description",
                  value:
                    "Multiple employees have reported that they are unable to send/receive email.",
                },
              ],
              submit: false,
            }),
          },
        },
        123,
      );

      expect(values.description).toBe(
        "Multiple employees have reported that they are unable to send/receive email.",
      );
      expect(textarea.value).toBe(
        "Multiple employees have reported that they are unable to send/receive email.",
      );
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).not.toContain("Mismatches:");
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("configure_catalog_item prefers checkout over duplicate add-to-cart when cart is ready", async () => {
    document.title = "Standard Laptop | ServiceNow";
    document.body.innerHTML = `
            <label for="quantity">Quantity</label>
            <select id="quantity">
                <option value="1">1</option>
                <option value="10" selected>10</option>
            </select>
            <button id="add">Add to Cart</button>
            <button id="checkout">Proceed to Checkout</button>
        `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Shopping Cart\nProceed to Checkout\nStandard Laptop\nQuantity 10",
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const addButton = document.getElementById("add")!;
    const checkoutButton = document.getElementById("checkout")!;
    addButton.addEventListener("click", () => {
      addButton.setAttribute("data-clicked", "true");
    });
    checkoutButton.addEventListener("click", () => {
      checkoutButton.setAttribute("data-clicked", "true");
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/checkout",
      title: "Checkout | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            quantity: "10",
            submit: true,
          }),
        },
      },
      123,
    );

    expect(addButton.getAttribute("data-clicked")).toBe(null);
    expect(checkoutButton.getAttribute("data-clicked")).toBe("true");
    expect(result).toContain("Cart/order controls are already visible");
    expect(result).toContain("Clicked submit control");
    rectSpy.mockRestore();
  });

  test("configure_catalog_item continues from add-to-cart to checkout when requested", async () => {
    let bodyText = "Service Catalog\nStandard Laptop\nQuantity\nAdd to Cart";
    let addClicked = false;
    let checkoutClicked = false;
    document.title = "Standard Laptop | Service Catalog";
    document.body.innerHTML = `
            <label for="quantity">Quantity</label>
            <select id="quantity">
                <option value="1">1</option>
                <option value="10">10</option>
            </select>
            <button id="add">Add to Cart</button>
        `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => bodyText,
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.getElementById("add")!.addEventListener("click", () => {
      addClicked = true;
      bodyText =
        "Shopping Cart\nStandard Laptop\nQuantity 10\nProceed to Checkout";
      document.body.innerHTML = `<button id="checkout">Proceed to Checkout</button>`;
      document.getElementById("checkout")!.addEventListener("click", () => {
        checkoutClicked = true;
        bodyText = "Checkout\nStandard Laptop";
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/checkout",
      title: "Checkout | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      {
        result: await details.func(...(details.args || [])),
        frameId: 0,
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            quantity: "10",
            submit: true,
            submitButton: "Add to Cart",
            continueToCheckout: true,
          }),
        },
      },
      123,
    );

    expect(addClicked).toBe(true);
    expect(checkoutClicked).toBe(true);
    expect(result).toContain("Clicked submit control: Add to Cart");
    expect(result).toContain("Clicked cart checkout control");
    rectSpy.mockRestore();
  });

  test("configure_catalog_item defers quantity to cart when item page has no quantity control", async () => {
    let bodyText = "Service Catalog\niPad pro\nQuantity\nAdd to Cart";
    let addClicked = false;
    let checkoutClicked = false;
    document.title = "iPad pro | Service Catalog";
    document.body.innerHTML = `
            <button id="add">Add to Cart</button>
        `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => bodyText,
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.getElementById("add")!.addEventListener("click", () => {
      addClicked = true;
      bodyText = "Shopping Cart\niPad pro\nQuantity\nProceed to Checkout";
      document.body.innerHTML = `
              <label for="cart_quantity">Quantity</label>
              <input id="cart_quantity" name="cart_quantity" value="1" />
              <button id="checkout">Proceed to Checkout</button>
          `;
      document.getElementById("checkout")!.addEventListener("click", () => {
        checkoutClicked = true;
        bodyText = "Checkout\niPad pro\nQuantity 3";
      });
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/checkout",
      title: "Checkout | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      {
        result: await details.func(...(details.args || [])),
        frameId: 0,
      },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            quantity: "3",
            submit: true,
            submitButton: "Add to Cart",
            continueToCheckout: true,
          }),
        },
      },
      123,
    );

    expect(addClicked).toBe(true);
    expect(
      (document.getElementById("cart_quantity") as HTMLInputElement).value,
    ).toBe("3");
    expect(checkoutClicked).toBe(true);
    expect(result).toContain(
      "Quantity=3 (defer to cart/checkout; no item-page quantity control)",
    );
    expect(result).toContain("Configured cart quantity: 3");
    expect(result).toContain("Clicked cart checkout control");
    rectSpy.mockRestore();
  });

  test("configure_catalog_item prefers direct order over add-to-cart checkout when both are visible", async () => {
    let orderClicked = false;
    let addClicked = false;
    document.title = "Standard Laptop | Service Catalog";
    document.body.innerHTML = `
            <label for="quantity">Quantity</label>
            <select id="quantity">
                <option value="1">1</option>
                <option value="10">10</option>
            </select>
            <button id="order">Order Now</button>
            <button id="add">Add to Cart</button>
        `;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.getElementById("order")!.addEventListener("click", () => {
      orderClicked = true;
    });
    document.getElementById("add")!.addEventListener("click", () => {
      addClicked = true;
    });
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 123,
      url: "https://workarenapublic18.service-now.com/order_status",
      title: "Order Status | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    const result = await toolRegistry.execute(
      {
        id: "configure-catalog",
        type: "function",
        function: {
          name: ToolName.CONFIGURE_CATALOG_ITEM,
          arguments: JSON.stringify({
            quantity: "10",
            submit: true,
            submitButton: "Add to Cart",
            continueToCheckout: true,
          }),
        },
      },
      123,
    );

    expect(orderClicked).toBe(true);
    expect(addClicked).toBe(false);
    expect(result).toContain("Clicked submit control: Order Now");
    rectSpy.mockRestore();
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

  test("create_tab blocks off-origin URL when allowed origins are set", async () => {
    (chrome.storage.sync as any).get = vi.fn(async () => ({
      userSettings: {
        allowedNavigationOrigins: ["https://workarenapublic18.service-now.com"],
      },
    }));
    (chrome.tabs as any).create = vi.fn(async () => ({ id: 999 }));

    const result = await toolRegistry.execute(
      {
        id: "create-tab",
        type: "function",
        function: {
          name: ToolName.CREATE_TAB,
          arguments: JSON.stringify({
            url: "https://www.google.com/search?q=x",
          }),
        },
      },
      123,
    );

    expect(result).toContain("External navigation blocked");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
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

  test("escalate tool description mentions planner model and puzzles/riddles", () => {
    const defs = toolRegistry.getDefinitions();
    const escalate = defs.find((d) => d.function.name === ToolName.ESCALATE);
    expect(escalate).toBeDefined();
    expect(escalate!.function.description).toContain("planner model");
    expect(escalate!.function.description).toContain("riddles");
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

  test("upload_file requires id and accepts url or profileFile", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.UPLOAD_FILE);
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain("id");
    expect(def!.function.parameters.required).not.toContain("url");
    expect(def!.function.parameters.properties.url).toBeDefined();
    expect(def!.function.parameters.properties.profileFile).toBeDefined();
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
    expect(def!.function.description).toContain("local personal profile");
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

  test("type_text does not main-world mirror autocomplete reference inputs", async () => {
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

  test("type_text commits ServiceNow reference inputs through g_form", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
        `;
    const input = document.querySelector(
      "[data-os-tag='7']",
    ) as HTMLInputElement;
    const hidden = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    const setValue = vi.fn((_field: string, sysId: string, display: string) => {
      hidden.value = sysId;
      input.value = display;
    });
    (window as any).g_form = {
      getGlideUIElement: () => ({ reference: "sys_user" }),
      setValue,
    };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: "abc123", name: "Joe Employee" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    const originalGetAllFrames = (chrome.webNavigation as any).getAllFrames;
    (chrome.webNavigation as any).getAllFrames = vi.fn(
      (_details: any, cb: any) => cb([{ frameId: 0 }, { frameId: 9 }]),
    );
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => {
      if (details.target.frameIds?.[0] === 9) {
        return [{ result: await details.func(...details.args), frameId: 9 }];
      }
      return [{ result: undefined, frameId: 0 }];
    });

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow reference value committed)");
      expect(setValue).toHaveBeenCalledWith(
        "caller_id",
        "abc123",
        "Joe Employee",
      );
      expect(hidden.value).toBe("abc123");
      expect(input.value).toBe("Joe Employee");
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 123, frameIds: [9] },
          world: "MAIN",
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
      (chrome.webNavigation as any).getAllFrames = originalGetAllFrames;
    }
  });

  test("type_text commits regular ServiceNow fields through g_form", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="change_request.number"
                name="change_request.number"
                value="CHG0041055"
            />
        `;
    (window as any).happyDOM.setURL(
      "https://workarenapublic18.service-now.com/change_request.do",
    );
    const input = document.querySelector(
      "[data-os-tag='7']",
    ) as HTMLInputElement;
    const originalGForm = (window as any).g_form;
    const setValue = vi.fn((_field: string, nextValue: string) => {
      input.value = nextValue;
    });
    (window as any).g_form = {
      setValue,
      getValue: () => input.value,
    };
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-field",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "CHG0000021" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow field value committed)");
      expect(setValue).toHaveBeenCalledWith("number", "CHG0000021");
      expect(input.value).toBe("CHG0000021");
      expect(input.getAttribute("value")).toBe("CHG0000021");
    } finally {
      (window as any).g_form = originalGForm;
      (window as any).happyDOM.setURL("https://example.com/");
    }
  });

  test("type_text commits ServiceNow reference inputs through hidden sys_id field without g_form", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
        `;
    const input = document.querySelector(
      "[data-os-tag='7']",
    ) as HTMLInputElement;
    const hidden = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    (window as any).g_form = undefined;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [{ sys_id: "abc123", name: "Joe Employee" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as any;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference-hidden",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow reference value committed)");
      expect(hidden.value).toBe("abc123");
      expect(input.value).toBe("Joe Employee");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
    }
  });

  test("type_text falls back to page ServiceNow lookup when background lookup is unauthorized", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
        `;
    const hidden = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    const setValue = vi.fn((_field: string, sysId: string) => {
      hidden.value = sysId;
    });
    (window as any).g_form = {
      getGlideUIElement: () => ({ reference: "sys_user" }),
      setValue,
    };
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response("", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          result: [{ sys_id: "abc123", name: "Joe Employee" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as any;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference-page-fallback",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow reference value committed)");
      expect(fetchCount).toBe(2);
      expect(setValue).toHaveBeenCalledWith(
        "caller_id",
        "abc123",
        "Joe Employee",
      );
      expect(hidden.value).toBe("abc123");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
    }
  });

  test("type_text selects ServiceNow reference autocomplete when REST lookup is unauthorized", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
            <table class="ac_results">
                <tbody>
                    <tr role="option" data-sys-id="0123456789abcdef0123456789abcdef">
                        <td>Joe Employee</td>
                        <td>employee@example.com</td>
                    </tr>
                </tbody>
            </table>
        `;
    const input = document.querySelector(
      "[data-os-tag='7']",
    ) as HTMLInputElement;
    const hidden = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const option = document.querySelector("[role='option']") as HTMLElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    const setValue = vi.fn((_field: string, sysId: string, display: string) => {
      hidden.value = sysId;
      input.value = display;
    });
    (window as any).g_form = {
      getGlideUIElement: () => ({ reference: "sys_user" }),
      getValue: () => hidden.value,
      setValue,
    };
    option.addEventListener("click", () => {
      hidden.value = "0123456789abcdef0123456789abcdef";
      input.value = "Joe Employee";
    });
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 401 }),
    ) as any;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference-autocomplete",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow reference value committed)");
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(setValue).toHaveBeenCalledWith(
        "caller_id",
        "0123456789abcdef0123456789abcdef",
        "Joe Employee",
      );
      expect(hidden.value).toBe("0123456789abcdef0123456789abcdef");
      expect(input.value).toBe("Joe Employee");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
    }
  });

  test("type_text searches ServiceNow reference autocomplete by prefix when full display value has no option", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
            <input id="incident.caller_id" name="incident.caller_id" type="hidden" />
            <table class="ac_results">
                <tbody>
                    <tr role="option" data-sys-id="fedcba9876543210fedcba9876543210" style="display: none">
                        <td>Joe Employee</td>
                        <td>employee@example.com</td>
                    </tr>
                </tbody>
            </table>
        `;
    const input = document.querySelector(
      "[data-os-tag='7']",
    ) as HTMLInputElement;
    const hidden = document.getElementById(
      "incident.caller_id",
    ) as HTMLInputElement;
    const option = document.querySelector("[role='option']") as HTMLElement;
    const originalFetch = globalThis.fetch;
    const originalGForm = (window as any).g_form;
    const searchedValues: string[] = [];
    (window as any).g_form = {
      getGlideUIElement: () => ({ reference: "sys_user" }),
      getValue: () => hidden.value,
      setValue: (_field: string, sysId: string, display: string) => {
        hidden.value = sysId;
        input.value = display;
      },
    };
    input.addEventListener("input", () => {
      searchedValues.push(input.value);
      option.style.display = input.value === "Joe" ? "" : "none";
    });
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 401 }),
    ) as any;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference-prefix-autocomplete",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Joe Employee" }),
          },
        } as any,
        123,
      );

      expect(result).toBe("ok (ServiceNow reference value committed)");
      expect(searchedValues).toContain("Joe Employee");
      expect(searchedValues).toContain("Joe");
      expect(hidden.value).toBe("fedcba9876543210fedcba9876543210");
      expect(input.value).toBe("Joe Employee");
    } finally {
      globalThis.fetch = originalFetch;
      (window as any).g_form = originalGForm;
    }
  });

  test("type_text reports ServiceNow reference commit failures", async () => {
    document.body.innerHTML = `
            <input
                data-os-tag="7"
                id="sys_display.incident.caller_id"
                name="sys_display.incident.caller_id"
                role="combobox"
            />
        `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: await details.func(...details.args), frameId: 0 },
    ]);

    try {
      const result = await toolRegistry.execute(
        {
          id: "tool-type-servicenow-reference-failure",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "Missing User" }),
          },
        } as any,
        123,
      );

      expect(result).toBe(
        "ok (ServiceNow reference commit failed: no_matching_record)",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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
});
