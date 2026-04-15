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
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  extractDoneSummary,
  findAllNewTraceFiles,
  traceFilesContainText,
} from "./helpers/diagnostics";
import {
  createSiteKnowledgeMemory,
  deleteMemoryBySlug,
  waitForDomainMemory,
  waitForBackendHealthy,
} from "./helpers/backend";

const h = createE2EHarness({ maxTurns: 8, testLabel: "site-knowledge" });
const TURN_TIMEOUT = 150_000;
const SITE_KNOWLEDGE_TIP =
  "The dashboard's report list is behind the Reports tab. Open Reports before answering questions about available reports.";
const RUN_BACKEND_SITE_MEMORY = process.env.E2E_BACKEND_SITE_MEMORY === "true";

function getFixtureUrlForDomain(route: string, domain: string): string {
  const url = new URL(getFixtureUrl(route));
  url.hostname = domain;
  return url.toString();
}

describe.skipIf(!h.apiKey || !RUN_BACKEND_SITE_MEMORY)(
  "E2E: Site Knowledge Memory",
  () => {
    let seededSlug: string | null = null;
    let siteDomain = "";

    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for the site knowledge smoke",
      ).toBe(true);

      siteDomain = `site-knowledge-${crypto.randomUUID().slice(0, 8)}.localhost`;
      const title = `E2E ${siteDomain} dashboard reports ${crypto.randomUUID().slice(0, 8)}`;
      seededSlug = await createSiteKnowledgeMemory({
        title,
        content: SITE_KNOWLEDGE_TIP,
        domain: siteDomain,
        tipType: "strategy",
        confidence: 0.98,
      });

      const stored = await waitForDomainMemory(
        siteDomain,
        (memory) => memory.slug === seededSlug,
      );
      expect(
        stored,
        "Seeded site knowledge should be queryable before the test turn starts",
      ).not.toBeNull();
    });

    afterEach(async () => {
      if (seededSlug) {
        await deleteMemoryBySlug(seededSlug);
        seededSlug = null;
      }
      await h.afterEachHook("site-knowledge-memory");
    });

    it("injects persisted site knowledge into the executor prompt and uses it", async () => {
      await navigateAndWait(h.page, getFixtureUrlForDomain("dashboard", siteDomain));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const workspaceId = `e2e-site-knowledge-${crypto.randomUUID()}`;

      await sendUserChat(
        h.ctx,
        "What reports are available on this dashboard? Give me the report names.",
        tabId,
        workspaceId,
      );

      const turn = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
      expect(turn.ok, `Task failed: ${turn.reason}`).toBe(true);

      const traceFiles = findAllNewTraceFiles(h.tracesBefore);
      const answer = extractDoneSummary(traceFiles);
      const lowerAnswer = answer.toLowerCase();

      expect(
        lowerAnswer.includes("performance") &&
          lowerAnswer.includes("engagement") &&
          lowerAnswer.includes("conversion") &&
          lowerAnswer.includes("traffic"),
        "The answer should list the reports discovered after using the site knowledge hint",
      ).toBe(true);
      expect(
        traceFilesContainText(
          traceFiles,
          "SITE KNOWLEDGE (learned from prior visits to this domain):",
        ),
        "The executor prompt should include the site knowledge section",
      ).toBe(true);
      expect(
        traceFilesContainText(traceFiles, SITE_KNOWLEDGE_TIP),
        "The seeded site knowledge tip should appear in the raw trace prompt",
      ).toBe(true);

      await h.printTraceSummary(workspaceId);
      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 300_000);
  },
);
