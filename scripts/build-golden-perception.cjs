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

const SECTIONS = ["LOCATION", "CHANGES", "BLOCKERS", "VISUAL-ONLY", "AFFORDANCES"];

// ─── Case 1: Support Dashboard (metrics + tickets table) ─────────
buildCase(
  "e2e-support-dashboard",
  "traces/53651d7f-6a93-49a8-9c45-82b315128389.jsonl", 2,
  { requiredSections: SECTIONS, blockers: [], mustMentionElements: [],
    visualOnlyContent: [
      "Open Tickets 47", "Avg Resolution Time 4.2 hours",
      "Satisfaction Score 92%", "Top Issue Billing Inquiries",
      "Recent Tickets table 3 rows",
    ] },
  { url: "dashboard-support", query: "Read support metrics", difficulty: "easy",
    tags: ["perception", "dashboard", "visual-only", "e2e-derived"], dimension: "visual_only",
    notes: "Static dashboard. Metric cards + ticket table. All data visual-only." },
);

// ─── Case 2: Marketing Dashboard (campaigns table) ───────────────
buildCase(
  "e2e-marketing-dashboard",
  "traces/6a4d0720-9e9f-475a-a055-557ce550d259.jsonl", 7,
  { requiredSections: SECTIONS, blockers: [], mustMentionElements: [],
    visualOnlyContent: [
      "Active Campaigns", "Click-Through Rate",
      "Ad Spend", "Top Channel",
    ] },
  { url: "dashboard-marketing", query: "Read marketing metrics", difficulty: "easy",
    tags: ["perception", "dashboard", "visual-only", "e2e-derived"], dimension: "visual_only",
    notes: "Static marketing dashboard. Metric cards + campaign table." },
);

// ─── Case 3: TechDirect Store Catalog ────────────────────────────
buildCase(
  "e2e-techdirect-catalog",
  "traces/6efe9456-d96f-4cd0-a7a0-20c80916cf5c.jsonl", 5,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [1, 2, 3, 18, 20],
    visualOnlyContent: [
      "Ergonomic Keyboard $79.99", "Mechanical Keyboard $129.99",
      "USB-C Monitor Cable $12.99", "HDMI Cable 6ft $9.99",
      "Wireless Mouse $34.99 Out of stock",
    ] },
  { url: "procurement", query: "Browse procurement list and store links", difficulty: "easy",
    tags: ["perception", "store", "affordances", "e2e-derived"], dimension: "affordances",
    notes: "Procurement list with 3 checkboxes [1-3], store links [18-20]. Product prices are visual-only." },
);

// ─── Case 4: Multi-Step Form (Step 1 with filled fields) ────────
buildCase(
  "e2e-form-step1",
  "traces/cfce00bc-0290-4820-8f27-d780fe7a9ec6.jsonl", 1,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [1, 2, 3, 18],
    visualOnlyContent: [
      "Step 1 Personal Information", "Step indicator 1 of 3",
    ] },
  { url: "form", query: "Fill multi-step form", difficulty: "easy",
    tags: ["perception", "form", "affordances", "e2e-derived"], dimension: "affordances",
    notes: "Multi-step wizard Step 1. Three text inputs [1-3] (name, email, phone) + Next button [18]. Step indicator visual-only." },
);

// ─── Case 5: Scroll Catalog (products with View Details) ────────
buildCase(
  "e2e-scroll-catalog",
  "traces/90552b02-dbba-4436-a00f-08e94eeb5215.jsonl", 1,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [15, 16],
    visualOnlyContent: [
      "Wireless Mouse $29.99", "Mechanical Keyboard $89.99",
      "USB-C Hub $49.99", "Monitor Stand $39.99",
    ] },
  { url: "scroll-catalog", query: "Find Thunderbolt Dock Pro below fold", difficulty: "medium",
    tags: ["perception", "catalog", "affordances", "e2e-derived"], dimension: "affordances",
    notes: "Long product list. First items visible with View Details buttons [15-16]. Target product below fold." },
);

// ─── Case 6: Dynamic Compute (configurator with computed price) ──
buildCase(
  "e2e-dynamic-compute",
  "traces/ff290be7-4690-4d30-983d-2a8237b273f0.jsonl", 1,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [1, 2, 3],
    visualOnlyContent: [
      "Premium Water Bottle", "$112.50",
      "large / black / engraved",
    ] },
  { url: "dynamic-compute", query: "Configure product and read computed price", difficulty: "easy",
    tags: ["perception", "configurator", "visual-only", "e2e-derived"], dimension: "visual_only",
    notes: "Product configurator with Size select [1], Color select [2], Engraving checkbox [3]. Computed price $112.50 is visual-only." },
);

// ─── Case 7: Shop Cart/Checkout (PREREQ on empty form fields) ───
buildCase(
  "e2e-shop-checkout",
  "traces/12f8c42f-5c52-47b2-bc0b-2d96ed0d1cd3.jsonl", 1,
  { requiredSections: SECTIONS,
    blockers: [
      { type: "prereq", description: "Fill Full name and Email address before Place Order" },
    ],
    mustMentionElements: [19, 20, 24, 26],
    visualOnlyContent: [
      "Promo Code input", "Standard Free shipping selected",
      "Checkout section with empty Full name and Email fields",
    ] },
  { url: "shop", query: "Complete checkout", difficulty: "hard",
    tags: ["perception", "checkout", "blockers", "affordances", "e2e-derived"], dimension: "blockers",
    notes: "Cart sidebar with promo code, shipping radios, empty checkout form. PREREQ on name+email." },
);

// ─── Case 8: Summarize Page (read-only article) ─────────────────
buildCase(
  "e2e-summarize-article",
  "traces/861d5b27-6178-4d57-8bfa-c5a3aded9c0d.jsonl", 1,
  { requiredSections: SECTIONS, blockers: [], mustMentionElements: [],
    visualOnlyContent: [
      "Understanding Transformer Architecture in Modern AI",
      "The Attention Mechanism", "Encoder-Decoder Structure",
      "Positional Encoding",
    ] },
  { url: "summarize", query: "Summarize this page", difficulty: "easy",
    tags: ["perception", "article", "visual-only", "e2e-derived"], dimension: "visual_only",
    notes: "Static article page. Headings and content are visual-only (no interactive elements besides nav)." },
);

// ─── Case 9: Navigation Challenge Complete (success state) ──────
buildCase(
  "e2e-navigation-complete",
  "traces/c6ff039d-45bd-429f-ba95-1fdd9f6c533f.jsonl", 3,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [16, 17],
    visualOnlyContent: [
      "Step counter 4/3", "Challenge Complete",
    ] },
  { url: "navigation", query: "Complete navigation challenge", difficulty: "easy",
    tags: ["perception", "challenge", "affordances", "e2e-derived"], dimension: "affordances",
    notes: "Navigation challenge completed. Green banner visible. Code input [16] and Submit [17] still present." },
);

// ─── Case 10: Error Scenarios (form with success + delayed content) ─
buildCase(
  "e2e-error-scenarios",
  "traces/5abfd044-ba8b-4da1-9eea-4241abbeda85.jsonl", 1,
  { requiredSections: SECTIONS, blockers: [],
    mustMentionElements: [],
    visualOnlyContent: [
      "Contact Form with email and message fields",
      "Message sent successfully",
      "Delayed Content section with Load Content button",
      "Impossible Task section",
    ] },
  { url: "errors", query: "Fill contact form", difficulty: "easy",
    tags: ["perception", "error-recovery", "visual-only", "e2e-derived"], dimension: "visual_only",
    notes: "Error scenarios page. Contact form (filled, success message visible), Delayed Content section, Impossible Task section." },
);

console.log("\nDone! 10 human-verified golden cases written.");
