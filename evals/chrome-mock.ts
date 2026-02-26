/**
 * Minimal chrome API stub for context-runner.
 *
 * Imported before ContextManager to satisfy chrome.storage.session references
 * in the eval environment (no real Chrome extension runtime).
 */

const storage: Record<string, any> = {};

globalThis.chrome = {
  storage: {
    session: {
      get: async (keys: any) => {
        if (typeof keys === "string") return { [keys]: storage[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, any> = {};
          for (const k of keys) result[k] = storage[k];
          return result;
        }
        return {};
      },
      set: async (items: any) => {
        Object.assign(storage, items);
      },
    },
    local: {
      get: async (keys: any) => {
        if (typeof keys === "string") return { [keys]: storage[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, any> = {};
          for (const k of keys) result[k] = storage[k];
          return result;
        }
        return {};
      },
      set: async (items: any) => {
        Object.assign(storage, items);
      },
    },
  },
  runtime: { id: "eval-mock" },
} as any;
