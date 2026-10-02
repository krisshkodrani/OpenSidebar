import { describe, expect, test } from "vitest";
import "../setup";
import {
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

function snapshot(visibleContent: string): DomSnapshot {
  return {
    title: "Your Cart",
    url: "https://shop.example/cart",
    visibleContent,
    pageContent: visibleContent,
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
  };
}

describe("cart removal completion", () => {
  test("accepts a claimed removal when the cart is visibly empty", () => {
    const current = snapshot("Your cart is empty. Promo Code Shipping");
    const generated = generateCompletionContract({
      userRequest: "Remove the Novablast 4 from the cart.",
      activeObjective: "Remove the Novablast 4 from the cart",
      successCriteria: "Cart is empty and Novablast 4 is no longer listed",
      snapshot: current,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: current,
      candidateSource: "model_done",
      summary: "Removed Novablast 4 from the cart.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept removal while the cart still lists an item", () => {
    const current = snapshot("Your Cart Novablast 4 Remove");
    const generated = generateCompletionContract({
      userRequest: "Remove the Novablast 4 from the cart.",
      snapshot: current,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: current,
      candidateSource: "model_done",
      summary: "Removed Novablast 4 from the cart.",
    });

    expect(decision.status).not.toBe("accepted");
  });
});

describe("cart addition completion", () => {
  const request = "Order the Pegasus 41 and Novablast 4 shoes.";
  const activeObjective =
    "On the shop page, locate the Pegasus 41 shoes product and add them to the cart.";
  const successCriteria =
    "Cart counter increments or add-to-cart confirmation for Pegasus 41 visible";

  test("accepts a named item visibly added to the cart", () => {
    const current = snapshot(
      "Your Cart Cart: 1 Air Zoom Pegasus 41 Size 10 Unit $149 Quantity 1 Subtotal $149",
    );
    const generated = generateCompletionContract({
      userRequest: request,
      activeObjective,
      successCriteria,
      snapshot: current,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [{
        type: "confirmation_state",
        confidence: "medium",
        logicalKey: "workflow:confirmation:create",
        observedAtTurn: 1,
        detail: { action: "create", source: "visible_text", text: current.visibleContent },
      }],
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pegasus 41 is in the cart.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Pegasus 41 shoes product",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept a different item in the cart", () => {
    const current = snapshot(
      "Your Cart Cart: 1 Novablast 4 Size 10 Unit $140 Quantity 1 Subtotal $140",
    );
    const generated = generateCompletionContract({
      userRequest: request,
      activeObjective,
      successCriteria,
      snapshot: current,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [{
        type: "confirmation_state",
        confidence: "medium",
        logicalKey: "workflow:confirmation:create",
        observedAtTurn: 1,
        detail: { action: "create", source: "visible_text", text: current.visibleContent },
      }],
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pegasus 41 is in the cart.",
    });

    expect(decision.status).not.toBe("accepted");
  });
});
