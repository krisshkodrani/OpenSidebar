import { describe, expect, test } from "vitest";
import "../setup";
import { PresenceCoordinator, WATCHDOG_MS } from "../../src/content/presence/coordinator";
import { buildScript } from "../../src/content/presence/choreography";
import { PRESENCE_HOST_TAG } from "../../src/content/presence/cursor";

function makeCoordinator(opts: { reduced?: boolean; brokenRaf?: boolean } = {}) {
  return new PresenceCoordinator({
    doc: document,
    prefersReducedMotion: () => opts.reduced ?? false,
    // brokenRaf simulates a throttled/hung tab: frames never fire.
    raf: opts.brokenRaf ? () => {} : (cb) => setTimeout(cb, 0),
    sessionHideDelayMs: 60,
  });
}

function clickScript(x = 50, y = 60) {
  return buildScript({ kind: "click", point: { x, y } });
}

describe("presence coordinator", () => {
  test("off mode resolves immediately and mounts nothing", async () => {
    const coord = makeCoordinator();
    coord.setMode("off");
    await coord.perform(clickScript());
    expect(document.querySelector(PRESENCE_HOST_TAG)).toBeNull();
  });

  test("subtle mode mounts the host with an open shadow root", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    await coord.perform(clickScript());
    const host = document.querySelector(PRESENCE_HOST_TAG);
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    expect(host!.getAttribute("aria-hidden")).toBe("true");
    coord.setMode("off"); // detaches
    expect(document.querySelector(PRESENCE_HOST_TAG)).toBeNull();
  });

  test("fail-open: a hung frame loop cannot block the action past the watchdog", async () => {
    const coord = makeCoordinator({ brokenRaf: true });
    coord.setMode("subtle");
    const start = Date.now();
    await coord.perform(clickScript(400, 400));
    const waited = Date.now() - start;
    expect(waited).toBeLessThan(WATCHDOG_MS.subtle + 400);
    coord.setMode("off");
  });

  test("perform never rejects even when the script throws internally", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    const script = clickScript();
    // Sabotage: a haloTarget whose getBoundingClientRect throws.
    script.haloTarget = {
      getBoundingClientRect() {
        throw new Error("boom");
      },
    } as unknown as Element;
    await expect(coord.perform(script)).resolves.toBeUndefined();
    coord.setMode("off");
  });

  test("suspend hides the host synchronously; resume restores it", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    await coord.perform(clickScript());
    const host = (coord.cursor.getLayer()!.getRootNode() as ShadowRoot)
      .host as HTMLElement;
    coord.suspend();
    expect(host.style.display).toBe("none");
    coord.resume();
    expect(host.style.display).toBe("");
    coord.setMode("off");
  });

  test("suspended coordinator skips choreography entirely", async () => {
    const coord = makeCoordinator();
    coord.setMode("subtle");
    coord.suspend();
    const start = Date.now();
    await coord.perform(clickScript(500, 500));
    expect(Date.now() - start).toBeLessThan(50);
    coord.setMode("off");
  });

  test("reduced motion repositions instantly — no glide frames", async () => {
    const coord = makeCoordinator({ reduced: true, brokenRaf: false });
    coord.setMode("subtle");
    const start = Date.now();
    await coord.perform(clickScript(800, 600));
    // No Fitts-scaled glide (~300ms) — just press frames.
    expect(Date.now() - start).toBeLessThan(120);
    expect(coord.cursor.position).toEqual({ x: 800, y: 600 });
    coord.setMode("off");
  });

  test("session-scoped visibility: no per-action hiding, debounced fade at session end", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    coord.setSessionActive(true);
    const cursorEl = coord.cursor
      .getLayer()!
      .querySelector("#cursor") as HTMLElement;
    expect(cursorEl.classList.contains("visible")).toBe(true);
    await coord.perform(clickScript(300, 200));
    // Still visible after the action — a real cursor never vanishes mid-run.
    expect(cursorEl.classList.contains("visible")).toBe(true);
    coord.setSessionActive(false);
    // Debounce: still visible right after the signal drops...
    expect(cursorEl.classList.contains("visible")).toBe(true);
    await new Promise((r) => setTimeout(r, 140));
    // ...and hidden once the debounce elapses with no reactivation.
    expect(cursorEl.classList.contains("visible")).toBe(false);
    coord.setMode("off");
  });

  test("lane flip (inactive then active again) never hides the cursor", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    coord.setSessionActive(true);
    const cursorEl = coord.cursor
      .getLayer()!
      .querySelector("#cursor") as HTMLElement;
    coord.setSessionActive(false);
    coord.setSessionActive(true); // next lane starts within the debounce
    await new Promise((r) => setTimeout(r, 140));
    expect(cursorEl.classList.contains("visible")).toBe(true);
    coord.setMode("off");
  });

  test("chips spawn in the settle phase, anchored to fresh geometry", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    const script = clickScript(120, 120);
    script.kind = "select";
    script.chipText = "Finance ✓";
    await coord.perform(script);
    // Settle rides the queue after dispatch — allow it to run.
    await new Promise((r) => setTimeout(r, 60));
    const chip = coord.cursor.getLayer()!.querySelector(".chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("Finance ✓");
    coord.setMode("off");
  });

  test("focus halo appears once: auto-fades after TTL and never survives a suspend", async () => {
    const coord = makeCoordinator({ reduced: true });
    coord.setMode("subtle");
    document.body.innerHTML = `<input id="field" />`;
    const script = clickScript(100, 100);
    script.kind = "type";
    script.haloTarget = document.getElementById("field");
    await coord.perform(script);
    const layer = coord.cursor.getLayer()!;
    expect(layer.querySelector(".halo")).not.toBeNull();
    // Suspend (capture bracket) clears it — resume must NOT bring it back.
    coord.suspend();
    coord.resume();
    await new Promise((r) => setTimeout(r, 250));
    expect(layer.querySelector(".halo")).toBeNull();
    // And when undisturbed, it fades on its own after HALO_TTL_MS.
    await coord.perform(script);
    expect(layer.querySelector(".halo")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1200));
    expect(layer.querySelector(".halo")).toBeNull();
    coord.setMode("off");
  });

  test("errorPulse is safe in every mode", () => {
    const coord = makeCoordinator();
    coord.setMode("off");
    expect(() => coord.errorPulse()).not.toThrow();
    coord.setMode("subtle");
    expect(() => coord.errorPulse()).not.toThrow();
    coord.setMode("off");
  });
});
