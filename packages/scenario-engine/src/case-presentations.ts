import type { JsonObject } from "@opensidebar/scenario-contracts";

interface PerceptionPresentation {
  evidence: JsonObject[];
  presentation: JsonObject;
}

const PRESENTATIONS: Record<string, PerceptionPresentation> = {
  "read-visual-stock-badge": {
    evidence: [
      { label: "Product", value: "Alpine Shell" },
      { label: "Available colors", value: "3 color options" },
    ],
    presentation: {
      kind: "stock-badges",
      visualCue: "The low-stock count is printed inside the color-specific stock badge.",
      distractors: ["A general low-stock banner", "Other colors with ordinary availability"],
      items: [
        { label: "Navy", badge: "In stock", tone: "neutral" },
        { label: "Ochre", badge: "Only 2 left", tone: "warning" },
        { label: "Moss", badge: "6 available", tone: "neutral" },
      ],
    },
  },
  "read-scanned-sku": {
    evidence: [
      { label: "Inventory area", value: "Displays" },
      { label: "Requested product", value: "27-inch monitor" },
    ],
    presentation: {
      kind: "inventory-labels",
      visualCue: "The requested SKU is small print beside the yellow low-stock badge.",
      distractors: ["A 24-inch monitor label", "A green in-stock badge"],
      items: [
        { label: "24-inch office monitor", code: "MON-24-FHD", badge: "In stock", tone: "success" },
        { label: "27-inch monitor", code: "MON-27-QHD", badge: "Low stock", tone: "warning" },
        { label: "32-inch display", code: "MON-32-UHD", badge: "Back order", tone: "neutral" },
      ],
    },
  },
  "read-severity-icon": {
    evidence: [
      { label: "Queue", value: "Open tickets" },
      { label: "Sort", value: "Recently updated" },
    ],
    presentation: {
      kind: "severity-list",
      visualCue: "Severity is encoded by the colored shape next to each ticket number.",
      distractors: ["An amber diamond", "A red circular status marker"],
      items: [
        { label: "T-4318", detail: "Login delays", shape: "diamond", tone: "warning" },
        { label: "T-4322", detail: "Checkout unavailable", shape: "diamond", tone: "danger" },
        { label: "T-4325", detail: "Billing question", shape: "circle", tone: "danger" },
      ],
    },
  },
  "read-unread-marker": {
    evidence: [
      { label: "Workspace", value: "Engineering" },
      { label: "Channel order", value: "Favorites first" },
    ],
    presentation: {
      kind: "channel-list",
      visualCue: "A small purple dot marks the unread channel; its message preview supplies the topic.",
      distractors: ["A gray presence dot", "A purple emoji in another preview"],
      items: [
        { label: "#launch", detail: "Priya: Release notes are ready", tone: "muted" },
        { label: "#migration", detail: "Marco: Database cutover starts at 18:00", tone: "accent" },
        { label: "#design", detail: "Ana: Purple heart 💜 on the new mockup", tone: "muted" },
      ],
    },
  },
  "read-clipped-cell": {
    evidence: [
      { label: "Table", value: "Renewal contracts" },
      { label: "Requested row", value: "Meridian" },
    ],
    presentation: {
      kind: "clipped-table",
      visualCue: "The contract cell is clipped; hovering or focusing the cell reveals its full value.",
      distractors: ["A similar contract in the adjacent row", "The visible truncated prefix"],
      items: [
        { label: "Mariner", code: "CTR-2026-0198" },
        { label: "Meridian", code: "CTR-2026-0918", clipped: true },
        { label: "Merit", code: "CTR-2026-0913" },
      ],
    },
  },
  "read-small-chart-label": {
    evidence: [
      { label: "Chart", value: "Weekly qualified leads" },
      { label: "Series", value: "Current quarter" },
    ],
    presentation: {
      kind: "bar-chart",
      visualCue: "Each narrow bar has a small value label printed immediately above it.",
      distractors: ["The Week 5 value", "The orange target line label"],
      items: [
        { label: "Week 4", value: 42, tone: "muted" },
        { label: "Week 5", value: 31, tone: "muted" },
        { label: "Week 6", value: 37, tone: "warning" },
        { label: "Week 7", value: 45, tone: "muted" },
      ],
    },
  },
  "inspect-canvas-tooltip": {
    evidence: [
      { label: "Chart", value: "Campaign cost per acquisition" },
      { label: "Interaction", value: "Hover over a bar for its exact value" },
    ],
    presentation: {
      kind: "tooltip-chart",
      visualCue: "The campaign name and exact CPA appear only in the bar tooltip.",
      distractors: ["The tallest-impression campaign", "A nearby $28 axis tick"],
      items: [
        { label: "Beacon", value: "$54", height: 54 },
        { label: "Aurora", value: "$82", height: 82 },
        { label: "Cascade", value: "$61", height: 61 },
      ],
    },
  },
  "read-footnote-source": {
    evidence: [
      { label: "Article", value: "The quiet gains of workflow automation" },
      { label: "Reading mode", value: "Footnotes expanded" },
    ],
    presentation: {
      kind: "footnote",
      visualCue: "A superscript 2 in the article maps to the second entry in the footnote block.",
      distractors: ["Footnote 1", "A publication name in the article body"],
      items: [
        { label: "Article excerpt", detail: "Teams reported fewer handoff delays after automating routine routing.²" },
        { label: "1", detail: "Workflow Journal 2024" },
        { label: "2", detail: "Operations Review 2025" },
        { label: "3", detail: "Systems Quarterly 2025" },
      ],
    },
  },
  "read-scanned-document": {
    evidence: [
      { label: "Document", value: "Retention policy — scanned copy" },
      { label: "Page", value: "4 of 4" },
    ],
    presentation: {
      kind: "document-scan",
      visualCue: "The exception is printed in the shaded note at the bottom of the scan.",
      distractors: ["The seven-year default in the body", "A footer marked Legal"],
      items: [
        { label: "Policy", detail: "Records are retained for seven years after account closure." },
        { label: "Shaded note", detail: "Exception: legal holds remain in effect until formally released." },
        { label: "Footer", detail: "Legal · Revision 4" },
      ],
    },
  },
  "detect-visual-state-change": {
    evidence: [
      { label: "Monitor", value: "Release service" },
      { label: "Previous state", value: "Standby" },
    ],
    presentation: {
      kind: "status-tile",
      visualCue: "The monitored tile is green and reads Live after changing from gray Standby.",
      distractors: ["A green connectivity icon", "A neighboring tile still marked Standby"],
      items: [
        { label: "Release service", detail: "Live", tone: "success" },
        { label: "Archive worker", detail: "Standby", tone: "muted" },
        { label: "Connectivity", detail: "Connected", tone: "success" },
      ],
    },
  },
};

export function perceptionPresentation(slug: string): PerceptionPresentation | undefined {
  const presentation = PRESENTATIONS[slug];
  if (!presentation) return undefined;
  return {
    evidence: presentation.evidence.map((entry) => ({ ...entry })),
    presentation: { ...presentation.presentation },
  };
}
