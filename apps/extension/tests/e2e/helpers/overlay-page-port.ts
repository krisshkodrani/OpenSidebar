import type {
  FrameWaitForFunctionOptions,
  Page,
  WaitForSelectorOptions,
} from "puppeteer";

export interface OverlayRunnerPageScreenshotOptions {
  fullPage?: boolean;
}

export interface OverlayRunnerBrowserPagePort {
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  screenshot(options?: OverlayRunnerPageScreenshotOptions): Promise<Uint8Array>;
  evaluate<Params extends unknown[], Result>(
    pageFunction: (...args: Params) => Result | Promise<Result>,
    ...args: Params
  ): Promise<Awaited<Result>>;
  waitForSelector(
    selector: string,
    options?: WaitForSelectorOptions,
  ): Promise<void>;
  waitForFunction<Params extends unknown[]>(
    pageFunction: (...args: Params) => unknown | Promise<unknown>,
    options?: FrameWaitForFunctionOptions,
    ...args: Params
  ): Promise<void>;
}

export interface MockOverlayRunnerBrowserPagePortOptions {
  url?: string;
  title?: string;
  screenshot?: Uint8Array;
  selectors?: string[];
}

export interface MockOverlayRunnerBrowserPagePort
  extends OverlayRunnerBrowserPagePort {
  calls: {
    screenshots: OverlayRunnerPageScreenshotOptions[];
    waitForSelectors: Array<{
      selector: string;
      options?: WaitForSelectorOptions;
    }>;
    waitForFunctions: Array<{
      options?: FrameWaitForFunctionOptions;
    }>;
  };
}

export function createPuppeteerOverlayBrowserPagePort(
  page: Page,
): OverlayRunnerBrowserPagePort {
  return {
    async getUrl() {
      return page.url();
    },

    async getTitle() {
      return page.title();
    },

    async screenshot(options = {}) {
      return page.screenshot({
        fullPage: options.fullPage,
        type: "png",
      });
    },

    async evaluate(pageFunction, ...args) {
      return page.evaluate(pageFunction, ...args);
    },

    async waitForSelector(selector, options) {
      const handle = await page.waitForSelector(selector, options);
      if (!handle) {
        throw new Error(`Selector did not resolve to an element: ${selector}`);
      }
      await handle.dispose();
    },

    async waitForFunction(pageFunction, options, ...args) {
      const handle = await page.waitForFunction(pageFunction, options, ...args);
      await handle.dispose();
    },
  };
}

const MINIMAL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function createMockOverlayBrowserPagePort(
  options: MockOverlayRunnerBrowserPagePortOptions = {},
): MockOverlayRunnerBrowserPagePort {
  const selectors = new Set(options.selectors ?? []);
  const calls: MockOverlayRunnerBrowserPagePort["calls"] = {
    screenshots: [],
    waitForSelectors: [],
    waitForFunctions: [],
  };
  return {
    calls,

    async getUrl() {
      return options.url ?? "about:blank";
    },

    async getTitle() {
      return options.title ?? "";
    },

    async screenshot(screenshotOptions = {}) {
      calls.screenshots.push(screenshotOptions);
      return options.screenshot ?? MINIMAL_PNG;
    },

    async evaluate(pageFunction, ...args) {
      return await pageFunction(...args);
    },

    async waitForSelector(selector, waitOptions) {
      calls.waitForSelectors.push({ selector, options: waitOptions });
      if (!selectors.has(selector)) {
        throw new Error(`Selector did not resolve to an element: ${selector}`);
      }
    },

    async waitForFunction(pageFunction, waitOptions, ...args) {
      calls.waitForFunctions.push({ options: waitOptions });
      const result = await pageFunction(...args);
      if (!result) {
        throw new Error("Wait predicate did not resolve to a truthy value.");
      }
    },
  };
}
