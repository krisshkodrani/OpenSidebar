import { describe, expect, test } from "vitest";
import "../setup";

import { assessRepeatedAddItemClick } from "../../src/background/agent/repeated-add-item-policy";
import type { DomSnapshot, TaggedElement } from "../../src/types";
import { ToolName } from "../../src/types";

function element(overrides: Partial<TaggedElement>): TaggedElement {
  return {
    tag: 1,
    tagName: "button",
    role: "button",
    text: "",
    attributes: {},
    rect: { x: 0, y: 0, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  } as TaggedElement;
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: "https://shop.example.test",
    title: "Shop",
    elements: [],
    visibleContent: "",
    pageContent: "",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  } as DomSnapshot;
}

describe("assessRepeatedAddItemClick", () => {
  test("blocks an add-to-cart click when the item is already in the cart", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 60 },
      userRequest:
        "I'd like to order the Pegasus 41 shoes and the Novablast 4 shoes.",
      snapshot: snapshot({
        visibleContent: [
          "Products",
          "Add Novablast 4 to cart",
          "Your Cart",
          "Air Zoom Pegasus 41 Qty 1 Remove",
          "Novablast 4 Qty 1 Remove",
          "Checkout",
          "Place Order",
        ].join("\n"),
        elements: [element({ tag: 60, text: "Add Novablast 4 to cart" })],
      }),
    });

    expect(result).toContain("BLOCKED");
    expect(result).toContain("Novablast 4");
    expect(result).toContain("Re-read");
  });

  test("does not block an add-to-cart click when the cart lacks the item", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 60 },
      userRequest:
        "I'd like to order the Pegasus 41 shoes and the Novablast 4 shoes.",
      snapshot: snapshot({
        visibleContent: [
          "Products",
          "Add Novablast 4 to cart",
          "Your Cart",
          "Air Zoom Pegasus 41 Qty 1 Remove",
          "Checkout",
        ].join("\n"),
        elements: [element({ tag: 60, text: "Add Novablast 4 to cart" })],
      }),
    });

    expect(result).toBeNull();
  });

  test("does not block non-add controls in the cart", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 54 },
      snapshot: snapshot({
        visibleContent: "Your Cart\nNovablast 4 Qty 1 Remove\nCheckout",
        elements: [element({ tag: 54, text: "Close Cart" })],
      }),
    });

    expect(result).toBeNull();
  });

  test("does not block when the item appears only in a product grid", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 60 },
      snapshot: snapshot({
        visibleContent: [
          "Featured products",
          "Novablast 4",
          "$140.00",
          "Add Novablast 4 to cart",
        ].join("\n"),
        elements: [element({ tag: 60, text: "Add Novablast 4 to cart" })],
      }),
    });

    expect(result).toBeNull();
  });


  test("does not block when the user explicitly asks for multiple of the same item", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 60 },
      userRequest: "Please add two pairs of Novablast shoes to the cart.",
      snapshot: snapshot({
        visibleContent: "Your Cart\nNovablast 4 Qty 1 Remove\nCheckout",
        elements: [element({ tag: 60, text: "Add Novablast 4 to cart" })],
      }),
    });

    expect(result).toBeNull();
  });
  test("uses accessible labels when button text is minimal", () => {
    const result = assessRepeatedAddItemClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: "60" },
      snapshot: snapshot({
        visibleContent: "Shopping cart\nNovablast 4 Quantity 1 Remove\nCheckout",
        elements: [
          element({
            tag: 60,
            text: "Add",
            attributes: { "aria-label": "Add Novablast 4 to cart" },
          }),
        ],
      }),
    });

    expect(result).toContain("BLOCKED");
    expect(result).toContain("Novablast 4");
  });
});