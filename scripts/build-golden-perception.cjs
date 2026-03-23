/**
 * Generate human-verified golden perception eval cases from E2E trace data.
 * Each case has hand-written expected values based on visual inspection of
 * screenshots + element lists by a human reviewer (Claude Opus 4.6).
 *
 * Run: node scripts/build-golden-perception.js
 */
const fs = require("fs");
const path = require("path");

const GOLDEN_DIR = "evals/golden/perception";

function extractTraceData(traceFile, turnNumber) {
  const lines = fs.readFileSync(traceFile, "utf8").trim().split("\n");
  for (const l of lines) {
    const e = JSON.parse(l);
    if (e.turnNumber === turnNumber) {
      const sessionId = traceFile.match(/([a-f0-9-]{36})/)?.[1] || "";
      const ssFile = path.join(
        "traces/screenshots",
        sessionId + "-T" + turnNumber + ".jpg",
      );
      const ssData = fs.existsSync(ssFile)
        ? "data:image/jpeg;base64," + fs.readFileSync(ssFile).toString("base64")
        : null;
      return {
        sessionId,
        elements: e.elements || [],
        snapshot: e.snapshot || {},
        perception: e.perception || {},
        screenshotDataUrl: ssData,
      };
    }
  }
  return null;
}

function buildCase(id, traceFile, turn, expected, metadata) {
  const data = extractTraceData(traceFile, turn);
  if (!data) {
    console.error("No data for", id);
    return;
  }

  const c = {
    id,
    sourceSessionId: data.sessionId,
    sourceTurn: turn,
    input: {
      screenshotDataUrl: data.screenshotDataUrl,
      elements: data.elements,
      url: data.snapshot.url,
      title: data.snapshot.title,
      scroll: { y: data.snapshot.scrollY || 0, maxY: 0 },
    },
    expected,
    reference: {
      interpretation: data.perception.interpretation || "",
      model: data.perception.model || "x-ai/grok-4.1-fast",
      providerId: "openrouter",
      durationMs: data.perception.durationMs || 0,
    },
    metadata,
  };

  const outFile = path.join(GOLDEN_DIR, id + ".json");
  fs.writeFileSync(outFile, JSON.stringify(c, null, 2));
  const sizeKB = Math.round(JSON.stringify(c).length / 1024);
  console.log("Wrote", outFile, "(" + sizeKB + "KB)");
}

// ─── Case 1: Support Dashboard ────────────────────────────────────
buildCase(
  "e2e-support-dashboard-t2",
  "traces/ee96e23b-a96a-431e-b91e-632aa50e243a.jsonl",
  2,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [],
    mustMentionElements: [],
    visualOnlyContent: [
      "Open Tickets 47",
      "Avg Resolution Time 4.2 hours",
      "Satisfaction Score 92%",
      "Top Issue Billing Inquiries",
      "Recent Tickets table with 3 rows",
    ],
  },
  {
    url: "dashboard-support",
    query: "Read metrics from support dashboard",
    difficulty: "easy",
    tags: ["perception", "dashboard", "visual-only", "e2e-derived"],
    dimension: "visual_only",
    notes:
      "Static dashboard with metric cards and ticket table. All data is visual-only (no interactive elements besides nav links).",
  },
);

// ─── Case 2: Sales Dashboard ──────────────────────────────────────
buildCase(
  "e2e-sales-dashboard-t6",
  "traces/ee96e23b-a96a-431e-b91e-632aa50e243a.jsonl",
  6,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [],
    mustMentionElements: [],
    visualOnlyContent: [
      "Total Revenue $284,500",
      "Orders This Month 1,423",
      "Top Product Wireless Pro Headphones",
      "Conversion Rate 3.8%",
      "Top Products table with 3 rows",
    ],
  },
  {
    url: "dashboard-sales",
    query: "Read metrics from sales dashboard",
    difficulty: "easy",
    tags: ["perception", "dashboard", "visual-only", "e2e-derived"],
    dimension: "visual_only",
    notes:
      "Static dashboard with revenue/order cards and product table. All data is visual-only.",
  },
);

// ─── Case 3: TechDirect Store Catalog ─────────────────────────────
buildCase(
  "e2e-techdirect-catalog-t5",
  "traces/7b5e2b75-e2cd-4686-96a1-5140701a81f5.jsonl",
  5,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [],
    mustMentionElements: [15, 16, 17, 18],
    visualOnlyContent: [
      "Ergonomic Keyboard $79.99",
      "Mechanical Keyboard $129.99",
      "USB-C Monitor Cable $12.99",
      "HDMI Cable 6ft $9.99",
      "Wireless Mouse $34.99 Out of stock",
    ],
  },
  {
    url: "procurement?store=techdirect",
    query: "Browse TechDirect store products",
    difficulty: "easy",
    tags: ["perception", "store", "affordances", "e2e-derived"],
    dimension: "affordances",
    notes:
      "Product listing with 4 Add to Cart buttons and 1 out-of-stock item. Prices are visual-only.",
  },
);

// ─── Case 4: TechDirect Order Confirmation ────────────────────────
buildCase(
  "e2e-techdirect-confirmed-t7",
  "traces/7b5e2b75-e2cd-4686-96a1-5140701a81f5.jsonl",
  7,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [],
    mustMentionElements: [],
    visualOnlyContent: [
      "Order Confirmed",
      "Order number ORD-MN39OMOH",
      "Items Ergonomic Keyboard x2",
      "Total $159.98",
    ],
  },
  {
    url: "procurement?store=techdirect",
    query: "Verify order confirmation",
    difficulty: "easy",
    tags: ["perception", "confirmation", "visual-only", "e2e-derived"],
    dimension: "visual_only",
    notes:
      "Order confirmation page with green success banner. No interactive elements besides nav. Order number and items are visual-only.",
  },
);

// ─── Case 5: Procurement List ─────────────────────────────────────
buildCase(
  "e2e-procurement-list-t10",
  "traces/7b5e2b75-e2cd-4686-96a1-5140701a81f5.jsonl",
  10,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [],
    mustMentionElements: [1, 2, 3, 18],
    visualOnlyContent: [
      "0 of 3 items completed",
      "Ergonomic Keyboard qty 2 budget $89",
      "Standing Desk Mat qty 1 budget $45",
      "USB-C Monitor Cable qty 5 budget $15",
    ],
  },
  {
    url: "procurement",
    query: "Process procurement list across tabs",
    difficulty: "medium",
    tags: ["perception", "checklist", "affordances", "e2e-derived"],
    dimension: "affordances",
    notes:
      "Procurement table with 3 checkboxes, 2 store links (TechDirect, OfficeHub). Progress counter and item details are visual-only.",
  },
);

// ─── Case 6: Shop Cart/Checkout ───────────────────────────────────
buildCase(
  "e2e-shop-cart-checkout-t2",
  "traces/0894eab5-967c-4c1b-9109-1ddb8c323a88.jsonl",
  2,
  {
    requiredSections: [
      "LOCATION",
      "CHANGES",
      "BLOCKERS",
      "VISUAL-ONLY",
      "AFFORDANCES",
    ],
    blockers: [
      {
        type: "prereq",
        description: "Fill Full name and Email address before Place Order",
      },
    ],
    mustMentionElements: [40, 41, 42, 47, 38, 39],
    visualOnlyContent: [
      "Air Zoom Pegasus 41 Size 10 black $149",
      "Novablast 4 Size 10 black $140",
      "Cart 2 items",
    ],
  },
  {
    url: "shop",
    query: "Complete checkout with name and email",
    difficulty: "hard",
    tags: ["perception", "checkout", "blockers", "affordances", "e2e-derived"],
    dimension: "blockers",
    notes:
      "Cart sidebar open with 2 items, promo code input, shipping radio buttons, checkout form requiring name+email. PREREQ blocker on empty checkout fields.",
  },
);

console.log("\nDone! 6 human-verified golden cases written.");
