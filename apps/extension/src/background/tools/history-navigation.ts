/** Traverse exactly one history entry and observe the commit, including same-URL state. */
export async function navigateBackOneEntry(tabId: number, timeoutMs = 2500): Promise<string | null> {
  let lastUrl: string | null = null;
  let finish!: (url: string | null) => void;
  const committed = new Promise<string | null>((resolve) => { finish = resolve; });
  const onCommit = (details: { tabId: number; frameId: number; url: string }) => {
    if (details.tabId !== tabId || details.frameId !== 0) return;
    lastUrl = details.url;
    // Allow a transient blank document to settle before reporting its destination.
    if (lastUrl && lastUrl !== "about:blank" && !lastUrl.startsWith("chrome://newtab")) finish(lastUrl);
  };
  const events = [
    chrome.webNavigation.onCommitted,
    chrome.webNavigation.onHistoryStateUpdated,
    chrome.webNavigation.onReferenceFragmentUpdated,
  ];
  for (const event of events) event.addListener(onCommit);
  const timer = setTimeout(() => finish(lastUrl), timeoutMs);
  try {
    // Browser-UI Back can skip entries created by scripted navigation. Never
    // issue a second traversal merely because the first kept the same URL.
    await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      func: () => { window.history.back(); },
    });
    return await committed;
  } finally {
    clearTimeout(timer);
    for (const event of events) event.removeListener(onCommit);
  }
}
