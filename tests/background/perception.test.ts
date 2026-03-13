import "../setup";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { perceive, parseCompletionSignal, buildPerceptionPrompt, type PerceptionInput, type PanoramicShot } from "../../src/background/perception";
import { PerceptionAgent, formatPriorObservations, validatePerceptionTagIds } from "../../src/background/perception/perception-agent";
import { buildProductionPerceptionPrompt } from "../../src/background/perception/prompt-builder";
import type { ObservationEntry, ObserveInput } from "../../src/background/perception/types";
import { computeSnapshotFingerprint, computeElementSignatures } from "../../src/background/agent/stagnation";
import type { DomSnapshot, TaggedElement } from "../../src/types";
import { replayPerceptionCase } from "../../evals/perception-runner";
import type { PerceptionEvalCase } from "../../evals/types";

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

function makeObserveInput(overrides: Partial<ObserveInput> = {}): ObserveInput {
    return {
        screenshotDataUrl: "data:image/jpeg;base64,AAAA",
        elements: [
            makeElement({ tag: 1 }),
            makeElement({ tag: 2, tagName: "input", text: "Email" }),
            makeElement({ tag: 3, tagName: "a", text: "Home" }),
            makeElement({ tag: 4, tagName: "button", text: "Submit" }),
        ],
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
function setKeys(opts: { openRouter?: string }): () => void {
    const origSyncGet = chrome.storage.sync.get;
    const origSessionGet = chrome.storage.session.get;

    chrome.storage.sync.get = (async () => ({
        userSettings: {},
    })) as any;

    chrome.storage.session.get = (async () => ({
        openRouterApiKey: opts.openRouter ?? "",
    })) as any;

    return () => {
        chrome.storage.sync.get = origSyncGet;
        chrome.storage.session.get = origSessionGet;
    };
}

function jsonResponse(content: string, usage?: Record<string, number>): Response {
    return new Response(JSON.stringify({
        choices: [{ message: { content } }],
        ...(usage ? { usage } : {}),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ----- Legacy perceive() Tests -----

describe("perceive() [legacy]", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("returns fallback when no API key", async () => {
        const cleanup = setKeys({});
        try {
            const result = await perceive(makeInput());
            expect(result.cached).toBe(false);
            expect(result.interpretation).toContain("No API key");
            expect(result.model).toBe("x-ai/grok-4.1-fast");
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
            expect(result.model).toBe("x-ai/grok-4.1-fast");
            expect(calledUrl).toContain("openrouter.ai");
        } finally {
            cleanup();
        }
    });

    test("reports all providers exhausted when all fail", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => {
            return new Response("Rate limited", { status: 429 });
        });
        try {
            const result = await perceive(makeInput());
            expect(result.interpretation).toContain("all providers exhausted");
        } finally {
            cleanup();
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
        }
    });
});

// ----- parseCompletionSignal() — kept for eval compat -----

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

// ----- Fingerprint Tests -----

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

// ----- Panoramic Perception Tests (legacy perceive) -----

const makePanoramicShots = (): PanoramicShot[] => [
    { dataUrl: "data:image/jpeg;base64,TOP", scrollY: 0, label: "top" },
    { dataUrl: "data:image/jpeg;base64,BOTTOM", scrollY: 2000, label: "bottom" },
];

describe("panoramic perception [legacy]", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("perceive() with panoramic screenshots sends multi-image content", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. LAYOUT: Full page overview.");
        });
        try {
            const result = await perceive(makeInput({
                panoramicScreenshots: makePanoramicShots(),
            }));
            expect(result.interpretation).toContain("LAYOUT:");
            const parsed = JSON.parse(sentBody);
            const content = parsed.messages[0].content;
            // Should have: text + primary image + 2 panoramic images = 4 parts
            expect(content.length).toBe(4);
            expect(content[0].type).toBe("text");
            expect(content[1].type).toBe("image_url");
            expect(content[2].type).toBe("image_url");
            expect(content[3].type).toBe("image_url");
        } finally {
            cleanup();
        }
    });

    test("panoramic max_tokens is 800", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. LAYOUT: Panoramic.");
        });
        try {
            await perceive(makeInput({
                panoramicScreenshots: makePanoramicShots(),
            }));
            const parsed = JSON.parse(sentBody);
            expect(parsed.max_tokens).toBe(800);
        } finally {
            cleanup();
        }
    });

    test("non-panoramic max_tokens is 600", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. LAYOUT: Normal.");
        });
        try {
            await perceive(makeInput());
            const parsed = JSON.parse(sentBody);
            expect(parsed.max_tokens).toBe(600);
        } finally {
            cleanup();
        }
    });
});

// ----- PerceptionAgent Tests -----

describe("PerceptionAgent", () => {
    let originalFetch: typeof globalThis.fetch;
    let agent: PerceptionAgent;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        agent = new PerceptionAgent();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const SAMPLE_RESPONSE = [
        "1. LOCATION: Example.com — Home page.",
        "2. CHANGES: Initial page load. Simple layout with one button.",
        "3. BLOCKERS: None.",
        "4. VISUAL-ONLY: None.",
        "5. AFFORDANCES: [1] Click me button, center.",
    ].join("\n");

    const SAMPLE_RESPONSE_2 = [
        "1. LOCATION: Example.com — Results page, Step 2 of 3.",
        "2. CHANGES: Page navigated from home to results. New search results visible.",
        "3. BLOCKERS: NUISANCE [5] \"cookie banner\" → click [6]",
        "4. VISUAL-ONLY: Chart shows 42% increase.",
        "5. AFFORDANCES: [2] Email input; [4] Submit button.",
    ].join("\n");

    test("first observe() produces interpretation with no prior observations in prompt", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            const result = await agent.observe(makeObserveInput(), "fp1");
            expect(result.interpretation).toContain("LOCATION:");
            expect(result.cached).toBe(false);

            // Prompt should NOT have prior observations on first call
            const parsed = JSON.parse(sentBody);
            const promptText = parsed.messages[0].content[0].text;
            expect(promptText).not.toContain("Prior observations");

            // Should have the first-turn hint
            expect(promptText).toContain("First observation");

            // Observation should be parsed and stored
            expect(result.observation).toBeDefined();
            expect(result.observation?.location).toContain("Example.com");
            expect(agent.getObservationLog().length).toBe(1);
        } finally {
            cleanup();
        }
    });

    test("second observe() includes prior observations in prompt", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        let callCount = 0;
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            callCount++;
            return jsonResponse(callCount === 1 ? SAMPLE_RESPONSE : SAMPLE_RESPONSE_2);
        });
        try {
            // First call
            await agent.observe(makeObserveInput(), "fp1");
            // Second call (different fingerprint to bypass cache)
            await agent.observe(makeObserveInput({ url: "https://example.com/results" }), "fp2");

            const parsed = JSON.parse(sentBody);
            const promptText = parsed.messages[0].content[0].text;
            expect(promptText).toContain("Prior observations");
            expect(promptText).toContain("T1:");
            expect(agent.getObservationLog().length).toBe(2);
        } finally {
            cleanup();
        }
    });

    test("cache hit when fingerprint unchanged < 2 turns", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            // First call — fresh
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(1);

            // Second call, same fingerprint — should be cached
            const cached = await agent.observe(makeObserveInput(), "fp1");
            expect(cached.cached).toBe(true);
            expect(callCount).toBe(1); // No additional API call
            expect(cached.interpretation).toContain("LOCATION:");
        } finally {
            cleanup();
        }
    });

    test("force re-interpret after 2 stale turns", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(1);

            // Stale turn 1 — cached
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(1);

            // Stale turn 2 — forced re-interpret
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(2);
        } finally {
            cleanup();
        }
    });

    test("invalidateCache() forces fresh call", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(1);

            agent.invalidateCache();
            await agent.observe(makeObserveInput(), "fp1");
            expect(callCount).toBe(2);
        } finally {
            cleanup();
        }
    });

    test("observation log window caps at 5 entries with overflow", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(
                `1. LOCATION: Page ${callCount}.\n2. CHANGES: Update ${callCount}.\n3. BLOCKERS: None.\n4. VISUAL-ONLY: None.\n5. AFFORDANCES: None.`,
            );
        });
        try {
            // Make 7 calls with different fingerprints
            for (let i = 1; i <= 7; i++) {
                await agent.observe(makeObserveInput(), `fp${i}`);
            }
            expect(agent.getObservationLog().length).toBe(7);

            // The formatPriorObservations should show overflow + window
            const formatted = formatPriorObservations(agent.getObservationLog());
            expect(formatted).toContain("[Earlier:");
            expect(formatted).toContain("2 observation(s) compressed");
            // Should have T3-T7 in detail (last 5)
            expect(formatted).toContain("T3:");
            expect(formatted).toContain("T7:");
            // T1, T2 should be in overflow, not in detail lines
            expect(formatted).not.toMatch(/^\s+T1:/m);
            expect(formatted).not.toMatch(/^\s+T2:/m);
        } finally {
            cleanup();
        }
    });

    test("reset() clears all state", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => jsonResponse(SAMPLE_RESPONSE));
        try {
            await agent.observe(makeObserveInput(), "fp1");
            expect(agent.getInterpretation()).not.toBeNull();
            expect(agent.getObservationLog().length).toBe(1);

            agent.reset();
            expect(agent.getInterpretation()).toBeNull();
            expect(agent.getObservationLog().length).toBe(0);
            expect(agent.getFingerprint()).toBe("");
            expect(agent.getLastScreenshot()).toBeNull();
            expect(agent.panoramicDone).toBe(false);
        } finally {
            cleanup();
        }
    });

    test("hydrateFromWarmup() creates initial observation entry", () => {
        agent.hydrateFromWarmup(
            "1. LOCATION: Login page.\n2. CHANGES: Initial.\n3. BLOCKERS: None.",
            "warmup-fp",
            "data:image/jpeg;base64,SCREENSHOT",
            "https://example.com/login",
        );

        expect(agent.getInterpretation()).toContain("LOCATION: Login page");
        expect(agent.getFingerprint()).toBe("warmup-fp");
        expect(agent.getLastScreenshot()).toBe("data:image/jpeg;base64,SCREENSHOT");
        expect(agent.getObservationLog().length).toBe(1);
        expect(agent.getObservationLog()[0].location).toContain("Login page");
    });

    test("getState()/restoreState() round-trip preserves observation log", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        globalThis.fetch = mockFetch(() => jsonResponse(SAMPLE_RESPONSE));
        try {
            await agent.observe(makeObserveInput(), "fp1");
            const state = agent.getState();

            const agent2 = new PerceptionAgent();
            agent2.restoreState(state);

            expect(agent2.getObservationLog().length).toBe(1);
            expect(agent2.getObservationLog()[0].location).toEqual(agent.getObservationLog()[0].location);
            expect(agent2.getFingerprint()).toBe("fp1");
        } finally {
            cleanup();
        }
    });

    test("near-empty DOM (≤3 elements) returns fallback without API call", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            const result = await agent.observe(
                makeObserveInput({
                    elements: [makeElement({ tag: 1 })],
                }),
                "fp1",
            );
            expect(callCount).toBe(0);
            expect(result.model).toBe("dom-fallback");
            expect(result.interpretation).toContain("LOCATION:");
            expect(result.interpretation).toContain("BLOCKERS:");
        } finally {
            cleanup();
        }
    });

    test("unified prompt has all 5 sections (LOCATION, CHANGES, BLOCKERS, VISUAL-ONLY, AFFORDANCES)", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            await agent.observe(makeObserveInput(), "fp1");
            const parsed = JSON.parse(sentBody);
            const promptText = parsed.messages[0].content[0].text;

            expect(promptText).toContain("1. LOCATION:");
            expect(promptText).toContain("2. CHANGES:");
            expect(promptText).toContain("3. BLOCKERS:");
            expect(promptText).toContain("4. VISUAL-ONLY:");
            expect(promptText).toContain("5. AFFORDANCES:");

            // Should NOT contain old dual-mode sections
            expect(promptText).not.toContain("COMPLETION_SIGNAL");
            expect(promptText).not.toContain("OBJECTIVE_CHECK");
            expect(promptText).not.toContain("SUBTASK_STATE");
            expect(promptText).not.toContain("CURRENT SUBTASK");
            expect(promptText).not.toContain("situational awareness");
        } finally {
            cleanup();
        }
    });

    test("shared prompt builder matches production first-observation prompt", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let sentBody = "";
        const input = makeObserveInput();
        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            await agent.observe(input, "fp1");
            const parsed = JSON.parse(sentBody);
            const actualPrompt = parsed.messages[0].content[0].text;
            const expectedPrompt = buildProductionPerceptionPrompt(input, {
                priorObservations: "",
                isFirstObservation: true,
            });
            expect(actualPrompt).toBe(expectedPrompt);
        } finally {
            cleanup();
        }
    });

    test("no API key returns fallback without API call", async () => {
        const cleanup = setKeys({});
        try {
            const result = await agent.observe(makeObserveInput(), "fp1");
            expect(result.interpretation).toContain("No API key");
            expect(result.cached).toBe(false);
        } finally {
            cleanup();
        }
    });

    test("routine tool (click_element) extends stale threshold to 4", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            // First call — fresh
            await agent.observe(makeObserveInput(), "fp1", undefined, "click_element");
            expect(callCount).toBe(1);

            // Stale turns 1-3 with routine tool — should be cached
            await agent.observe(makeObserveInput(), "fp1", undefined, "click_element");
            expect(callCount).toBe(1);
            await agent.observe(makeObserveInput(), "fp1", undefined, "click_element");
            expect(callCount).toBe(1);
            await agent.observe(makeObserveInput(), "fp1", undefined, "click_element");
            expect(callCount).toBe(1);

            // Stale turn 4 — forced re-interpret
            await agent.observe(makeObserveInput(), "fp1", undefined, "click_element");
            expect(callCount).toBe(2);
        } finally {
            cleanup();
        }
    });

    test("navigation tool (navigate) triggers re-interpret after 1 stale turn", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            // First call — fresh
            await agent.observe(makeObserveInput(), "fp1", undefined, "navigate");
            expect(callCount).toBe(1);

            // Stale turn 1 with navigation tool — forced re-interpret
            await agent.observe(makeObserveInput(), "fp1", undefined, "navigate");
            expect(callCount).toBe(2);
        } finally {
            cleanup();
        }
    });

    test("default stale threshold (2) for non-routine/non-navigation tools", async () => {
        const cleanup = setKeys({ openRouter: "or-key" });
        let callCount = 0;
        globalThis.fetch = mockFetch(() => {
            callCount++;
            return jsonResponse(SAMPLE_RESPONSE);
        });
        try {
            await agent.observe(makeObserveInput(), "fp1", undefined, "find_element");
            expect(callCount).toBe(1);

            // Stale turn 1 — cached
            await agent.observe(makeObserveInput(), "fp1", undefined, "find_element");
            expect(callCount).toBe(1);

            // Stale turn 2 — forced re-interpret
            await agent.observe(makeObserveInput(), "fp1", undefined, "find_element");
            expect(callCount).toBe(2);
        } finally {
            cleanup();
        }
    });
});

describe("shared perception prompt path", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("eval replay uses the shared v6 production prompt", async () => {
        let sentBody = "";
        const input = makeObserveInput();
        const evalCase: PerceptionEvalCase = {
            id: "perception-test",
            sourceSessionId: "session-test",
            sourceTurn: 1,
            input: {
                screenshotDataUrl: input.screenshotDataUrl,
                elements: input.elements.map((el) => ({
                    tag: el.tag,
                    tagName: el.tagName,
                    text: el.text,
                    role: el.role || undefined,
                    attributes: el.attributes,
                })),
                url: input.url,
                title: input.title,
                scroll: input.scroll,
            },
            expected: {
                requiredSections: ["LOCATION", "CHANGES", "BLOCKERS", "VISUAL-ONLY", "AFFORDANCES"],
            },
            reference: {
                interpretation: "",
                model: "test-model",
                durationMs: 0,
            },
            metadata: {
                url: input.url,
                query: "test query",
                difficulty: "easy",
                tags: ["perception"],
            },
        };

        globalThis.fetch = mockFetch((_url, init) => {
            sentBody = (init?.body as string) || "";
            return jsonResponse("1. LOCATION: Test.\n2. CHANGES: None.\n3. BLOCKERS: None.\n4. VISUAL-ONLY: None.\n5. AFFORDANCES: None.");
        });

        await replayPerceptionCase({ openrouter: "or-key" }, evalCase);
        const parsed = JSON.parse(sentBody);
        const actualPrompt = parsed.messages[0].content[0].text;
        const expectedPrompt = buildProductionPerceptionPrompt(input, {
            priorObservations: "",
            isFirstObservation: true,
        });

        expect(actualPrompt).toBe(expectedPrompt);
        expect(actualPrompt).toContain("1. LOCATION:");
        expect(actualPrompt).toContain("5. AFFORDANCES:");
        expect(actualPrompt).not.toContain("COMPLETION_SIGNAL");
        expect(actualPrompt).not.toContain("OBJECTIVE_CHECK");
    });
});

// ----- formatPriorObservations() -----

describe("formatPriorObservations()", () => {
    test("returns empty string for empty log", () => {
        expect(formatPriorObservations([])).toBe("");
    });

    test("formats single entry without overflow", () => {
        const log: ObservationEntry[] = [
            { turn: 1, url: "https://example.com", location: "Home page", changes: "Initial load", blockers: "None", visualOnly: "", fingerprint: "fp1" },
        ];
        const result = formatPriorObservations(log);
        expect(result).toContain("Prior observations");
        expect(result).toContain("T1:");
        expect(result).toContain("Home page");
        expect(result).not.toContain("[Earlier:");
    });

    test("shows overflow summary when > 5 entries", () => {
        const log: ObservationEntry[] = Array.from({ length: 7 }, (_, i) => ({
            turn: i + 1,
            url: `https://example.com/page${i + 1}`,
            location: `Page ${i + 1}`,
            changes: `Change ${i + 1}`,
            blockers: "None",
            visualOnly: "",
            fingerprint: `fp${i + 1}`,
        }));
        const result = formatPriorObservations(log);
        expect(result).toContain("[Earlier:");
        expect(result).toContain("2 observation(s) compressed");
        expect(result).toContain("T3:");
        expect(result).toContain("T7:");
    });

    test("omits blockers when they are 'None'", () => {
        const log: ObservationEntry[] = [
            { turn: 1, url: "https://example.com", location: "Home", changes: "Loaded", blockers: "None.", visualOnly: "", fingerprint: "fp1" },
        ];
        const result = formatPriorObservations(log);
        expect(result).not.toContain("Blockers:");
    });

    test("includes blockers when present", () => {
        const log: ObservationEntry[] = [
            { turn: 1, url: "https://example.com", location: "Home", changes: "Loaded", blockers: "Cookie banner visible", visualOnly: "", fingerprint: "fp1" },
        ];
        const result = formatPriorObservations(log);
        expect(result).toContain("Blockers: Cookie banner");
    });
});

// ----- validatePerceptionTagIds Tests -----

describe("validatePerceptionTagIds", () => {
    const elements: TaggedElement[] = [
        makeElement({ tag: 1, tagName: "button", text: "Submit" }),
        makeElement({ tag: 6, tagName: "input", text: "Größe 3 (198 Stück)", role: "radio" }),
        makeElement({ tag: 15, tagName: "input", text: "Größe 8 (24 Stück)", role: "radio" }),
        makeElement({ tag: 20, tagName: "button", text: "In den Einkaufswagen" }),
    ];

    test("passes through correct AFFORDANCES unchanged", () => {
        const interpretation = [
            "1. LOCATION: Amazon product page",
            "2. CHANGES: None.",
            "3. BLOCKERS: None.",
            "4. VISUAL-ONLY: None.",
            '5. AFFORDANCES:\n[1] button "Submit"\n[20] button "In den Einkaufswagen"',
        ].join("\n");

        const result = validatePerceptionTagIds(interpretation, elements);
        expect(result).toBe(interpretation);
    });

    test("corrects hallucinated tag-to-element mapping", () => {
        // VLM says [6] is "In den Einkaufswagen" but actual [6] is "Größe 3 (198 Stück)" input
        const interpretation = [
            "1. LOCATION: Amazon product page",
            "2. CHANGES: None.",
            "3. BLOCKERS: None.",
            "4. VISUAL-ONLY: None.",
            '5. AFFORDANCES:\n[6] button "In den Einkaufswagen"\n[20] button "In den Einkaufswagen"',
        ].join("\n");

        const result = validatePerceptionTagIds(interpretation, elements);
        // [6] should be corrected to show actual element description
        expect(result).toContain('[6] input "Größe 3 (198 Stück)"');
        // [20] is correct — should remain
        expect(result).toContain("[20]");
    });

    test("strips non-existent tag IDs", () => {
        const interpretation = [
            "1. LOCATION: Test page",
            "2. CHANGES: None.",
            "3. BLOCKERS: None.",
            "4. VISUAL-ONLY: None.",
            '5. AFFORDANCES:\n[99] button "Ghost element"\n[1] button "Submit"',
        ].join("\n");

        const result = validatePerceptionTagIds(interpretation, elements);
        expect(result).not.toContain("[99]");
        expect(result).toContain("[1]");
    });

    test("passes through interpretation without AFFORDANCES section", () => {
        const interpretation = "1. LOCATION: Test\n2. CHANGES: None.\n3. BLOCKERS: None.\n4. VISUAL-ONLY: None.";
        const result = validatePerceptionTagIds(interpretation, elements);
        expect(result).toBe(interpretation);
    });

    test('handles "None." in AFFORDANCES', () => {
        const interpretation = [
            "1. LOCATION: Test",
            "2. CHANGES: None.",
            "3. BLOCKERS: None.",
            "4. VISUAL-ONLY: None.",
            "5. AFFORDANCES: None.",
        ].join("\n");

        const result = validatePerceptionTagIds(interpretation, elements);
        expect(result).toBe(interpretation);
    });

    test("replaces all invalid refs with fallback message", () => {
        const interpretation = [
            "1. LOCATION: Test",
            "2. CHANGES: None.",
            "3. BLOCKERS: None.",
            "4. VISUAL-ONLY: None.",
            '5. AFFORDANCES:\n[99] fake button\n[100] another ghost',
        ].join("\n");

        const result = validatePerceptionTagIds(interpretation, elements);
        expect(result).toContain("None (all VLM references were invalid)");
    });
});
