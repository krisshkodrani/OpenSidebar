export const DIANA_SALARY = "$65,386";

export interface ValidationCheck {
  ok: boolean;
  checks: Record<string, boolean>;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function includesAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function validateSupportTriageComment(
  commentValue: unknown,
): ValidationCheck {
  const comment = normalizeText(commentValue);
  const checks = {
    issue: includesAny(comment, ["csv", "export", "timeout", "report"]),
    nextStep: includesAny(comment, [
      "next",
      "investigate",
      "reproduce",
      "engineering",
      "follow up",
      "escalat",
      "check logs",
    ]),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateEnterpriseFormResult(
  result: Record<string, unknown> | null | undefined,
): ValidationCheck {
  const checks = {
    name: result?.name === "Jane Smith",
    email: result?.email === "jane@example.com",
    phone: result?.phone === "555-0123",
    category: result?.category === "Enterprise",
    company: result?.company === "Acme Corp",
    budget: /premium/i.test(String(result?.budget ?? "")),
    requirements: /priority support needed/i.test(
      String(result?.requirements ?? ""),
    ),
    submitted: /^REF-/.test(String(result?.refNumber ?? "")),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateDianaSalaryAnswer(
  result: Record<string, unknown> | null | undefined,
  summaryValue: unknown,
): ValidationCheck {
  const checks = {
    dianaViewed: result?.dianaFound === true,
    fixtureSalary: String(result?.dianaSalary ?? "") === DIANA_SALARY,
    answerNamesDiana: normalizeText(summaryValue).includes("diana"),
    answerHasSalary: digits(summaryValue).includes(digits(DIANA_SALARY)),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export interface ProcurementStoreState {
  slug: string | null;
  orderPlaced: boolean;
  cart: Array<{
    productId?: unknown;
    name?: unknown;
    qty?: unknown;
    price?: unknown;
  }>;
}

export function validateProcurementOutcome(input: {
  checked: unknown;
  stores: readonly ProcurementStoreState[];
}): ValidationCheck {
  const checked = Array.isArray(input.checked) ? input.checked.map(String) : [];
  const orderedLine = (
    slug: string,
    productId: string,
    quantity: number,
    maxUnitPrice: number,
  ) =>
    input.stores.some(
      (store) =>
        store.slug === slug &&
        store.orderPlaced &&
        store.cart.length === 1 &&
        store.cart.some(
          (line) =>
            line.productId === productId &&
            Number(line.qty) === quantity &&
            Number(line.price) <= maxUnitPrice,
        ),
    );
  const checks = {
    firstMarkedComplete: checked.includes("item-1"),
    secondMarkedComplete: checked.includes("item-2"),
    keyboardPurchased: orderedLine("techdirect", "td-kb-1", 2, 89),
    deskMatPurchased: orderedLine("officehub", "oh-mat-1", 1, 45),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateReleaseCoordinationReply(
  messageValue: unknown,
): ValidationCheck {
  const message = normalizeText(messageValue);
  const timingIsUnconfirmed =
    /(?:release|timing|date|target).{0,60}(?:not set|not confirmed|unclear|tbd|depends|after|once)/.test(
      message,
    ) ||
    /(?:not set|not confirmed|unclear|tbd).{0,60}(?:release|timing|date|target)/.test(
      message,
    );
  const checks = {
    timing: timingIsUnconfirmed,
    changelogOwner:
      message.includes("release owner") || message.includes("alice"),
    blocker: includesAny(message, [
      "onboarding",
      "progress indicator",
      "edge case",
      "green light",
    ]),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateKanbanColumns(
  columns: Record<string, unknown> | null | undefined,
): ValidationCheck {
  const inProgress = Array.isArray(columns?.["in-progress"])
    ? (columns?.["in-progress"] as unknown[]).map(String)
    : [];
  const checks = {
    apiDocsInProgress: inProgress.includes("Write API Docs"),
    ciPipelineInProgress: inProgress.includes("Setup CI Pipeline"),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateCheckoutOutcome(
  order: Record<string, unknown> | null | undefined,
  orderCount: number,
): ValidationCheck {
  const items = Array.isArray(order?.items)
    ? (order.items as Array<Record<string, unknown>>)
    : [];
  const novablast = items.find((item) => item.id === "novablast-4");
  const checks = {
    oneOrder: orderCount === 1,
    oneLineItem: items.length === 1,
    product: Boolean(novablast),
    size: Number(novablast?.size) === 10,
    quantity: Number(novablast?.qty) === 1,
    shipping: order?.shippingMethod === "standard",
    coupon: order?.coupon === "SAVE10",
    email: order?.email === "alex@example.com",
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

const APPLICATION_GROUNDING_SIGNALS: Record<string, readonly string[]> = {
  "sr-fe-1": [
    "nextera",
    "analytics",
    "dashboard",
    "graphql",
    "accessib",
    "component library",
    "enterprise customer",
  ],
  "fe-lead-2": [
    "cloudscale",
    "infrastructure console",
    "serverless",
    "architecture",
    "team of 5",
    "graphql",
    "ci/cd",
  ],
  "fullstack-3": [
    "datapulse",
    "data observability",
    "node.js",
    "express",
    "postgres",
    "graphql",
    "on-call",
  ],
  "sr-ui-4": [
    "designflow",
    "design system",
    "component library",
    "vector",
    "canvas",
    "webgl",
    "prototyp",
    "editor",
  ],
};

function sentenceCount(value: unknown): number {
  return String(value ?? "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /[.!?]$/.test(sentence.trim())).length;
}

export function validateStagedApplication(input: {
  jobId: string | null;
  draft: Record<string, unknown> | null;
  hasResult: boolean;
}): ValidationCheck {
  const { jobId, draft, hasResult } = input;
  const why = normalizeText(draft?.whyLangfuse);
  const groundingSignals = jobId
    ? (APPLICATION_GROUNDING_SIGNALS[jobId] ?? [])
    : [];
  const groundingMatches = groundingSignals.filter((signal) =>
    why.includes(signal),
  ).length;
  const whySentences = sentenceCount(draft?.whyLangfuse);
  const salary = digits(draft?.salaryExpectation);
  const checks = {
    validJob: Boolean(jobId && APPLICATION_GROUNDING_SIGNALS[jobId]),
    name: String(draft?.name ?? "").trim() === "Jordan Reyes",
    email:
      String(draft?.email ?? "")
        .trim()
        .toLowerCase() === "jordan.reyes@example.com",
    linkedIn:
      String(draft?.linkedIn ?? "").trim() ===
      "https://www.linkedin.com/in/jordanreyes",
    phone: digits(draft?.phone) === "15550100199",
    location: normalizeText(draft?.currentLocation) === "denver, co",
    workPermit: String(draft?.euWorkPermit ?? "").trim() === "No",
    salary:
      salary.includes("120000") &&
      salary.includes("160000") &&
      normalizeText(draft?.salaryExpectation).includes("depending on role"),
    startDate: String(draft?.earliestStartDate ?? "").trim() === "2026-08-03",
    roleGroundedWhy:
      whySentences >= 2 && whySentences <= 3 && groundingMatches >= 2,
    resumeEmpty: String(draft?.resumeName ?? "") === "",
    notSubmitted: draft?.submitted === false && !hasResult,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validateWorkspaceClarificationQuestion(
  questionValue: unknown,
): ValidationCheck {
  const question = normalizeText(questionValue);
  const checks = {
    asksQuestion:
      question.includes("?") ||
      /\b(?:which|what|choose|select|prefer)\b/.test(question),
    identifiesChoice:
      question.includes("workspace") ||
      (question.includes("alpha") && question.includes("beta")),
    requestsUserDecision: /\b(?:which|what|choose|select|prefer)\b/.test(
      question,
    ),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
