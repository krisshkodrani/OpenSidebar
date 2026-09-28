import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  assessCatalogOrderConfigurationClick,
  assessCatalogOrderItemSelectionClick,
  assessCatalogOrderPostConfirmationClick,
} from "../../src/background/agent/catalog-order-policy";

function link(id: number, text: string, href = "#") {
  return {
    tag: id,
    tagName: "a",
    role: "link",
    text,
    attributes: { href },
    isVisible: true,
    isDisabled: false,
  };
}

function button(id: number, text: string, attributes: Record<string, string> = {}) {
  return {
    tag: id,
    tagName: "button",
    role: "button",
    text,
    attributes,
    isVisible: true,
    isDisabled: false,
  };
}

describe("assessCatalogOrderPostConfirmationClick", () => {
  test("blocks request/item drill-ins from catalog order confirmation pages", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      snapshot: {
        title: "Order Status: ORD0024924 | Shop",
        url: "https://shop.example.test/orders/confirmed",
        visibleContent: "Order Status ORD0024924 Quantity 10",
        elements: [link(7, "View item", "/orders/ORD0024218/items")],
      } as any,
    });

    expect(result).toContain("confirmation is already visible");
    expect(result).toContain("call done()");
  });

  test("blocks navigation away from catalog order confirmation pages", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 117 },
      snapshot: {
        title: "Order Status: ORD0024218 | Shop",
        url: "https://shop.example.test/orders/confirmed",
        visibleContent: "Order Status ORD0024218 Thank you, your request has been submitted",
        elements: [
          button(117, "Back to Catalog", {
            id: "back_to_catalog_header",
            "aria-label": "Back to Catalog",
          }),
        ],
      } as any,
    });

    expect(result).toContain("confirmation is already visible");
    expect(result).toContain("call done()");
  });

  test("blocks browser navigation after catalog order confirmation", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.GO_BACK,
      args: {},
      snapshot: {
        title: "Order Status: ORD0024218 | Shop",
        url: "https://shop.example.test/orders/confirmed",
        visibleContent: "Order Status ORD0024218 Thank you, your request has been submitted",
        elements: [],
      } as any,
    });

    expect(result).toContain("confirmation is already visible");
    expect(result).toContain("Do not navigate away");
  });

  test("blocks requested-item readback after catalog order confirmation", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.READ_ELEMENT,
      args: { id: 285, attribute: "href" },
      snapshot: {
        title: "Order Status: ORD0024218 | Shop",
        url: "https://shop.example.test/orders/confirmed",
        visibleContent: "Order Status ORD0024218 Thank you, your request has been submitted",
        elements: [link(285, "View item", "/orders/ORD0024218/items")],
      } as any,
    });

    expect(result).toContain("confirmation is already visible");
    expect(result).toContain("call done()");
  });

  test("allows catalog clicks before order confirmation", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      snapshot: {
        title: "Standard Laptop | Shop",
        url: "https://shop.example.test/products/standard-laptop",
        visibleContent: "Standard Laptop Add to Cart",
        elements: [link(7, "Add to Cart")],
      } as any,
    });

    expect(result).toBeNull();
  });

  test("allows non-catalog workflows to click links on matching pages", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "structured-form-fill",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      snapshot: {
        title: "Order Status: ORD0024924 | Shop",
        url: "https://shop.example.test/orders/confirmed",
        visibleContent: "Order Status ORD0024924",
        elements: [link(7, "ORD0024924")],
      } as any,
    });

    expect(result).toBeNull();
  });
});

describe("assessCatalogOrderConfigurationClick", () => {
  test("blocks manual option clicks when a catalog order has explicit configuration fields", () => {
    const result = assessCatalogOrderConfigurationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 9 },
      originalQuery:
        'Order 1 "Ergonomic Chair" with configuration {\'Fabric color\': \'Blue\'}',
      snapshot: {
        title: "Ergonomic Chair | Catalog",
        url: "https://shop.example.test/products/ergonomic-chair",
        visibleContent: "Ergonomic Chair Fabric color Blue Add to Cart",
        elements: [
          {
            tag: 9,
            tagName: "label",
            role: "",
            text: "Blue",
            attributes: { type: "radio", name: "color" },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(result).toContain("explicit configuration fields");
    expect(result).toContain("configure_catalog_item");
  });

  test("allows catalog navigation clicks before the item detail page", () => {
    const result = assessCatalogOrderConfigurationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 9 },
      originalQuery:
        'Order 1 "Ergonomic Chair" with configuration {\'Fabric color\': \'Blue\'}',
      snapshot: {
        title: "Catalog | Shop",
        url: "https://shop.example.test/catalog",
        visibleContent: "Office seating Ergonomic Chair",
        elements: [link(9, "Office seating")],
      } as any,
    });

    expect(result).toBeNull();
  });
});

describe("assessCatalogOrderItemSelectionClick", () => {
  test("blocks selecting a different catalog item when the requested item is visible", () => {
    const result = assessCatalogOrderItemSelectionClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 107 },
      originalQuery: 'Go to the office store and order 1 "Ergonomic Chair"',
      snapshot: {
        title: "Office Store",
        url: "https://example.test/catalog",
        visibleContent: "Ergonomic Chair Standing Desk",
        elements: [
          link(38, "Ergonomic Chair", "/products/ergonomic-chair"),
          link(107, "Standing Desk", "/products/standing-desk"),
        ],
      } as any,
    });

    expect(result).toContain('requested catalog item is "Ergonomic Chair"');
    expect(result).toContain("Standing Desk");
  });

  test("allows selecting the requested catalog item", () => {
    const result = assessCatalogOrderItemSelectionClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 38 },
      originalQuery: 'Go to the office store and order 1 "Ergonomic Chair"',
      snapshot: {
        title: "Office Store",
        url: "https://example.test/catalog",
        visibleContent: "Ergonomic Chair Standing Desk",
        elements: [
          link(38, "Ergonomic Chair", "/products/ergonomic-chair"),
          link(107, "Standing Desk", "/products/standing-desk"),
        ],
      } as any,
    });

    expect(result).toBeNull();
  });
});
