import type { ScenarioFamily } from "@opensidebar/scenario-contracts";

export interface TargetFamilyConfig { brand: string; section: string; accent: string; navigation: readonly string[]; valueLabel: string; saveLabel: string; }
export const TARGET_FAMILIES: Record<ScenarioFamily, TargetFamilyConfig> = {
  retail: { brand: "Northwind Outfitters", section: "Store", accent: "#155eef", navigation: ["Shop", "Collections", "Cart", "Orders"], valueLabel: "Selection", saveLabel: "Update cart" },
  procurement: { brand: "Supply Desk", section: "Procurement", accent: "#8250df", navigation: ["Requests", "Vendors", "Orders", "Inventory"], valueLabel: "Request value", saveLabel: "Save request" },
  crm: { brand: "Relay Support", section: "Customer service", accent: "#c2410c", navigation: ["Inbox", "Tickets", "Accounts", "Reports"], valueLabel: "Ticket update", saveLabel: "Save ticket" },
  email: { brand: "Postline", section: "Mail", accent: "#2563eb", navigation: ["Inbox", "Starred", "Drafts", "Sent"], valueLabel: "Message", saveLabel: "Save draft" },
  collaboration: { brand: "Commons", section: "Teamspace", accent: "#7c3aed", navigation: ["Home", "Threads", "Channels", "Calendar"], valueLabel: "Reply", saveLabel: "Post update" },
  hr: { brand: "People Center", section: "People operations", accent: "#047857", navigation: ["People", "Onboarding", "Time off", "Benefits"], valueLabel: "Record value", saveLabel: "Save record" },
  records: { brand: "Registry", section: "Records", accent: "#334155", navigation: ["All records", "Queues", "Imports", "Exports"], valueLabel: "Field value", saveLabel: "Save changes" },
  analytics: { brand: "Signal", section: "Analytics", accent: "#0369a1", navigation: ["Overview", "Sales", "Support", "Marketing"], valueLabel: "Dashboard setting", saveLabel: "Apply" },
  knowledge: { brand: "Atlas", section: "Knowledge", accent: "#92400e", navigation: ["Home", "Policies", "Articles", "Bookmarks"], valueLabel: "Article action", saveLabel: "Save" },
  jobs: { brand: "Pathfinder", section: "Careers", accent: "#be185d", navigation: ["Search", "Saved", "Applications", "Profile"], valueLabel: "Application value", saveLabel: "Save progress" },
  monitoring: { brand: "Beacon", section: "Operations", accent: "#b91c1c", navigation: ["Live", "Incidents", "Alerts", "History"], valueLabel: "Monitor setting", saveLabel: "Apply setting" },
  durability: { brand: "Continuity Lab", section: "Session workspace", accent: "#475569", navigation: ["Workspace", "Open tabs", "Checkpoints", "Activity"], valueLabel: "Continuation value", saveLabel: "Continue" },
};
export function isScenarioFamily(value: unknown): value is ScenarioFamily { return typeof value === "string" && value in TARGET_FAMILIES; }
