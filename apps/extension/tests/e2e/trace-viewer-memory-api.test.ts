import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { openTraceViewerPage } from "./helpers/browser";
import {
  createMemory,
  deleteMemoryBySlug,
  fetchMemoryBySlug,
  listMemories,
  searchMemories,
  waitForBackendHealthy,
} from "./helpers/backend";

const h = createE2EHarness({ maxTurns: 4, testLabel: "trace-viewer-memory-api" });
const RUN_BACKEND_MEMORY = process.env.E2E_BACKEND_SITE_MEMORY === "true";

describe.skipIf(!h.apiKey || !RUN_BACKEND_MEMORY)(
  "E2E: Trace Viewer Memory API",
  () => {
    let seededSlugs: string[] = [];
    let firstTitle = "";
    let secondTitle = "";

    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for the trace-viewer memory smoke",
      ).toBe(true);

      const unique = crypto.randomUUID().slice(0, 8);
      firstTitle = `Expense style ${unique}`;
      secondTitle = `Receipt workflow ${unique}`;
      const first = await createMemory({
        category: "user-preference",
        title: firstTitle,
        content:
          "When summarizing travel expenses, prefer itemized bullets and keep currency in EUR.",
        metadata: {
          domain: "travel.example.com",
          source: "manual-seed",
        },
      });
      const second = await createMemory({
        category: "execution-result",
        title: secondTitle,
        content:
          "The receipts page exports CSV from the Actions menu after you select the date range.",
        metadata: {
          domain: "travel.example.com",
          source: "manual-seed",
        },
      });

      seededSlugs = [first.slug, second.slug];

      const listed = await listMemories({ limit: 20 });
      expect(listed.some((item) => item.slug === first.slug)).toBe(true);
      expect(listed.some((item) => item.slug === second.slug)).toBe(true);
    });

    afterEach(async () => {
      for (const slug of seededSlugs) {
        await deleteMemoryBySlug(slug);
      }
      seededSlugs = [];
      await h.afterEachHook("trace-viewer-memory-api");
    });

    it("lists, searches, expands, and deletes backend memories from the trace viewer", async () => {
      const [, secondSlug] = seededSlugs;
      const viewer = await openTraceViewerPage(h.ctx);

      await viewer.waitForFunction(
        (firstTitle, secondTitle) =>
          document.body.innerText.includes(firstTitle) &&
          document.body.innerText.includes(secondTitle),
        {},
        firstTitle,
        secondTitle,
      );

      await viewer.type('input[placeholder="Search memories (semantic)..."]', "receipts CSV Actions menu");
      await viewer.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === "Search",
        ) as HTMLButtonElement | undefined;
        button?.click();
      });

      await viewer.waitForFunction(
        (title) =>
          document.body.innerText.includes(title) &&
          !document.body.innerText.includes("Expense style "),
        {},
        secondTitle,
      );

      const searched = await searchMemories("receipts CSV Actions menu", 10);
      expect(searched.some((item) => item.slug === secondSlug)).toBe(true);

      await viewer.evaluate((targetTitle) => {
        const titleNode = Array.from(document.querySelectorAll("span")).find(
          (candidate) => candidate.textContent?.trim() === targetTitle,
        ) as HTMLSpanElement | undefined;
        const row =
          (titleNode?.closest("div.cursor-pointer") as HTMLDivElement | null) ??
          titleNode?.parentElement;
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }, secondTitle);

      await viewer.waitForFunction(
        () =>
          document.body.innerText.includes(
            "The receipts page exports CSV from the Actions menu after you select the date range.",
          ),
      );

      const detail = await fetchMemoryBySlug(secondSlug);
      expect(detail?.content).toContain("Actions menu");

      await viewer.evaluate((targetTitle) => {
        const titleNode = Array.from(document.querySelectorAll("span")).find(
          (candidate) => candidate.textContent?.trim() === targetTitle,
        ) as HTMLSpanElement | undefined;
        const row =
          (titleNode?.closest("div.cursor-pointer") as HTMLDivElement | null) ??
          titleNode?.parentElement;
        const deleteButton = row
          ? Array.from(row.querySelectorAll("button")).find(
              (candidate) => candidate.textContent?.trim() === "x",
            )
          : null;
        (deleteButton as HTMLButtonElement | null)?.click();
      }, secondTitle);

      await viewer.waitForFunction(
        (targetTitle) => !document.body.innerText.includes(targetTitle),
        {},
        secondTitle,
      );

      const deleted = await fetchMemoryBySlug(secondSlug);
      expect(deleted).toBeNull();

      seededSlugs = seededSlugs.filter((slug) => slug !== secondSlug);
    }, 180_000);
  },
);
