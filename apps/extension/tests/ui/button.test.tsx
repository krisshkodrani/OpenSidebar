import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";

import "../setup";
import { Button, buttonVariants } from "../../src/ui/button";

describe("Button", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("exposes typed variant classes", () => {
    expect(buttonVariants({ variant: "secondary", size: "sm" })).toContain("h-8");
    expect(buttonVariants({ variant: "secondary", size: "sm" })).toContain("bg-slate-100");
  });

  test("renders an accessible native button by default", async () => {
    await act(async () => {
      root.render(
        <Button variant="outline" size="sm" className="h-10">
          Run
        </Button>,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Run");
    expect(button?.className).toContain("border");
    expect(button?.className).toContain("h-10");
    expect(button?.className).not.toContain("h-8");
  });
});
