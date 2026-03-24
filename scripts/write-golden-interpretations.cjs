/**
 * Write human-verified golden perception interpretations.
 * Each interpretation is written by Claude Opus 4.6 based on visual inspection
 * of the screenshot + cross-referencing the element list.
 *
 * Run: node scripts/write-golden-interpretations.cjs
 */
const fs = require("fs");
const path = require("path");

const GOLDEN_DIR = "evals/golden/perception";

const goldenInterpretations = {
  "e2e-support-dashboard": [
    "1. LOCATION: Support Dashboard at /dashboard-support. Support tab active in top nav.",
    "2. CHANGES: First observation. Dark top nav bar with fixture links. Four metric cards center. Recent Tickets table below.",
    "3. BLOCKERS: None.",
    '4. VISUAL-ONLY: Open Tickets 47 (-12% from last week). Avg Resolution Time 4.2 hours (-8% from last month). Satisfaction Score 92% (+3% from last quarter). Top Issue Billing Inquiries. Recent Tickets: #4521 "Payment not processed" Open High; #4520 "Shipping delay inquiry" In Progress Medium; #4519 "Return request" Resolved Low.',
    "5. AFFORDANCES: [9] Support link active top nav. [8] Sales link top nav. [10] Marketing link top nav.",
  ].join("\n"),

  "e2e-marketing-dashboard": [
    "1. LOCATION: Support Dashboard visible at /dashboard-marketing URL. Support tab active.",
    "2. CHANGES: First observation. Screenshot shows Support Dashboard content despite URL being /dashboard-marketing.",
    '3. BLOCKERS: MISMATCH "URL is /dashboard-marketing but screenshot shows Support Dashboard with ticket data".',
    "4. VISUAL-ONLY: Open Tickets 47. Avg Resolution Time 4.2 hours. Satisfaction Score 92%. Top Issue Billing Inquiries. Recent Tickets table with 3 rows.",
    "5. AFFORDANCES: [9] Support link active top nav. [10] Marketing link top nav. [8] Sales link top nav.",
  ].join("\n"),

  "e2e-techdirect-catalog": [
    "1. LOCATION: Procurement List page at /procurement. Procurement tab active blue.",
    "2. CHANGES: First observation. Top nav bar. Procurement table center with 3 items, checkboxes, and store links.",
    "3. BLOCKERS: None.",
    "4. VISUAL-ONLY: 0 of 3 items completed. Table: Ergonomic Keyboard / TechDirect / qty 2 / budget $89. Standing Desk Mat / OfficeHub / qty 1 / budget $45. USB-C Monitor Cable / TechDirect / qty 5 / budget $15.",
    "5. AFFORDANCES: [1] checkbox Mark Ergonomic Keyboard as done. [2] checkbox Mark Standing Desk Mat as done. [3] checkbox Mark USB-C Monitor Cable as done. [18] Open TechDirect link. [20] Open OfficeHub link. [17] Procurement tab active.",
  ].join("\n"),

  "e2e-form-step1": [
    "1. LOCATION: Multi-Step Form page at /form. Step 1: Personal Information. Form tab active.",
    "2. CHANGES: First observation. Step indicator shows 1 of 3 (Personal Info, Preferences, Review). Three input fields with pre-filled values. Next button below.",
    "3. BLOCKERS: None.",
    '4. VISUAL-ONLY: Step 1 of 3. Step indicator circles: 1 active blue, 2 gray, 3 gray. Labels: Personal Info, Preferences, Review. Fields show: "Jane Smith", "jane@example.com", "555-0123".',
    "5. AFFORDANCES: [1] Full Name input pre-filled. [2] Email input pre-filled. [3] Phone input pre-filled. [18] Next button blue below fields.",
  ].join("\n"),

  "e2e-scroll-catalog": [
    "1. LOCATION: Office Equipment Catalog at /scroll-catalog. Scroll tab active.",
    "2. CHANGES: First observation. Long product list visible. Items stacked vertically with View Details buttons.",
    "3. BLOCKERS: None.",
    "4. VISUAL-ONLY: Wireless Mouse Accessories $29.99. Mechanical Keyboard Accessories $89.99. USB-C Hub Accessories $49.99. Monitor Stand Furniture $39.99. Webcam HD Electronics $59.99. Desk Lamp Furniture $34.99. Cable Organizer Accessories $12.99. Laptop Riser Furniture $44.99. More items below fold.",
    "5. AFFORDANCES: [15] View Details button first product. [16] View Details button second product. [17] View Specs button. [11] Scroll tab active top nav.",
  ].join("\n"),

  "e2e-dynamic-compute": [
    "1. LOCATION: Custom Product Configurator at /dynamic-compute. Compute tab active.",
    "2. CHANGES: First observation. Product card center with Premium Water Bottle heading. Size and Color dropdowns, engraving checkbox. Computed price displayed.",
    "3. BLOCKERS: None.",
    "4. VISUAL-ONLY: Premium Water Bottle. Size: Large (32 oz) selected. Color: Matte Black selected. Add custom engraving (+$15) checked. Configuration: large / black / engraved. Price: $112.50.",
    "5. AFFORDANCES: [1] Size select dropdown (Large 32 oz). [2] Color select dropdown (Matte Black). [3] Engraving checkbox checked. [16] Compute tab active.",
  ].join("\n"),

  "e2e-shop-checkout": [
    "1. LOCATION: Northstar Outfitters shop at /shop. Cart sidebar open. Shop tab active.",
    "2. CHANGES: First observation. Cart sidebar visible right side showing promo code input, shipping options, checkout form. Product catalog behind.",
    '3. BLOCKERS: PREREQ "fill Full name and Email address inputs before Place Order button".',
    "4. VISUAL-ONLY: Promo Code section: Enter code input, Apply button. Shipping: Standard (Free) selected, Express ($15) available. Checkout: empty Full name and Email address fields. Subtotal $58.00. Discount $0.00. Shipping $0.00. Total $58.00. Place Order button. Continue Shopping link.",
    "5. AFFORDANCES: [19] My Orders button top. [20] Open Cart button top. [24] Add Air Zoom Pegasus 41 to cart. [26] Add Novablast 4 to cart.",
  ].join("\n"),

  "e2e-summarize-article": [
    "1. LOCATION: Understanding Transformer Architecture in Modern AI at /summarize. Summarize tab active.",
    "2. CHANGES: First observation. Article page with heading and 3 numbered sections. Dark header bar. White content card center.",
    "3. BLOCKERS: None.",
    '4. VISUAL-ONLY: Article: "Understanding Transformer Architecture in Modern AI". 1. The Attention Mechanism — attention allows models to weigh importance of input parts, enables parallel processing. 2. Encoder-Decoder Structure — encoder processes input, decoder generates output. 3. Positional Encoding — positional encodings added to embeddings for sequence order. Test prompt: "Summarize this article in 2-3 sentences."',
    "5. AFFORDANCES: [1] Summarize tab active top nav. [2] Article link top nav.",
  ].join("\n"),

  "e2e-navigation-complete": [
    "1. LOCATION: Navigation Challenge at /navigation. Navigation tab active. Step counter 4/3.",
    '2. CHANGES: Challenge completed. Green "Challenge Complete!" banner visible center. Step counter shows 4/3 (beyond target).',
    "3. BLOCKERS: None.",
    '4. VISUAL-ONLY: Instruction: "Click the Advance button 3 times. A secret code will appear. Enter the code and submit it." Step counter: 4/3. Green banner: "Challenge Complete!"',
    '5. AFFORDANCES: [16] code input "Enter the secret code". [17] Submit Code button.',
  ].join("\n"),

  "e2e-error-scenarios": [
    "1. LOCATION: Error Scenarios page at /errors. Errors tab active. Subtitle: A page with intentionally tricky elements for testing agent error handling.",
    "2. CHANGES: First observation. Three sections stacked vertically: Contact Form (filled, success), Delayed Content, Impossible Task.",
    "3. BLOCKERS: None.",
    '4. VISUAL-ONLY: Contact Form: email "test@example.com", message filled, green "Message sent successfully!" text below Send Message button. Delayed Content section: "Click Load Content and wait for the result to appear" with blue Load Content button. Impossible Task section: "There is no Generate Report button on this page. The agent should recognize this and stop gracefully."',
    "5. AFFORDANCES: [7] Errors tab active top nav. [9] Form link top nav.",
  ].join("\n"),
};

// Update each golden case
let updated = 0;
for (const [id, interpretation] of Object.entries(goldenInterpretations)) {
  const filePath = path.join(GOLDEN_DIR, id + ".json");
  if (!fs.existsSync(filePath)) {
    console.error("Missing:", filePath);
    continue;
  }
  const c = JSON.parse(fs.readFileSync(filePath, "utf8"));
  c.reference.interpretation = interpretation;
  c.reference.model = "human-verified-opus-4.6";
  c.reference.providerId = "human";
  c.reference.durationMs = 0;
  fs.writeFileSync(filePath, JSON.stringify(c, null, 2));
  updated++;
  console.log("Updated", id, "(" + interpretation.length + " chars)");
}
console.log("\nDone! " + updated + " golden interpretations written.");
