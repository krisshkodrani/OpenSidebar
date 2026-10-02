import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../setup";
import {
  useTrendData,
  TREND_MAX_DAYS,
} from "../../src/trace-viewer/hooks/useTrendData";
import { fetchTraceTrends } from "../../src/trace-viewer/api";

vi.mock("../../src/trace-viewer/api", () => ({ fetchTraceTrends: vi.fn() }));

describe("grouped trend reads", () => {
  it("loads the series with one request and aborts it when filters change", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.mocked(fetchTraceTrends).mockResolvedValue([]);
    function Harness({ from }: { from: string }) {
      const { loading } = useTrendData({ from });
      return React.createElement("span", null, loading ? "Loading" : "Ready");
    }
    try {
      await act(async () =>
        root.render(React.createElement(Harness, { from: "2026-09-01" })),
      );
      expect(container.textContent).toBe("Ready");
      expect(fetchTraceTrends).toHaveBeenCalledTimes(1);
      const firstSignal = vi.mocked(fetchTraceTrends).mock.calls[0][2]!;
      expect(fetchTraceTrends).toHaveBeenCalledWith(
        { from: "2026-09-01" },
        TREND_MAX_DAYS,
        firstSignal,
      );
      await act(async () =>
        root.render(React.createElement(Harness, { from: "2026-09-02" })),
      );
      expect(firstSignal.aborted).toBe(true);
      expect(fetchTraceTrends).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
    }
    expect(vi.mocked(fetchTraceTrends).mock.calls[1][2]!.aborted).toBe(true);
  });
});
