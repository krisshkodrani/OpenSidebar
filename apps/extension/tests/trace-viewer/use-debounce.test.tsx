import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useDebounce } from "../../src/trace-viewer/hooks/useDebounce";

let latest = "";

function Harness({ value, delay }: { value: string; delay: number }) {
  latest = useDebounce(value, delay);
  return null;
}

describe("useDebounce", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    latest = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  test("returns the initial value immediately", () => {
    act(() => {
      root.render(<Harness value="a" delay={250} />);
    });
    expect(latest).toBe("a");
  });

  test("does not update before the delay elapses, then updates", () => {
    act(() => {
      root.render(<Harness value="a" delay={250} />);
    });
    act(() => {
      root.render(<Harness value="b" delay={250} />);
    });
    expect(latest).toBe("a");

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(latest).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest).toBe("b");
  });

  test("resets the timer on rapid changes so only the last value lands", () => {
    act(() => {
      root.render(<Harness value="a" delay={250} />);
    });
    act(() => {
      root.render(<Harness value="b" delay={250} />);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // New value before the previous timer fires resets the countdown.
    act(() => {
      root.render(<Harness value="c" delay={250} />);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(latest).toBe("a"); // 200ms < 250ms since "c"

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(latest).toBe("c"); // "b" never lands
  });
});
