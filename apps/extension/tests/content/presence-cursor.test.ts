import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { PresenceCoordinator } from "../../src/content/presence/coordinator";
import { buildScript } from "../../src/content/presence/choreography";
import { PresenceCursor } from "../../src/content/presence/cursor";
import { CURSOR_HOTSPOT } from "../../src/content/presence/presence-styles";

describe("presence cursor animation", () => {
  let cursor: PresenceCursor;
  afterEach(() => {
    cursor?.detach();
    vi.useRealTimers();
  });

  test("renders 33% smaller with its tip on the requested coordinates", () => {
    cursor = new PresenceCursor(document);
    cursor.show();
    cursor.moveTo({ x: 100, y: 80 });
    const el = cursor.getLayer()!.querySelector<HTMLElement>("#cursor")!;
    expect(Number(el.querySelector("svg")!.getAttribute("width"))).toBeCloseTo(
      21.44,
    );
    expect(el.style.transform).toBe(
      `translate3d(${100 - CURSOR_HOTSPOT.x}px, ${80 - CURSOR_HOTSPOT.y}px, 0)`,
    );
  });

  test("preserves the start and timing, and a completed glide cannot rewind later movement", async () => {
    vi.useFakeTimers();
    cursor = new PresenceCursor(document);
    cursor.show();
    const el = cursor.getLayer()!.querySelector<HTMLElement>("#cursor")!;
    let finish!: () => void;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel,
    }));
    el.animate = animate as unknown as HTMLElement["animate"];
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 60 },
      { x: 100, y: 80 },
    ];
    const glide = cursor.animateGlide(points, 200);
    expect(animate.mock.calls[0]).toEqual([
      points.map((p, i) => ({
        transform: `translate3d(${p.x - CURSOR_HOTSPOT.x}px, ${p.y - CURSOR_HOTSPOT.y}px, 0)`,
        offset: i / 2,
      })),
      expect.objectContaining({ duration: 200, easing: "linear" }),
    ]);
    finish();
    await glide;
    cursor.moveTo({ x: 250, y: 300 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursor.position).toEqual({ x: 250, y: 300 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("presence fallback timing", () => {
  test("slow and fast displays keep the same wall-clock travel duration", async () => {
    vi.useFakeTimers();
    const durations: number[] = [];
    try {
      for (const frameMs of [8, 32]) {
        const coordinator = new PresenceCoordinator({
          doc: document,
          prefersReducedMotion: () => false,
          raf: (cb) => {
            setTimeout(cb, frameMs);
          },
        });
        coordinator.setMode("subtle");
        coordinator.setSessionActive(true);
        coordinator.cursor.moveTo({ x: 100, y: 100 });
        const started = Date.now();
        const action = coordinator.perform(
          buildScript({ kind: "click", point: { x: 700, y: 400 } }),
        );
        let elapsed = 0;
        void action.then(() => {
          elapsed = Date.now() - started;
        });
        await vi.advanceTimersByTimeAsync(500);
        await action;
        expect(coordinator.cursor.position).toEqual({ x: 700, y: 400 });
        expect(elapsed).toBeGreaterThan(90);
        expect(elapsed).toBeLessThan(450);
        durations.push(elapsed);
        coordinator.setMode("off");
      }
      expect(Math.abs(durations[0] - durations[1])).toBeLessThan(65);
    } finally {
      vi.useRealTimers();
    }
  });
});
