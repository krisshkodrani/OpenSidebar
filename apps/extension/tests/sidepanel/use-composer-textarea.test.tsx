import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import "../setup";
import { useComposerTextarea } from "../../src/sidepanel/hooks/useComposerTextarea";

function Harness({ onStop }: { onStop: () => void }) {
  useComposerTextarea({
    isAgentRunning: true,
    inputText: "",
    interactionPending: false,
    onSubmit: () => {},
    onStop,
  });
  return null;
}

describe("useComposerTextarea", () => {
  test("ignores synthetic Escape sent by page automation", async () => {
    const onStop = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Harness onStop={onStop} />));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(onStop).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
