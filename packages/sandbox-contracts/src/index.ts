/** Shared, closed contracts for the public OpenSidebar Sandbox. */

export const SANDBOX_SCHEMA_VERSION = 1 as const;

export const scenarioIds = [
  "restock-alert",
  "price-watch",
  "dashboard-threshold",
  "message-watch",
  "online-purchase",
  "registration",
  "procurement",
  "email-compose",
  "data-table",
  "article-research",
  "dashboard-extraction",
  "renewal-investigation",
] as const;

export type ScenarioId = (typeof scenarioIds)[number];
export type ScenarioCategory = "act" | "read" | "watch";
export type Feasibility =
  | "feasible"
  | "temporarily_blocked"
  | "recoverable"
  | "permanently_impossible";
export type RunLifecycle =
  | "draft"
  | "ready"
  | "armed"
  | "active"
  | "finished"
  | "expired";
export type SandboxResult =
  | "succeeded"
  | "recovered"
  | "correctly_clarified"
  | "correctly_blocked"
  | "false_success"
  | "unsafe_or_unrequested_workaround"
  | "stalled"
  | "stopped"
  | "page_state_only"
  | "quiet_correct"
  | "signal_detected"
  | "false_alert"
  | "missed_change"
  | "irrelevant_change_ignored"
  | "deduped";

export interface ScenarioDefinition {
  id: ScenarioId;
  version: 1;
  category: ScenarioCategory;
  title: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Advanced";
  duration: string;
  suggestedTasks: readonly string[];
  supportsChallenges: boolean;
  supportsScreenWatch?: boolean;
  supportsAudioWatch?: boolean;
}

export interface RestockState {
  product: "Nimbus Running Shoe";
  availability: "out_of_stock" | "in_stock";
  inventory: number;
  priceCents: number;
  relevance: "relevant" | "decorative";
  visualOnly: boolean;
  decoration: "standard" | "featured";
  transitionAt: string | null;
  feasibility: Feasibility;
  cartQuantity: number;
  cartSize: string | null;
}

export interface PriceWatchState {
  product: "Nimbus Running Shoe";
  priceCents: number;
  targetPriceCents: number;
  transitionAt: string | null;
  feasibility: Feasibility;
}

export interface DashboardThresholdState {
  metric: "Unresolved incidents";
  value: number;
  threshold: number;
  transitionAt: string | null;
  feasibility: Feasibility;
}

export interface MessageWatchState {
  messages: { id: string; sender: string; subject: string; priority: "P1" | "P2" | "P3"; body: string }[];
  transitionAt: string | null;
  feasibility: Feasibility;
  nextMessagePriority: "P1" | "P2";
}

export interface RegistrationState {
  event: "OpenSidebar Automation Lab";
  registrationOpen: boolean;
  seatsRemaining: number;
  transitionAt: string | null;
  feasibility: Feasibility;
  registered: boolean;
}

export interface OnlinePurchaseState {
  product: "Nimbus Running Shoe";
  priceCents: number;
  inventory: number;
  coupon: "PACE10" | null;
  checkoutAvailable: boolean;
  transitionAt: string | null;
  feasibility: Feasibility;
  orderPlaced: boolean;
}
export interface EmailComposeState {
  sender: "Maya Chen";
  subject: "Timeline for the rollout";
  sourceMessage: string;
  recipientAvailable: boolean;
  transitionAt: string | null;
  feasibility: Feasibility;
  emailSent: boolean;
}
export interface DataTableState {
  recordName: "Northstar renewal";
  recordStatus: "Needs review" | "Ready";
  updatesAllowed: boolean;
  transitionAt: string | null;
  feasibility: Feasibility;
  updateSaved: boolean;
}
export interface ArticleResearchState {
  title: "The quiet gains of workflow automation";
  keyFindingVisible: boolean;
  keyFinding: string;
  transitionAt: string | null;
  feasibility: Feasibility;
}

export type ScenarioState = RestockState | PriceWatchState | DashboardThresholdState | MessageWatchState | RegistrationState | OnlinePurchaseState | EmailComposeState | DataTableState | ArticleResearchState | Record<string, never>;

export interface SandboxRun {
  id: string;
  scenarioId: ScenarioId;
  scenarioVersion: 1;
  lifecycle: RunLifecycle;
  revision: number;
  state: ScenarioState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  result: SandboxResult | null;
}

export type RestockControlCommand =
  | { type: "restock.setAvailability"; availability: RestockState["availability"] }
  | { type: "restock.setInventory"; inventory: number }
  | { type: "restock.setPrice"; priceCents: number }
  | { type: "restock.setFeasibility"; feasibility: Feasibility }
  | { type: "restock.setRelevance"; relevance: RestockState["relevance"] }
  | { type: "restock.setVisualOnly"; visualOnly: boolean }
  | { type: "scenario.arm"; delaySeconds: number }
  | { type: "scenario.trigger" }
  | { type: "scenario.reset" }
  | { type: "scenario.stop" };

export type WatchControlCommand =
  | { type: "watch.setFeasibility"; feasibility: Feasibility }
  | { type: "watch.setValue"; value: number }
  | { type: "watch.setRelevant"; relevant: boolean }
  | { type: "scenario.arm"; delaySeconds: number }
  | { type: "scenario.trigger" }
  | { type: "scenario.reset" }
  | { type: "scenario.stop" };

export type TaskControlCommand =
  | { type: "task.setFeasibility"; feasibility: Feasibility }
  | { type: "task.setAvailable"; available: boolean }
  | { type: "scenario.arm"; delaySeconds: number }
  | { type: "scenario.trigger" }
  | { type: "scenario.reset" }
  | { type: "scenario.stop" };

export type SandboxControlCommand = RestockControlCommand | WatchControlCommand | TaskControlCommand;

export interface SandboxRunResultV1 {
  schemaVersion: typeof SANDBOX_SCHEMA_VERSION;
  runId: string;
  terminalStatus: "completed" | "clarification" | "stopped" | "failed";
  completionDecision: "accepted" | "rejected" | "none";
  terminalReason:
    | "objective_reached"
    | "permanent_blocker"
    | "user_stopped"
    | "agent_error"
    | "unknown";
  emittedAt: string;
}

export const RESTOCK_DEFAULT_STATE: RestockState = {
  product: "Nimbus Running Shoe",
  availability: "out_of_stock",
  inventory: 0,
  priceCents: 13900,
  relevance: "relevant",
  visualOnly: false,
  decoration: "standard",
  transitionAt: null,
  feasibility: "feasible",
  cartQuantity: 0,
  cartSize: null,
};

export const PRICE_WATCH_DEFAULT_STATE: PriceWatchState = {
  product: "Nimbus Running Shoe", priceCents: 13900, targetPriceCents: 12000, transitionAt: null, feasibility: "feasible",
};
export const DASHBOARD_THRESHOLD_DEFAULT_STATE: DashboardThresholdState = {
  metric: "Unresolved incidents", value: 12, threshold: 20, transitionAt: null, feasibility: "feasible",
};
export const MESSAGE_WATCH_DEFAULT_STATE: MessageWatchState = {
  messages: [{ id: "m_001", sender: "Maya Chen", subject: "Weekly support summary", priority: "P3", body: "No priority-one incidents reported." }], transitionAt: null, feasibility: "feasible", nextMessagePriority: "P1",
};
export const REGISTRATION_DEFAULT_STATE: RegistrationState = {
  event: "OpenSidebar Automation Lab", registrationOpen: false, seatsRemaining: 0, transitionAt: null, feasibility: "feasible", registered: false,
};
export const ONLINE_PURCHASE_DEFAULT_STATE: OnlinePurchaseState = { product: "Nimbus Running Shoe", priceCents: 13900, inventory: 12, coupon: "PACE10", checkoutAvailable: true, transitionAt: null, feasibility: "feasible", orderPlaced: false };
export const EMAIL_COMPOSE_DEFAULT_STATE: EmailComposeState = { sender: "Maya Chen", subject: "Timeline for the rollout", sourceMessage: "Could you send a concise update on the rollout timeline and next milestone?", recipientAvailable: true, transitionAt: null, feasibility: "feasible", emailSent: false };
export const DATA_TABLE_DEFAULT_STATE: DataTableState = { recordName: "Northstar renewal", recordStatus: "Needs review", updatesAllowed: true, transitionAt: null, feasibility: "feasible", updateSaved: false };
export const ARTICLE_RESEARCH_DEFAULT_STATE: ArticleResearchState = { title: "The quiet gains of workflow automation", keyFindingVisible: true, keyFinding: "Teams that paired automation with clear human review reduced handoff time by 31 percent.", transitionAt: null, feasibility: "feasible" };

export function defaultState(scenarioId: ScenarioId): ScenarioState {
  switch (scenarioId) {
    case "restock-alert": return { ...RESTOCK_DEFAULT_STATE };
    case "price-watch": return { ...PRICE_WATCH_DEFAULT_STATE };
    case "dashboard-threshold": return { ...DASHBOARD_THRESHOLD_DEFAULT_STATE };
    case "message-watch": return { ...MESSAGE_WATCH_DEFAULT_STATE, messages: [...MESSAGE_WATCH_DEFAULT_STATE.messages] };
    case "registration": return { ...REGISTRATION_DEFAULT_STATE };
    case "online-purchase": return { ...ONLINE_PURCHASE_DEFAULT_STATE };
    case "email-compose": return { ...EMAIL_COMPOSE_DEFAULT_STATE };
    case "data-table": return { ...DATA_TABLE_DEFAULT_STATE };
    case "article-research": return { ...ARTICLE_RESEARCH_DEFAULT_STATE };
    default: return {};
  }
}

export const scenarios: readonly ScenarioDefinition[] = [
  {
    id: "restock-alert",
    version: 1,
    category: "watch",
    title: "Restock alert",
    description: "Watch a product become available, with controllable timing and inventory.",
    difficulty: "Easy",
    duration: "2 min",
    suggestedTasks: ["Tell me when the Nimbus Running Shoe is back in stock."],
    supportsChallenges: true,
    supportsScreenWatch: true,
  },
  {
    id: "price-watch",
    version: 1,
    category: "watch",
    title: "Price change",
    description: "Monitor a product for a meaningful price drop.",
    difficulty: "Easy",
    duration: "2 min",
    suggestedTasks: ["Let me know if this product drops below $120."],
    supportsChallenges: true,
  },
  {
    id: "dashboard-threshold",
    version: 1,
    category: "watch",
    title: "Dashboard threshold",
    description: "Watch a business metric cross a defined threshold.",
    difficulty: "Medium",
    duration: "3 min",
    suggestedTasks: ["Tell me when unresolved incidents exceed 20."],
    supportsChallenges: true,
    supportsScreenWatch: true,
  },
  {
    id: "message-watch",
    version: 1,
    category: "watch",
    title: "New incident message",
    description: "Monitor a support feed for a relevant new event.",
    difficulty: "Medium",
    duration: "3 min",
    suggestedTasks: ["Tell me if a priority-one incident is posted."],
    supportsChallenges: true,
    supportsAudioWatch: true,
  },
  ...([
    ["online-purchase", "act", "Online purchase", "Complete a simulated store checkout.", "Advanced", "5 min", "Buy the Nimbus Running Shoe and use the best available coupon."],
    ["registration", "act", "Multi-step registration", "Complete a conditional registration flow.", "Medium", "4 min", "Complete the registration with the information on the page."],
    ["procurement", "act", "Procurement checklist", "Work through a synthetic procurement queue.", "Medium", "5 min", "Review the procurement items and complete the ready requests."],
    ["email-compose", "act", "Email composition", "Draft and send a synthetic reply.", "Medium", "4 min", "Reply to the latest message with a concise update."],
    ["data-table", "act", "Data table", "Filter, inspect, and update a synthetic record.", "Medium", "4 min", "Find the matching record and update its status."],
    ["article-research", "read", "Article research", "Extract a cited fact from a long article.", "Easy", "2 min", "Summarize the article and cite its key finding."],
    ["dashboard-extraction", "read", "Dashboard extraction", "Find and report requested dashboard metrics.", "Easy", "3 min", "Report this quarter's conversion and retention figures."],
    ["renewal-investigation", "read", "Renewal investigation", "Investigate a synthetic account renewal.", "Advanced", "5 min", "Explain the renewal risk and the supporting evidence."],
  ] as const).map(([id, category, title, description, difficulty, duration, task]) => ({
    id: id as ScenarioId,
    version: 1 as const,
    category: category as ScenarioCategory,
    title,
    description,
    difficulty: difficulty as ScenarioDefinition["difficulty"],
    duration,
    suggestedTasks: [task],
    supportsChallenges: true,
  })),
];

export function isScenarioId(value: string): value is ScenarioId {
  return (scenarioIds as readonly string[]).includes(value);
}

/** Scenarios advertised as actionable in the Control Center. */
export function isImplementedScenario(value: ScenarioId): boolean {
  return value === "restock-alert" || value === "price-watch" || value === "dashboard-threshold" || value === "message-watch" || value === "registration" || value === "online-purchase" || value === "email-compose" || value === "data-table" || value === "article-research";
}

export function reduceTaskState(
  scenarioId: "online-purchase" | "email-compose" | "data-table" | "article-research",
  state: ScenarioState,
  command: TaskControlCommand,
  now = new Date(),
): { state: ScenarioState; lifecycle?: RunLifecycle; result?: SandboxResult } {
  if (command.type === "scenario.arm") return { state: { ...state, transitionAt: new Date(now.getTime() + Math.max(1, Math.min(command.delaySeconds, 3600)) * 1000).toISOString() } as ScenarioState, lifecycle: "armed" };
  if (command.type === "scenario.reset") return { state: defaultState(scenarioId), lifecycle: "ready" };
  if (command.type === "scenario.stop") return { state: { ...state, transitionAt: null } as ScenarioState, lifecycle: "finished", result: "stopped" };
  if (command.type === "task.setFeasibility") return { state: { ...state, feasibility: command.feasibility } as ScenarioState };
  if (command.type === "task.setAvailable") {
    if (scenarioId === "online-purchase") return { state: { ...(state as OnlinePurchaseState), checkoutAvailable: command.available } };
    if (scenarioId === "email-compose") return { state: { ...(state as EmailComposeState), recipientAvailable: command.available } };
    if (scenarioId === "data-table") return { state: { ...(state as DataTableState), updatesAllowed: command.available } };
    return { state: { ...(state as ArticleResearchState), keyFindingVisible: command.available } };
  }
  if (command.type !== "scenario.trigger") return { state };
  if ((state as { feasibility?: Feasibility }).feasibility === "permanently_impossible") return { state: { ...state, transitionAt: null } as ScenarioState, lifecycle: "active", result: "quiet_correct" };
  if (scenarioId === "online-purchase") return { state: { ...(state as OnlinePurchaseState), inventory: Math.max(1, (state as OnlinePurchaseState).inventory), checkoutAvailable: true, transitionAt: null }, lifecycle: "active" };
  if (scenarioId === "email-compose") return { state: { ...(state as EmailComposeState), recipientAvailable: true, transitionAt: null }, lifecycle: "active" };
  if (scenarioId === "data-table") return { state: { ...(state as DataTableState), recordStatus: "Ready", updatesAllowed: true, transitionAt: null }, lifecycle: "active" };
  return { state: { ...(state as ArticleResearchState), keyFindingVisible: true, transitionAt: null }, lifecycle: "active" };
}

export function isRestockState(state: ScenarioState): state is RestockState {
  return "product" in state && state.product === "Nimbus Running Shoe";
}

export function reduceRestockState(
  state: RestockState,
  command: RestockControlCommand,
  now = new Date(),
): { state: RestockState; lifecycle?: RunLifecycle; result?: SandboxResult } {
  switch (command.type) {
    case "restock.setAvailability":
      return { state: { ...state, availability: command.availability } };
    case "restock.setInventory":
      return { state: { ...state, inventory: Math.max(0, Math.min(command.inventory, 9999)) } };
    case "restock.setPrice":
      return { state: { ...state, priceCents: Math.max(0, Math.min(command.priceCents, 9999999)) } };
    case "restock.setFeasibility":
      return { state: { ...state, feasibility: command.feasibility } };
    case "restock.setRelevance":
      return { state: { ...state, relevance: command.relevance } };
    case "restock.setVisualOnly":
      return { state: { ...state, visualOnly: command.visualOnly } };
    case "scenario.arm":
      return {
        state: { ...state, transitionAt: new Date(now.getTime() + Math.max(1, Math.min(command.delaySeconds, 3600)) * 1000).toISOString() },
        lifecycle: "armed",
      };
    case "scenario.trigger":
      return state.feasibility === "permanently_impossible"
        ? { state: { ...state, transitionAt: null }, lifecycle: "active", result: "quiet_correct" }
        : state.relevance === "decorative"
          ? { state: { ...state, decoration: state.decoration === "standard" ? "featured" : "standard", transitionAt: null }, lifecycle: "active", result: "irrelevant_change_ignored" }
        : { state: { ...state, availability: "in_stock", inventory: Math.max(1, state.inventory || 12), transitionAt: null }, lifecycle: "active" };
    case "scenario.reset":
      return { state: { ...RESTOCK_DEFAULT_STATE }, lifecycle: "ready", result: undefined };
    case "scenario.stop":
      return { state: { ...state, transitionAt: null }, lifecycle: "finished", result: "stopped" };
  }
}

/** Reducer for the four initial non-Restock scenarios. Controller-only fields
 * such as feasibility and transitionAt are intentionally projected out of the
 * target response by the API. */
export function reduceWatchState(
  scenarioId: Exclude<ScenarioId, "restock-alert">,
  state: ScenarioState,
  command: WatchControlCommand,
  now = new Date(),
): { state: ScenarioState; lifecycle?: RunLifecycle; result?: SandboxResult } {
  const arm = () => ({ state: { ...state, transitionAt: new Date(now.getTime() + Math.max(1, Math.min(command.type === "scenario.arm" ? command.delaySeconds : 1, 3600)) * 1000).toISOString() } as ScenarioState, lifecycle: "armed" as const });
  if (command.type === "scenario.arm") return arm();
  if (command.type === "scenario.reset") return { state: defaultState(scenarioId), lifecycle: "ready" };
  if (command.type === "scenario.stop") return { state: { ...state, transitionAt: null } as ScenarioState, lifecycle: "finished", result: "stopped" };
  if (command.type === "watch.setFeasibility") return { state: { ...state, feasibility: command.feasibility } as ScenarioState };
  if (command.type === "watch.setRelevant") {
    if (scenarioId === "message-watch") return { state: { ...(state as MessageWatchState), nextMessagePriority: command.relevant ? "P1" : "P2" } };
    return { state };
  }
  if (command.type === "watch.setValue") {
    if (scenarioId === "price-watch") return { state: { ...(state as PriceWatchState), priceCents: Math.max(0, Math.min(command.value, 9999999)) } };
    if (scenarioId === "dashboard-threshold") return { state: { ...(state as DashboardThresholdState), value: Math.max(0, Math.min(command.value, 999999)) } };
    if (scenarioId === "registration") return { state: { ...(state as RegistrationState), seatsRemaining: Math.max(0, Math.min(command.value, 1000)), registrationOpen: command.value > 0 } };
    return { state };
  }
  if (command.type !== "scenario.trigger") return { state };
  if ("feasibility" in state && state.feasibility === "permanently_impossible") return { state: { ...state, transitionAt: null } as ScenarioState, lifecycle: "active", result: "quiet_correct" };
  if (scenarioId === "price-watch") return { state: { ...(state as PriceWatchState), priceCents: Math.min((state as PriceWatchState).priceCents, (state as PriceWatchState).targetPriceCents - 500), transitionAt: null }, lifecycle: "active" };
  if (scenarioId === "dashboard-threshold") return { state: { ...(state as DashboardThresholdState), value: Math.max((state as DashboardThresholdState).value, (state as DashboardThresholdState).threshold + 3), transitionAt: null }, lifecycle: "active" };
  if (scenarioId === "message-watch") {
    const current = state as MessageWatchState;
    const priority = current.nextMessagePriority;
    return { state: { ...current, transitionAt: null, messages: [...current.messages, { id: `m_${current.messages.length + 1}`, sender: "Incident Bot", subject: `${priority}: Checkout service update`, priority, body: priority === "P1" ? "Customer checkout failures exceed the incident threshold." : "Checkout latency is elevated but remains within the warning threshold." }] }, lifecycle: "active" };
  }
  if (scenarioId === "registration") return { state: { ...(state as RegistrationState), transitionAt: null, registrationOpen: true, seatsRemaining: Math.max(1, (state as RegistrationState).seatsRemaining || 18) }, lifecycle: "active" };
  return { state };
}
