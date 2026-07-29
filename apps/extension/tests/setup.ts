// Vitest's `environment: "happy-dom"` in vitest.config.ts handles DOM registration automatically.

// Vite build-time constants (injected via `define` in vite.config.ts)
(globalThis as any).__DEV__ = true;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Avoid noisy ECONNREFUSED errors in tests when optional local log/trace server
// is not running. Only stub localhost drain endpoints; keep other fetch calls real.
const originalFetch = globalThis.fetch?.bind(globalThis);
if (originalFetch) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                    ? input.toString()
                    : (input as Request).url;
        if (url.startsWith("http://127.0.0.1:7589/")) {
            return new Response(null, { status: 204 });
        }
        return originalFetch(input as any, init);
    }) as typeof fetch;
}

// Mock Chrome API
global.chrome = {
    runtime: {
        onMessage: {
            addListener: () => { },
            removeListener: () => { },
        },
        sendMessage: async () => { },
        getURL: (path: string) => `chrome-extension://test/${path}`,
        getContexts: async () => [],
    },
    storage: {
        session: {
            get: async () => ({}),
            set: async () => { },
            remove: async () => { },
        },
        local: {
            get: async () => ({}),
            set: async () => { },
            remove: async () => { },
        },
        sync: {
            get: async () => ({}),
            set: async () => { },
        }
    },
    sidePanel: {
        setPanelBehavior: () => { },
        setOptions: async () => { },
        open: async () => { },
    },
    tabs: {
        update: async () => ({}),
        create: async () => ({ id: 999 }),
        remove: async () => { },
        get: async () => ({ id: 123, groupId: -1 }),
        query: async () => [],
        captureVisibleTab: async () => "data:image/jpeg;base64,mock",
        sendMessage: async () => ({ payload: { result: "ok", success: true } }),
        goBack: async () => { },
        goForward: async () => { },
        group: async () => 1,
        ungroup: async () => { },
        TAB_ID_NONE: -1,
        onRemoved: { addListener: () => { }, removeListener: () => { } },
        onUpdated: { addListener: () => { }, removeListener: () => { } },
        onCreated: { addListener: () => { }, removeListener: () => { } },
    },
    tabCapture: {
        getMediaStreamId: (_options: any, callback: (streamId?: string) => void) => callback("mock-stream-id"),
    },
    offscreen: {
        createDocument: async () => { },
        closeDocument: async () => { },
    },
    tabGroups: {
        query: async () => [],
        get: async (groupId: number) => ({
            id: groupId,
            windowId: 1,
            color: "blue",
        }),
        update: async () => ({}),
        onCreated: { addListener: () => { }, removeListener: () => { } },
        onRemoved: { addListener: () => { }, removeListener: () => { } },
        onUpdated: { addListener: () => { }, removeListener: () => { } },
        TAB_GROUP_ID_NONE: -1,
    },
    webNavigation: {
        onCreatedNavigationTarget: {
            addListener: () => { },
            removeListener: () => { },
        },
        onCompleted: { addListener: () => { }, removeListener: () => { } },
        onErrorOccurred: { addListener: () => { }, removeListener: () => { } },
    },
    downloads: {
        download: async () => 1,
    },
    scripting: {
        executeScript: async () => [{ result: "undefined" }],
    },
    search: {
        query: async () => { },
    },
    cookies: {
        getAll: async () => [],
        set: async () => ({ name: "test", value: "v", domain: "example.com", path: "/" }),
        remove: async () => ({ url: "https://example.com", name: "test" }),
    },
    history: {
        search: async () => [],
    },
    bookmarks: {
        create: async () => ({ id: "1", title: "Test", url: "https://example.com" }),
        search: async () => [],
    },
    notifications: {
        create: async (_id: string, _opts: any, cb?: (id: string) => void) => { if (cb) cb(_id); return _id; },
        clear: async () => true,
        getPermissionLevel: async () => "granted",
        onClicked: { addListener: () => { }, removeListener: () => { } },
        onClosed: { addListener: () => { }, removeListener: () => { } },
    },
    permissions: {
        contains: async () => true,
        request: async () => true,
    },
    windows: {
        create: async () => ({ id: 1 }),
        update: async () => ({}),
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
