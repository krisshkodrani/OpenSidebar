import { Global, describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// Vite build-time constants (injected via `define` in vite.config.ts)
(globalThis as any).__DEV__ = true;
(globalThis as any).__CEREBRAS_API_KEY__ = "";
(globalThis as any).__OPENROUTER_API_KEY__ = "";

// Mock Chrome API
global.chrome = {
    runtime: {
        onMessage: {
            addListener: () => { },
            removeListener: () => { },
        },
        sendMessage: async () => { },
    },
    storage: {
        session: {
            get: async () => ({}),
            set: async () => { },
        },
        local: {
            get: async () => ({}),
            set: async () => { },
        },
        sync: {
            get: async () => ({}),
            set: async () => { },
        }
    },
    sidePanel: {
        setPanelBehavior: () => { }
    },
    tabs: {
        update: async () => ({}),
        create: async () => ({ id: 999 }),
        remove: async () => { },
        get: async () => ({ id: 123, groupId: -1 }),
        query: async () => [],
        captureVisibleTab: async () => "data:image/jpeg;base64,mock",
        sendMessage: async () => ({ payload: { result: "ok", success: true } }),
        TAB_ID_NONE: -1,
        onRemoved: { addListener: () => { }, removeListener: () => { } },
        onUpdated: { addListener: () => { }, removeListener: () => { } },
    },
    tabGroups: {
        query: async () => [],
        update: async () => ({}),
        onRemoved: { addListener: () => { }, removeListener: () => { } },
        TAB_GROUP_ID_NONE: -1,
    },
    webNavigation: {
        onCompleted: { addListener: () => { }, removeListener: () => { } },
        onErrorOccurred: { addListener: () => { }, removeListener: () => { } },
    },
} as any;

// Mock window.scrollBy
if (!global.window.scrollBy) {
    global.window.scrollBy = () => { };
}
if (!global.window.scrollTo) {
    global.window.scrollTo = () => { };
}

// Mock HTMLElement methods
if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => { };
}

// Mock getBoundingClientRect to ensure visibility checks pass in tests
// In Happy-DOM, elements have 0 size by default.
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
    return {
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        x: 0,
        y: 0,
        toJSON: () => { }
    };
};

// Mock simpler things that might be missing
if (!global.cancelAnimationFrame) {
    global.cancelAnimationFrame = () => { };
}
if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb: any) => setTimeout(cb, 0) as unknown as number;
}
