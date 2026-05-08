import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import { assessCatalogOrderPostConfirmationClick } from "../../src/background/agent/catalog-order-policy";

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

describe("assessCatalogOrderPostConfirmationClick", () => {
  test("blocks request/item drill-ins from catalog order confirmation pages", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "catalog-order-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      snapshot: {
        title: "Order Status: REQ0024924 | ServiceNow",
        url: "https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/com.glideapp.servicecatalog_checkout_view_v2.do%3Fsysparm_sys_id%3Dabc",
        visibleContent: "Order Status REQ0024924 Quantity 10",
        elements: [link(7, "Lenovo - Carbon x1", "sc_req_item.do?sys_id=def")],
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
        title: "Standard Laptop | ServiceNow",
        url: "https://workarenapublic14.service-now.com/catalog_item.do",
        visibleContent: "Standard Laptop Add to Cart",
        elements: [link(7, "Add to Cart")],
      } as any,
    });

    expect(result).toBeNull();
  });

  test("allows non-catalog workflows to click links on matching pages", () => {
    const result = assessCatalogOrderPostConfirmationClick({
      selectedSkillId: "servicenow-module-navigation",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      snapshot: {
        title: "Order Status: REQ0024924 | ServiceNow",
        url: "https://workarenapublic14.service-now.com/now/nav/ui/classic/params/target/com.glideapp.servicecatalog_checkout_view_v2.do",
        visibleContent: "Order Status REQ0024924",
        elements: [link(7, "REQ0024924")],
      } as any,
    });

    expect(result).toBeNull();
  });
});
