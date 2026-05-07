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
  (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
    id: 123,
    url: "https://example.com/start",
    title: "Start",
    groupId: -1,
  }));
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("should not query metadata"),
    );
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

    expect(fetchMock).not.toHaveBeenCalled();
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

    const query = "priority=2^category=hardware^state=7^assignment_group=group123";
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

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
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
            join: "OR",
            conditions: [
              {
                field: "Caller",
                operator: "is",
                value: "System Administrator",
              },
              { field: "Priority", operator: "is", value: "4 - Low" },
            ],
          }),
        },
      },
      123,
    );

    const query = "caller_id=user123^ORpriority=4";

    expect(result).toContain(`sysparm_query=${query}`);
    expect(result).not.toContain("priority=4 - Low");
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

  test("configure_catalog_item fills catalog controls and clicks submit", async () => {
    document.title = "Standard Laptop | ServiceNow";
    document.body.innerHTML = `
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
      url: "https://workarenapublic18.service-now.com/order_status.do?sys_id=req123",
      title: "Order Status | ServiceNow",
      groupId: -1,
    }));
    (chrome.scripting.executeScript as any) = vi.fn(async (details: any) => [
      { result: details.func(...details.args), frameId: 0 },
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
      (document.getElementById("acrobat") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("photoshop") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (document.getElementById("software") as HTMLTextAreaElement).value,
    ).toBe("Trello, Salesforce");
    expect(orderButton.getAttribute("data-clicked")).toBe("true");
    expect(result).toContain("Configured catalog item.");
    expect(result).toContain("Clicked submit control");
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
      expect(result).toContain("Configured ServiceNow form.");
      expect(result).not.toContain("Mismatches:");
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
      (window as any).happyDOM.setURL("https://example.com/");
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
      { result: details.func(...details.args), frameId: 0 },
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
