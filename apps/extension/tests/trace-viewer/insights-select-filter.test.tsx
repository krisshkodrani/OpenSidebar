import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import SelectFilter from "../../src/trace-viewer/components/traces/SelectFilter";

describe("Analytics SelectFilter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  function selectEl(): HTMLSelectElement {
    const el = container.querySelector("select");
    if (!el) throw new Error("select not found");
    return el as HTMLSelectElement;
  }

  test("reset option emits the configured empty sentinel regardless of selection", async () => {
    // Regression: the reset <option> used `value === "" ? "" : "all"`, so for the
    // Tool filter (empty sentinel "") choosing "All tools" after a pick emitted
    // "all" instead of "" — an inconsistent sentinel.
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <SelectFilter
          label="Tool"
          value="click"
          onChange={onChange}
          options={["click", "type"]}
          emptyLabel="All tools"
          emptyValue=""
        />,
      );
    });

    const resetOption = Array.from(selectEl().options).find(
      (o) => o.textContent === "All tools",
    );
    expect(resetOption).toBeTruthy();
    expect(resetOption!.value).toBe("");

    await act(async () => {
      const el = selectEl();
      el.value = "";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("");
  });

  test("defaults the empty sentinel to 'all' for the standard filters", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <SelectFilter
          label="Skill"
          value="search-flow"
          onChange={onChange}
          options={["search-flow"]}
          emptyLabel="All skills"
        />,
      );
    });

    const resetOption = Array.from(selectEl().options).find(
      (o) => o.textContent === "All skills",
    );
    expect(resetOption!.value).toBe("all");
  });
});
