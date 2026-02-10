/**
 * Chrome API Mocks for CLI Environment
 *
 * This must be imported before any modules that use Chrome APIs.
 */

if (typeof globalThis.chrome === "undefined") {
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: async () => ({}),
        set: async () => {},
      },
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    runtime: {
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => {},
      lastError: null,
    },
    tabs: {
      query: async () => [],
      get: async () => ({}),
      update: async () => ({}),
      create: async () => ({ id: 123 }),
      remove: async () => {},
      sendMessage: async () => ({ success: true }),
      captureVisibleTab: async () => "",
      TAB_ID_NONE: -1,
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onCreated: { addListener: () => {}, removeListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      group: async () => 1,
      ungroup: async () => {},
    },
    tabGroups: {
      query: async () => [],
      get: async () => ({ id: 1, title: "Group", color: "blue" }),
      update: async () => {},
      move: async () => {},
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onCreated: { addListener: () => {}, removeListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      onAlarm: { addListener: () => {} },
    },
    sidePanel: {
      setPanelBehavior: () => {},
    },
    webNavigation: {
      onCompleted: { addListener: () => {} },
    },
  };
}

// Export something so this can be imported
export {};
