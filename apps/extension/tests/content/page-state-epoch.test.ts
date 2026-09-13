import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MessageSource, type DismissModalsMessage } from "../../src/types";
import {
  getPageDocumentState,
  pageDocumentStateMatches,
  rejectStaleDismissRequest,
  rejectStaleToolRequest,
  resetPageMutationEpochForTesting,
  startPageMutationEpochObserver,
} from "../../src/content/page-state-epoch";

async function flushMutations(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("page document mutation epoch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/epoch-test");
    resetPageMutationEpochForTesting();
    startPageMutationEpochObserver();
  });

  afterEach(() => {
    resetPageMutationEpochForTesting();
  });

  test("keeps a stable document identity and advances for page mutations", async () => {
    const before = getPageDocumentState();
    const button = document.createElement("button");
    button.textContent = "Page action";
    document.body.append(button);
    await flushMutations();

    const after = getPageDocumentState();
    expect(after.documentInstanceId).toBe(before.documentInstanceId);
    expect(after.mutationEpoch).toBeGreaterThan(before.mutationEpoch);
  });

  test("does not advance for OpenSidebar-owned UI mutations", async () => {
    const before = getPageDocumentState();
    const presence = document.createElement("opensidebar-presence");
    document.documentElement.append(presence);
    presence.setAttribute("data-state", "acting");
    await flushMutations();

    expect(getPageDocumentState().mutationEpoch).toBe(before.mutationEpoch);
    presence.remove();
    await flushMutations();
    expect(getPageDocumentState().mutationEpoch).toBe(before.mutationEpoch);
  });

  test("does not treat stable tagging attributes as page mutations", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const before = getPageDocumentState().mutationEpoch;

    button.setAttribute("data-os-tag", "42");

    expect(getPageDocumentState().mutationEpoch).toBe(before);
  });

  test("flushes pending page mutations into synchronous snapshot state", () => {
    const before = getPageDocumentState().mutationEpoch;
    document.body.setAttribute("data-page-state", "changed");

    expect(getPageDocumentState().mutationEpoch).toBe(before + 1);
  });

  test("advances when SPA location changes without a DOM mutation", () => {
    const before = getPageDocumentState();
    window.history.pushState({}, "", "/epoch-test/next");
    const after = getPageDocumentState();

    expect(after.mutationEpoch).toBe(before.mutationEpoch + 1);
    expect(after.url).not.toBe(before.url);
  });

  test("generates a new identity when a replacement document loads", async () => {
    vi.resetModules();
    const firstModule = await import("../../src/content/page-state-epoch");
    const firstId = firstModule.getPageDocumentState().documentInstanceId;
    firstModule.resetPageMutationEpochForTesting();

    vi.resetModules();
    const secondModule = await import("../../src/content/page-state-epoch");
    const secondId = secondModule.getPageDocumentState().documentInstanceId;
    secondModule.resetPageMutationEpochForTesting();

    expect(secondId).not.toBe(firstId);
  });

  test("optionally includes viewport geometry in freshness checks", () => {
    const basis = getPageDocumentState();
    const moved = {
      ...basis,
      scroll: { ...basis.scroll, y: basis.scroll.y + 100 },
    };

    expect(pageDocumentStateMatches(basis, moved)).toBe(true);
    expect(
      pageDocumentStateMatches(basis, moved, { requireGeometryMatch: true }),
    ).toBe(false);
  });

  test("rejects a stale tool basis before an action handler can run", () => {
    const staleBasis = getPageDocumentState();
    document.body.setAttribute("data-page-state", "changed");
    const respond = vi.fn();

    expect(rejectStaleToolRequest(staleBasis, respond)).toBe(true);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        navigated: false,
        errorCode: "stale_observation",
      }),
    );
  });

  test("rejects stale modal dismissal with the live document state", () => {
    const staleBasis = getPageDocumentState();
    window.history.pushState({}, "", "/epoch-test/changed");
    const sendResponse = vi.fn();
    const message: DismissModalsMessage = {
      type: "DISMISS_MODALS",
      requestId: "dismiss-1",
      source: MessageSource.BACKGROUND,
      payload: {
        observationBasis: {
          ...staleBasis,
          observationRevision: 1,
        },
      },
    };

    expect(rejectStaleDismissRequest(message, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          dismissed: 0,
          errorCode: "stale_observation",
          documentState: expect.objectContaining({
            url: expect.stringContaining("/epoch-test/changed"),
          }),
        }),
      }),
    );
  });
});
