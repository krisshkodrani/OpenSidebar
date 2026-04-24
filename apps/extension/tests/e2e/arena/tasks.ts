export type ArenaTier = "easy" | "medium" | "hard";

export type ArenaValidatorKind =
  | "dom-state"
  | "final-answer"
  | "fixture-state"
  | "trace-diagnostic";

export interface ArenaTask {
  id: string;
  title: string;
  tier: ArenaTier;
  sourceFile: string;
  sourceCase: string;
  startRoute: string;
  prompt: string;
  maxTurns: number;
  tags: readonly string[];
  validator: string;
  validatorKind: ArenaValidatorKind;
  description: string;
  timeoutMs: number;
  allowNavigation?: boolean;
  notes?: string;
}

export const ARENA_TASKS: readonly ArenaTask[] = [
  {
    id: "support-ticket.triage-timeout-export",
    title: "Triage Support Ticket",
    tier: "easy",
    sourceFile: "support-ticket.test.ts",
    sourceCase: "reads ticket, changes status, and adds internal comment",
    startRoute: "/support-ticket",
    prompt:
      "Set ticket TICKET-4271 to In Progress and add an internal note summarizing the issue and next steps.",
    maxTurns: 20,
    timeoutMs: 240_000,
    tags: ["record-update", "form", "workarena-like", "support"],
    validator: "supportTicketTriaged",
    validatorKind: "fixture-state",
    description:
      "Reads a ticket, applies the correct status, and leaves an internal note grounded in the issue.",
  },
  {
    id: "multi-step-form.enterprise-request",
    title: "Complete Enterprise Request",
    tier: "easy",
    sourceFile: "multi-step-form.test.ts",
    sourceCase: "agent completes a 3-step wizard with conditional fields",
    startRoute: "/form",
    prompt:
      "Submit an enterprise request for Jane Smith at jane@example.com, phone 555-0123, company Acme Corp, premium budget, with Priority support needed as the special requirement.",
    maxTurns: 30,
    timeoutMs: 300_000,
    tags: ["form", "wizard", "conditional-fields", "workarena-like"],
    validator: "enterpriseFormSubmitted",
    validatorKind: "fixture-state",
    description:
      "Completes a conditional multi-step form and verifies the submitted confirmation state.",
  },
  {
    id: "data-table.find-diana-salary",
    title: "Find Employee Salary",
    tier: "easy",
    sourceFile: "data-table.test.ts",
    sourceCase: "agent navigates paginated table to find employee and extract salary",
    startRoute: "/data-table",
    prompt: "Search for Diana in the employee directory and tell me her salary.",
    maxTurns: 30,
    timeoutMs: 240_000,
    tags: ["table", "pagination", "lookup", "workarena-like"],
    validator: "dianaSalaryFound",
    validatorKind: "fixture-state",
    description:
      "Searches across paginated table data and returns the requested employee fact.",
  },
  {
    id: "article-research.footnote-source",
    title: "Find Article Source",
    tier: "medium",
    sourceFile: "article-research.test.ts",
    sourceCase: "agent scrolls to find a footnote source and reports it",
    startRoute: "/article",
    prompt:
      "Find the source referenced by the footnote in the article and tell me what source it cites.",
    maxTurns: 12,
    timeoutMs: 120_000,
    tags: ["research", "evidence", "scrolling", "final-answer"],
    validator: "articleFootnoteSourceAnswered",
    validatorKind: "final-answer",
    description:
      "Requires reading through a long page and reporting a specific cited source.",
  },
  {
    id: "tab-management.dashboard-metrics",
    title: "Compare Dashboard Metrics",
    tier: "medium",
    sourceFile: "tab-management.test.ts",
    sourceCase: "collects data from multiple dashboard tabs",
    startRoute: "/dashboard-sales",
    prompt:
      "Get the Open Tickets number from the support dashboard and the Active Campaigns number from the marketing dashboard, then tell me both numbers.",
    maxTurns: 25,
    timeoutMs: 240_000,
    allowNavigation: true,
    tags: ["multi-tab", "dashboard", "lookup", "planning"],
    validator: "dashboardMetricsAnswered",
    validatorKind: "final-answer",
    description:
      "Collects facts from separate dashboards without prescribing the tab strategy.",
    notes:
      "Arena variant removes the current procedural instruction to open each dashboard in a new tab.",
  },
  {
    id: "procurement.complete-first-two",
    title: "Complete Procurement Items",
    tier: "hard",
    sourceFile: "procurement-list.test.ts",
    sourceCase: "processes procurement list across multiple tabs",
    startRoute: "/procurement",
    prompt:
      "Buy the first two items from the procurement list and mark them complete.",
    maxTurns: 40,
    timeoutMs: 480_000,
    allowNavigation: true,
    tags: ["workflow", "multi-tab", "planning", "workarena-like"],
    validator: "firstTwoProcurementItemsComplete",
    validatorKind: "fixture-state",
    description:
      "Completes a multi-record purchasing workflow while preserving state across pages.",
    notes:
      "Arena variant removes the current procedural instruction to open stores in new tabs.",
  },
  {
    id: "job-board.recommend-best-matches",
    title: "Recommend Job Matches",
    tier: "hard",
    sourceFile: "job-board.test.ts",
    sourceCase: "reviews all job listings and recommends best matches for profile",
    startRoute: "/job-board",
    prompt:
      "I'm a senior frontend engineer with 5 years of experience specializing in React and TypeScript. I also have strong experience with Node.js and GraphQL. I'm looking for a fully remote position in the $120K-$160K salary range. Review the job listings and tell me which ones are the best matches for my profile and why.",
    maxTurns: 45,
    timeoutMs: 660_000,
    tags: ["long-horizon", "research", "planning", "recommendation"],
    validator: "jobRecommendationsGrounded",
    validatorKind: "fixture-state",
    description:
      "Reviews a noisy list of opportunities and recommends relevant matches using gathered evidence.",
    notes:
      "Arena variant removes the current instruction to click into every listing and come back.",
  },
  {
    id: "online-shop.boundary-checkout",
    title: "Complete Checkout With Planning Boundaries",
    tier: "hard",
    sourceFile: "online-shop-boundaries.test.ts",
    sourceCase: "advances shopping steps without done() rejection churn",
    startRoute: "/shop",
    prompt:
      "Order the Novablast 4 in size 10, apply coupon SAVE10, choose standard shipping, and check out as alex@example.com.",
    maxTurns: 30,
    timeoutMs: 300_000,
    tags: ["checkout", "planning", "node-isolation", "workflow"],
    validator: "singleOrderPlaced",
    validatorKind: "fixture-state",
    description:
      "Completes checkout while diagnostics verify planner boundaries and duplicate-completion behavior.",
    notes:
      "Task success should remain the completed order; trace diagnostics are secondary planning metrics.",
  },
];

export function getArenaTask(id: string): ArenaTask | undefined {
  return ARENA_TASKS.find((task) => task.id === id);
}

export function getArenaTasksByTier(tier: ArenaTier): ArenaTask[] {
  return ARENA_TASKS.filter((task) => task.tier === tier);
}

export function getArenaTags(): string[] {
  return [...new Set(ARENA_TASKS.flatMap((task) => task.tags))].sort();
}
