import "../setup";
import { describe, test, expect, beforeEach } from "vitest";
import { perceive, parseCompletionSignal, type PerceptionInput } from "../../src/background/perception";
import { computeSnapshotFingerprint, computeElementSignatures } from "../../src/background/agent/stagnation";
import type { DomSnapshot, TaggedElement } from "../../src/types";

// ----- helpers -----

function makeElement(overrides: Partial<TaggedElement> = {}): TaggedElement {
    return {
        tag: 1,
        tagName: "button",
        text: "Click me",
        role: "",
        attributes: {},
        domPath: "html>body>button",
        ...overrides,
    };
}

function makeInput(overrides: Partial<PerceptionInput> = {}): PerceptionInput {
    return {
        screenshotDataUrl: "data:image/jpeg;base64,AAAA",
        elements: [makeElement()],
        url: "https://example.com",
        title: "Test Page",
        scroll: { y: 0, maxY: 1000 },
        ...overrides,
    };
}

function makeSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
    return {
        url: "https://example.com",
        title: "Test",
        elements: [makeElement()],
        scrollPosition: { y: 0, maxY: 1000 },
        viewportSize: { width: 1280, height: 720 },
        timestamp: Date.now(),
        ...overrides,
    };
}

/** Mock fetch that intercepts API calls and passes through log server requests. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        if (url.startsWith("http://127.0.0.1:7589/")) {
            return new Response(null, { status: 204 });
        }
        return handler(url, init);
    }) as typeof fetch;
}

/** Set API keys via storage mock; returns cleanup function. */
function setKeys(opts: { groq?: string; openRouter?: string }): () => void {
    const origGet = chrome.storage.sync.get;

    chrome.storage.sync.get = (async () => ({
        userSettings: {
            openRouterApiKey: opts.openRouter ?? "",
            groqApiKey: opts.groq ?? "",
        },
    })) as any;

    return () => {
        chrome.storage.sync.get = origGet;
    };
}

function jsonResponse(content: string, usage?: Record<string, number>): Response {
    return new Response(JSON.stringify({
        choices: [{ message: { content } }],
        ...(usage ? { usage } : {}),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ----- Tests -----

describe("perceive()", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    test("returns fallback when no API key", async () => {
        const cleanup = setKeys({});
        try {
            const result = await perceive(makeInput());
            expect(result.cached).toBe(false);
            expect(result.interpretation).toContain("No API key");
            expect(result.model).toBe("openai/gpt-4o-mini");
        } finally {
            cleanup();
        }
    });

    test("uses OpenRouter when only OpenRouter key available", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let calledUrl = "";
        globalThis.fetch = mockFetch((url) => {
            calledUrl = url;
            return jsonResponse("LAYOUT: Test page.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("LAYOUT:");
            expect(result.providerId).toBe("openrouter");
            expect(result.model).toBe("openai/gpt-4o-mini");
            expect(calledUrl).toContain("openrouter.ai");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("uses Groq first when both keys available", async () => {
        const cleanup = setKeys({ groq: "groq-key", openRouter: "or-key" });
        let calledUrl = "";
        globalThis.fetch = mockFetch((url) => {
            calledUrl = url;
            return jsonResponse("LAYOUT: Groq result.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("LAYOUT: Groq result.");
            expect(result.providerId).toBe("groq");
            expect(result.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
            expect(calledUrl).toContain("api.groq.com");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("falls back to OpenRouter on Groq 429", async () => {
        const cleanup = setKeys({ groq: "groq-key", openRouter: "or-key" });
        const calls: string[] = [];
        globalThis.fetch = mockFetch((url) => {
            calls.push(url);
            if (url.includes("groq.com")) {
                return new Response("Rate limited", { status: 429 });
            }
            return jsonResponse("LAYOUT: OpenRouter fallback.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("OpenRouter fallback");
            expect(result.providerId).toBe("openrouter");
            expect(calls.some(u => u.includes("groq.com"))).toBe(true);
            expect(calls.some(u => u.includes("openrouter.ai"))).toBe(true);
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("falls back to OpenRouter on Groq 4xx error", async () => {
        const cleanup = setKeys({ groq: "groq-key", openRouter: "or-key" });
        globalThis.fetch = mockFetch((url) => {
            if (url.includes("groq.com")) {
                return new Response("Forbidden", { status: 403 });
            }
            return jsonResponse("LAYOUT: Fallback success.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("Fallback success");
            expect(result.providerId).toBe("openrouter");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("uses only Groq when only Groq key available", async () => {
        const cleanup = setKeys({ groq: "groq-key" });
        let calledUrl = "";
        globalThis.fetch = mockFetch((url) => {
            calledUrl = url;
            return jsonResponse("LAYOUT: Groq only.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.providerId).toBe("groq");
            expect(calledUrl).toContain("api.groq.com");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("reports all providers exhausted when both fail", async () => {
        const cleanup = setKeys({ groq: "groq-key", openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return new Response("Rate limited", { status: 429 });
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("all providers exhausted");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("returns usage from successful call", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return jsonResponse("LAYOUT: Test.", { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 });
        });
        try {
            const result = await perceive(makeInput());
            expect(result.usage?.total_tokens).toBe(550);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("strips think tags from output", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return jsonResponse("<think>reasoning...</think>LAYOUT: Clean result.");
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).not.toContain("<think>");
            expect(result.interpretation).toContain("LAYOUT: Clean result.");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("handles empty content from model", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return new Response(JSON.stringify({
                choices: [{ message: { content: null } }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("no content");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("single provider 4xx with no fallback returns exhausted", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return new Response("Forbidden", { status: 403 });
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("all providers exhausted");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("uses orientation mode when no subtask provided", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. LAYOUT: Test page.\n2. STATE: Idle.");
        });
        try {
            const result = await perceive(makeInput({ objective: "buy shoes" }));
            expect(result.mode).toBe("orientation");
            // Orientation mode should contain the generic section marker
            const parsed = JSON.parse(sentBody);
            const promptText = parsed.messages[0].content[0].text;
            expect(promptText).toContain("situational awareness");
            expect(promptText).not.toContain("CURRENT SUBTASK");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("uses focused mode when subtask provided", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. SUBTASK_STATE: Form is empty.\n5. COMPLETION_SIGNAL: NOT_DONE — fields not filled");
        });
        try {
            const result = await perceive(makeInput({
                subtask: "Fill the shipping address form",
                toolProfile: "form_fill",
            }));
            expect(result.mode).toBe("focused");
            const parsed = JSON.parse(sentBody);
            const promptText = parsed.messages[0].content[0].text;
            expect(promptText).toContain("CURRENT SUBTASK: Fill the shipping address form");
            expect(promptText).toContain("TOOL PROFILE: form_fill");
            expect(promptText).not.toContain("situational awareness");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("falls back to orientation when subtask is too short", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return jsonResponse("1. LAYOUT: Test.");
        });
        try {
            const result = await perceive(makeInput({ subtask: "do it" }));
            expect(result.mode).toBe("orientation");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("parses COMPLETION_SIGNAL in focused mode", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return jsonResponse(
                "1. SUBTASK_STATE: Form filled.\n" +
                "2. ACTIONABLE: None — subtask complete.\n" +
                "3. BLOCKERS: None.\n" +
                "4. VISUAL-ONLY: None.\n" +
                "5. COMPLETION_SIGNAL: DONE — Confirmation message visible."
            );
        });
        try {
            const result = await perceive(makeInput({
                subtask: "Submit the checkout form",
            }));
            expect(result.completionSignal).toBeDefined();
            expect(result.completionSignal?.status).toBe("done");
            expect(result.completionSignal?.scope).toBe("subtask");
            expect(result.completionSignal?.evidence).toContain("Confirmation");
            // Backward compat
            expect(result.objectiveCheck?.status).toBe("done");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });

    test("parses OBJECTIVE_CHECK in orientation mode", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return jsonResponse(
                "1. LAYOUT: Confirmation page.\n" +
                "6. OBJECTIVE_CHECK: DONE — Order confirmation #1234 visible."
            );
        });
        try {
            const result = await perceive(makeInput({ objective: "Buy red shoes" }));
            expect(result.completionSignal).toBeDefined();
            expect(result.completionSignal?.status).toBe("done");
            expect(result.completionSignal?.scope).toBe("objective");
            expect(result.completionSignal?.evidence).toContain("Order confirmation");
        } finally {
            cleanup();
            globalThis.fetch = originalFetch;
        }
    });
});

describe("parseCompletionSignal()", () => {
    test("parses COMPLETION_SIGNAL: DONE", () => {
        const result = parseCompletionSignal(
            "5. COMPLETION_SIGNAL: DONE — Form submitted successfully.",
            "subtask",
        );
        expect(result).toEqual({
            status: "done",
            evidence: "Form submitted successfully.",
            scope: "subtask",
        });
    });

    test("parses COMPLETION_SIGNAL: NOT_DONE", () => {
        const result = parseCompletionSignal(
            "5. COMPLETION_SIGNAL: NOT_DONE — Two fields still empty.",
            "subtask",
        );
        expect(result?.status).toBe("not_done");
        expect(result?.evidence).toContain("Two fields");
    });

    test("parses OBJECTIVE_CHECK: UNCLEAR", () => {
        const result = parseCompletionSignal(
            "6. OBJECTIVE_CHECK: UNCLEAR — Page is loading.",
            "objective",
        );
        expect(result?.status).toBe("unclear");
        expect(result?.scope).toBe("objective");
    });

    test("returns null when no signal found", () => {
        const result = parseCompletionSignal("No matching content here.", "subtask");
        expect(result).toBeNull();
    });

    test("handles em-dash separator", () => {
        const result = parseCompletionSignal(
            "COMPLETION_SIGNAL: DONE\u2014Confirmation visible.",
            "subtask",
        );
        expect(result?.status).toBe("done");
        expect(result?.evidence).toContain("Confirmation");
    });

    test("truncates long evidence to 200 chars", () => {
        const longEvidence = "A".repeat(300);
        const result = parseCompletionSignal(
            `COMPLETION_SIGNAL: DONE — ${longEvidence}`,
            "subtask",
        );
        expect(result?.evidence.length).toBeLessThanOrEqual(200);
    });
});

describe("computeSnapshotFingerprint()", () => {
    test("produces consistent fingerprint for same snapshot", () => {
        const snap = makeSnapshot();
        const fp1 = computeSnapshotFingerprint(snap);
        const fp2 = computeSnapshotFingerprint(snap);
        expect(fp1).toBe(fp2);
    });

    test("differs when URL changes", () => {
        const snap1 = makeSnapshot({ url: "https://example.com/a" });
        const snap2 = makeSnapshot({ url: "https://example.com/b" });
        expect(computeSnapshotFingerprint(snap1)).not.toBe(computeSnapshotFingerprint(snap2));
    });

    test("differs when elements change", () => {
        const snap1 = makeSnapshot({ elements: [makeElement({ tag: 1, text: "Hello" })] });
        const snap2 = makeSnapshot({ elements: [makeElement({ tag: 1, text: "World" })] });
        expect(computeSnapshotFingerprint(snap1)).not.toBe(computeSnapshotFingerprint(snap2));
    });

    test("differs when element count changes", () => {
        const snap1 = makeSnapshot({ elements: [makeElement()] });
        const snap2 = makeSnapshot({ elements: [makeElement({ tag: 1 }), makeElement({ tag: 2, text: "Other" })] });
        expect(computeSnapshotFingerprint(snap1)).not.toBe(computeSnapshotFingerprint(snap2));
    });

    test("differs when title changes", () => {
        const snap1 = makeSnapshot({ title: "Browser Navigation Challenge" });
        const snap2 = makeSnapshot({ title: "Page not found" });
        expect(computeSnapshotFingerprint(snap1)).not.toBe(computeSnapshotFingerprint(snap2));
    });

    test("contains URL, title, and element count in fingerprint", () => {
        const snap = makeSnapshot({ url: "https://test.com", title: "Test Page", elements: [makeElement(), makeElement({ tag: 2 })] });
        const fp = computeSnapshotFingerprint(snap);
        expect(fp).toContain("https://test.com");
        expect(fp).toContain("Test Page");
        expect(fp).toContain("|2|");
    });
});

describe("computeElementSignatures()", () => {
    test("produces signatures from elements", () => {
        const snap = makeSnapshot({
            elements: [
                makeElement({ tag: 1, tagName: "button", text: "Submit" }),
                makeElement({ tag: 2, tagName: "input", text: "" }),
            ],
        });
        const sigs = computeElementSignatures(snap);
        expect(sigs.size).toBe(2);
    });

    test("includes state attributes in signature", () => {
        const snap = makeSnapshot({
            elements: [
                makeElement({ tag: 1, tagName: "input", text: "", attributes: { disabled: "true" } }),
            ],
        });
        const sigs = computeElementSignatures(snap);
        const sigArr = [...sigs];
        expect(sigArr[0]).toContain("disabled=true");
    });
});
