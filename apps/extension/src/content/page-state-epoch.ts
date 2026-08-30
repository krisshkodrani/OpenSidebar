import {
  MessageSource,
  type DismissModalsMessage,
  type DismissModalsResponse,
  type PageDocumentState,
} from "../types";

const OWN_ELEMENT_TAG = "opensidebar-presence";
const OWN_ID_PREFIX = "opensidebar-";
const OWN_CLASS_PREFIX = "opensidebar-";

const documentInstanceId = crypto.randomUUID();
let mutationEpoch = 0;
let lastUrl = window.location.href;
let observer: MutationObserver | null = null;

function elementIsOwned(element: Element | null): boolean {
  for (let current = element; current; current = current.parentElement) {
    if (current.localName === OWN_ELEMENT_TAG) return true;
    if (current.id.startsWith(OWN_ID_PREFIX)) return true;
    for (const className of current.classList) {
      if (className.startsWith(OWN_CLASS_PREFIX)) return true;
    }
  }
  return false;
}

function nodeIsOwned(node: Node | null): boolean {
  if (!node) return false;
  if (node.nodeType === Node.ELEMENT_NODE) {
    return elementIsOwned(node as Element);
  }
  return elementIsOwned(node.parentElement);
}

function mutationIsPageOwned(record: MutationRecord): boolean {
  if (nodeIsOwned(record.target)) return false;
  if (record.type === "attributes" && record.attributeName === "data-os-tag") {
    return false;
  }
  if (record.type !== "childList") return true;

  const changedNodes = [...record.addedNodes, ...record.removedNodes];
  return changedNodes.length === 0 || changedNodes.some((node) => !nodeIsOwned(node));
}

function advanceForMutations(records: MutationRecord[]): void {
  if (records.some(mutationIsPageOwned)) mutationEpoch += 1;
}

function syncLocationEpoch(): void {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;
  mutationEpoch += 1;
}

export function startPageMutationEpochObserver(): void {
  if (observer || !document.documentElement) return;
  observer = new MutationObserver((records) => {
    advanceForMutations(records);
    syncLocationEpoch();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
}

export function getPageDocumentState(): PageDocumentState {
  if (observer) advanceForMutations(observer.takeRecords());
  syncLocationEpoch();
  return {
    documentInstanceId,
    mutationEpoch,
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: { x: window.scrollX, y: window.scrollY },
  };
}

export function pageDocumentStateMatches(
  expected: PageDocumentState,
  actual: PageDocumentState,
  options: { requireGeometryMatch?: boolean } = {},
): boolean {
  if (
    expected.documentInstanceId !== actual.documentInstanceId ||
    expected.mutationEpoch !== actual.mutationEpoch ||
    expected.url !== actual.url
  ) {
    return false;
  }
  if (!options.requireGeometryMatch) return true;
  return (
    expected.viewport.width === actual.viewport.width &&
    expected.viewport.height === actual.viewport.height &&
    expected.scroll.x === actual.scroll.x &&
    expected.scroll.y === actual.scroll.y
  );
}

export function rejectStaleDismissRequest(
  message: DismissModalsMessage,
  sendResponse: (response: DismissModalsResponse) => void,
): boolean {
  const expected = message.payload.observationBasis;
  if (!expected) return false;
  const documentState = getPageDocumentState();
  if (pageDocumentStateMatches(expected, documentState)) return false;
  sendResponse({
    type: "DISMISS_MODALS_RESPONSE",
    requestId: message.requestId,
    source: MessageSource.CONTENT,
    payload: {
      dismissed: 0,
      clickedClose: 0,
      cssHidden: 0,
      remainingOverlay: null,
      capturedTexts: [],
      errorCode: "stale_observation",
      documentState,
    },
  });
  return true;
}

export function rejectStaleToolRequest(
  observationBasis: (PageDocumentState & { requireGeometryMatch?: boolean }) | undefined,
  respond: (response: {
    success: boolean;
    result: string;
    navigated: boolean;
    errorCode: "stale_observation";
    documentState: PageDocumentState;
  }) => void,
): boolean {
  if (!observationBasis) return false;
  const documentState = getPageDocumentState();
  if (
    pageDocumentStateMatches(observationBasis, documentState, {
      requireGeometryMatch: observationBasis.requireGeometryMatch,
    })
  ) {
    return false;
  }
  respond({
    success: false,
    result:
      "Error: Page state changed after this action was chosen. A fresh observation is required before retrying.",
    navigated: false,
    errorCode: "stale_observation",
    documentState,
  });
  return true;
}

/** Test-only reset for a single happy-dom document instance. */
export function resetPageMutationEpochForTesting(): void {
  observer?.disconnect();
  observer = null;
  mutationEpoch = 0;
  lastUrl = window.location.href;
}
