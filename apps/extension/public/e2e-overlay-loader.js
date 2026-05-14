(async () => {
  const CONFIG_ID = "opensidebar-overlay-config";
  const HOST_ID = "opensidebar-harness-host";

  function readConfig() {
    const raw = document.getElementById(CONFIG_ID)?.textContent;
    if (!raw) {
      throw new Error("OpenSidebar overlay config was not found.");
    }
    return JSON.parse(raw);
  }

  async function waitForHost() {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (document.getElementById(HOST_ID)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for OpenSidebar overlay host.");
  }

  const config = readConfig();
  if (!config.scriptUrl) {
    throw new Error("OpenSidebar overlay script URL was not configured.");
  }

  if (!window.__opensidebarOverlayModulePromise) {
    window.__opensidebarOverlayModulePromise = import(config.scriptUrl);
  }
  await window.__opensidebarOverlayModulePromise;

  if (!document.getElementById(HOST_ID)) {
    window.__opensidebarOverlay?.mount?.({
      glass: config.glass,
      runtimeOptions: config.runtimeOptions,
    });
  }

  return waitForHost();
})()
