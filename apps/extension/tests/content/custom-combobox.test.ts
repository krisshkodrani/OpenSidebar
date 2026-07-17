/**
 * Custom-select (react-select-style) commit + verification.
 *
 * Replicates the widget shape that made the agent loop on real Greenhouse
 * forms: a combobox whose inner <input> is CLEARED when a selection commits
 * (the chosen value moves to a sibling `.select__single-value` node), whose
 * option menu is PORTALED to document.body, and whose page prints no
 * "Selected: X" confirmation. Before these fixes every feedback channel
 * (snapshot value, read_element, extract_form_state, click result) reported
 * the committed widget as empty — so the agent retried until the turn budget
 * died.
 */

import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import {
  tagElements,
  getTagMap,
  resetStableIds,
  extractAttributes,
  isComboboxLikeElement,
  readComboboxCommittedValue,
} from "../../src/content/tagging";

interface Widget {
  input: HTMLInputElement;
  valueContainer: HTMLDivElement;
  commit(label: string): void;
}

/**
 * Build a react-select-shaped widget. `interactive: true` wires the real
 * behavior: mousedown/click on the input opens a portaled menu in
 * document.body; clicking an option commits (single-value node created, input
 * cleared, menu unmounted, input refocused).
 */
function buildWidget(
  options: string[],
  { interactive = false, idSuffix = "1" }: { interactive?: boolean; idSuffix?: string } = {},
): Widget {
  const container = document.createElement("div");
  container.className = "select__container";
  const control = document.createElement("div");
  control.className = "select__control";
  const valueContainer = document.createElement("div");
  valueContainer.className = "select__value-container";
  const input = document.createElement("input");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `listbox-${idSuffix}`);
  input.className = "select__input";
  valueContainer.appendChild(input);
  control.appendChild(valueContainer);
  container.appendChild(control);
  document.body.appendChild(container);

  let menu: HTMLDivElement | null = null;
  const commit = (label: string) => {
    valueContainer
      .querySelectorAll(".select__single-value")
      .forEach((n) => n.remove());
    const display = document.createElement("div");
    display.className = "select__single-value";
    display.textContent = label;
    valueContainer.insertBefore(display, input);
    input.value = "";
    menu?.remove();
    menu = null;
    input.focus();
  };

  if (interactive) {
    const openMenu = () => {
      if (menu) return;
      menu = document.createElement("div");
      const listbox = document.createElement("div");
      listbox.setAttribute("role", "listbox");
      listbox.id = `listbox-${idSuffix}`;
      for (const label of options) {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.className = "select__option";
        option.textContent = label;
        option.addEventListener("click", () => commit(label));
        listbox.appendChild(option);
      }
      menu.appendChild(listbox);
      document.body.appendChild(menu); // the portal
    };
    input.addEventListener("mousedown", openMenu);
    input.addEventListener("click", openMenu);
  }

  return { input, valueContainer, commit };
}

function tagOf(el: Element): number {
  resetStableIds();
  tagElements();
  for (const [tag, entry] of getTagMap().entries()) {
    if (entry === el) return tag;
  }
  throw new Error("element was not tagged");
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetStableIds();
});

describe("readComboboxCommittedValue", () => {
  test("null before a selection commits", () => {
    const { input } = buildWidget(["Austria", "Belgium"]);
    expect(isComboboxLikeElement(input)).toBe(true);
    expect(readComboboxCommittedValue(input)).toBeNull();
  });

  test("resolves the committed value from the single-value display node", () => {
    const { input, commit } = buildWidget(["Austria", "Belgium"]);
    commit("Austria");
    expect(input.value).toBe(""); // the deceptive empty input
    expect(readComboboxCommittedValue(input)).toBe("Austria");
  });

  test("live input text wins while the user is still typing", () => {
    const { input } = buildWidget(["Austria"]);
    input.value = "Aus";
    expect(readComboboxCommittedValue(input)).toBe("Aus");
  });

  test("two widgets side by side never leak each other's value", () => {
    const a = buildWidget(["Austria"], { idSuffix: "a" });
    const b = buildWidget(["€ 50,000 - 60,000"], { idSuffix: "b" });
    a.commit("Austria");
    b.commit("€ 50,000 - 60,000");
    expect(readComboboxCommittedValue(a.input)).toBe("Austria");
    expect(readComboboxCommittedValue(b.input)).toBe("€ 50,000 - 60,000");
  });
});

describe("snapshot attributes for a committed combobox", () => {
  test("extractAttributes surfaces selected/value instead of an empty input", () => {
    const { input, commit } = buildWidget(["Austria"]);
    commit("Austria");
    const attrs = extractAttributes(input);
    expect(attrs["selected"]).toBe("Austria");
    expect(attrs["value"]).toBe("Austria");
  });
});

describe("read_element + extract_form_state see the committed value", () => {
  test("read_element(value) returns the committed value (Phase-8 dry-run tie-in)", async () => {
    const { input, commit } = buildWidget(["€ 50,000 - 60,000"]);
    commit("€ 50,000 - 60,000");
    const tag = tagOf(input);
    const read = await executeAction(ToolName.READ_ELEMENT, {
      id: tag,
      attribute: "value",
    });
    expect(read.success).toBe(true);
    expect(read.result).toContain("€ 50,000 - 60,000");
  });

  test("extract_form_state captures the combobox value, not an empty string", async () => {
    const { commit } = buildWidget(["Austria"]);
    commit("Austria");
    resetStableIds();
    tagElements();
    const res = await executeAction(ToolName.EXTRACT_FORM_STATE, {});
    expect(res.success).toBe(true);
    expect(res.result).toContain("Austria");
  });
});

describe("executeClick on a listbox option echoes the commit", () => {
  test("click result reports the committed value", async () => {
    const { input } = buildWidget(["Austria", "Belgium"], { interactive: true });
    // Open the menu the way the agent would.
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const option = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((o) => o.textContent === "Austria")!;
    const tag = tagOf(option);
    const res = await executeAction(ToolName.CLICK_ELEMENT, { id: tag });
    expect(res.success).toBe(true);
    expect(res.result).toContain('selection committed: field now shows "Austria"');
  });
});

describe("select_option custom-combobox branch", () => {
  test("one-shot open → pick → verify commit", async () => {
    const { input } = buildWidget(
      ["€ 40,000 - 50,000", "€ 50,000 - 60,000", "€ 60,000 - 70,000"],
      { interactive: true },
    );
    const tag = tagOf(input);
    const res = await executeAction(ToolName.SELECT_OPTION, {
      id: tag,
      value: "€ 50,000 - 60,000",
    });
    expect(res.success).toBe(true);
    expect(res.result).toContain('field now shows "€ 50,000 - 60,000"');
    expect(readComboboxCommittedValue(input)).toBe("€ 50,000 - 60,000");
  });

  test("no matching option → lists the visible options, stays open", async () => {
    const { input } = buildWidget(["Austria", "Belgium"], { interactive: true });
    const tag = tagOf(input);
    const res = await executeAction(ToolName.SELECT_OPTION, {
      id: tag,
      value: "Wonderland",
    });
    expect(res.success).toBe(false);
    expect(res.result).toContain('No option matching "Wonderland"');
    expect(res.result).toContain('"Austria"');
  });

  test("menu that never opens → precise failure, no crash", async () => {
    const { input } = buildWidget(["Austria"]); // non-interactive: nothing opens
    const tag = tagOf(input);
    const res = await executeAction(ToolName.SELECT_OPTION, {
      id: tag,
      value: "Austria",
    });
    expect(res.success).toBe(false);
    expect(res.result).toContain("did not open");
  }, 15_000);

  test("native <select> path is unchanged", async () => {
    document.body.innerHTML = `
      <select id="native"><option value="a">Alpha</option><option value="b">Beta</option></select>`;
    const select = document.getElementById("native") as HTMLSelectElement;
    const tag = tagOf(select);
    const res = await executeAction(ToolName.SELECT_OPTION, {
      id: tag,
      value: "Beta",
    });
    expect(res.success).toBe(true);
    expect(res.result).toContain('Selected "Beta"');
    expect(select.value).toBe("b");
  });
});
