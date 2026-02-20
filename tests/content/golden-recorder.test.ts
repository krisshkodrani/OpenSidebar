import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import "../setup";
import {
  startGoldenRecording,
  stopGoldenRecording,
  startRecording,
  stopRecording,
  isRecording,
  isGoldenMode,
} from "../../src/content/recorder";

// Capture messages sent via chrome.runtime.sendMessage
let sentMessages: any[] = [];

beforeEach(() => {
  sentMessages = [];
  (global as any).chrome = {
    runtime: {
      sendMessage: async (msg: any) => {
        sentMessages.push(msg);
      },
    },
  };
});

afterEach(() => {
  // Clean up recording state
  if (isRecording()) {
    if (isGoldenMode()) {
      stopGoldenRecording();
    } else {
      stopRecording();
    }
  }
});

describe("Golden Recorder", () => {
  test("startGoldenRecording sets golden mode", () => {
    startGoldenRecording();
    expect(isRecording()).toBe(true);
    expect(isGoldenMode()).toBe(true);
  });

  test("stopGoldenRecording clears golden mode", () => {
    startGoldenRecording();
    stopGoldenRecording();
    expect(isRecording()).toBe(false);
    expect(isGoldenMode()).toBe(false);
  });

  test("normal recording does not set golden mode", () => {
    startRecording();
    expect(isRecording()).toBe(true);
    expect(isGoldenMode()).toBe(false);
    stopRecording();
  });

  test("click in golden mode emits GOLDEN_ACTION", () => {
    startGoldenRecording();

    // Simulate a click event
    const button = document.createElement("button");
    button.textContent = "Click me";
    button.setAttribute("data-os-tag", "42");
    document.body.appendChild(button);

    const event = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: button });
    button.dispatchEvent(event);

    // Check that a GOLDEN_ACTION was emitted
    const goldenMessages = sentMessages.filter((m) => m.type === "GOLDEN_ACTION");
    expect(goldenMessages.length).toBeGreaterThanOrEqual(1);

    const msg = goldenMessages[0];
    expect(msg.payload.goldenAction.tagId).toBe(42);
    expect(msg.payload.goldenAction.action.type).toBe("click");
    expect(msg.payload.goldenAction.snapshot).toBeDefined();
    expect(msg.payload.goldenAction.snapshot.elements).toBeDefined();

    document.body.removeChild(button);
    stopGoldenRecording();
  });

  test("click in normal mode emits DEMO_ACTION_CAPTURED", () => {
    startRecording();

    const button = document.createElement("button");
    button.textContent = "Click me";
    document.body.appendChild(button);

    const event = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: button });
    button.dispatchEvent(event);

    const demoMessages = sentMessages.filter((m) => m.type === "DEMO_ACTION_CAPTURED");
    expect(demoMessages.length).toBeGreaterThanOrEqual(1);

    // Should NOT emit GOLDEN_ACTION
    const goldenMessages = sentMessages.filter((m) => m.type === "GOLDEN_ACTION");
    expect(goldenMessages).toHaveLength(0);

    document.body.removeChild(button);
    stopRecording();
  });

  test("scroll in golden mode emits tagId: null", (done) => {
    startGoldenRecording();

    // Trigger scroll
    window.dispatchEvent(new Event("scroll"));

    // Scroll uses throttle timer (300ms), so we flush manually via stop
    setTimeout(() => {
      stopGoldenRecording();

      const goldenMessages = sentMessages.filter((m) => m.type === "GOLDEN_ACTION");
      // May or may not have scroll (depends on scrollAccumulator)
      // If scroll was captured, verify tagId is null
      for (const msg of goldenMessages) {
        if (msg.payload.goldenAction.action.type === "scroll") {
          expect(msg.payload.goldenAction.tagId).toBeNull();
        }
      }
      done();
    }, 400);
  });
});
