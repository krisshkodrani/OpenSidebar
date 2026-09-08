import type {
  JsonObject,
  ScenarioFamily,
  ScenarioManifestV2,
} from "@opensidebar/scenario-contracts";
import { stableHash } from "./stable-json.js";
import {
  createScenarioState,
  projectScenarioTarget,
  reduceScenarioState,
} from "./state.js";
import type { ScenarioDefinitionV2 } from "./types.js";

interface ScenarioSeed {
  id: string;
  family: ScenarioFamily;
  title: string;
  description: string;
}

const SCENARIO_SEEDS: readonly ScenarioSeed[] = [
  { id: "retail-store", family: "retail", title: "Northwind Outfitters", description: "Product discovery, cart, checkout, returns, and account orders." },
  { id: "procurement-hub", family: "procurement", title: "Supply Desk", description: "Purchase requests, vendor comparison, approvals, and inventory." },
  { id: "support-desk", family: "crm", title: "Relay Support", description: "Customer accounts, tickets, notes, priorities, and escalations." },
  { id: "mailbox", family: "email", title: "Postline Mail", description: "Inbox research, drafting, replying, scheduling, and sending." },
  { id: "teamspace", family: "collaboration", title: "Commons", description: "Team chat, channels, meetings, threads, and project coordination." },
  { id: "people-ops", family: "hr", title: "People Center", description: "Employee records, onboarding, leave, benefits, and internal forms." },
  { id: "record-admin", family: "records", title: "Registry", description: "Administrative tables, filters, bulk updates, and record workflows." },
  { id: "analytics-suite", family: "analytics", title: "Signal Analytics", description: "Dashboards, charts, comparisons, thresholds, and exports." },
  { id: "knowledge-base", family: "knowledge", title: "Atlas Knowledge", description: "Articles, policies, citations, documents, and research." },
  { id: "career-portal", family: "jobs", title: "Pathfinder Careers", description: "Job search, comparison, saved roles, and application workflows." },
  { id: "operations-monitor", family: "monitoring", title: "Beacon Operations", description: "Inventory, incidents, messages, prices, and change monitoring." },
  { id: "session-lab", family: "durability", title: "Continuity Lab", description: "Cross-tab, delayed-state, restart, recovery, and session durability." },
] as const;

function definition(seed: ScenarioSeed): ScenarioDefinitionV2 {
  const manifestSeed = {
    schemaVersion: 2 as const,
    id: seed.id,
    version: 2,
    family: seed.family,
    title: seed.title,
    description: seed.description,
    visibility: ["public", "internal"] as const,
  };
  const manifest: ScenarioManifestV2 = {
    ...manifestSeed,
    contentHash: stableHash(manifestSeed),
  };
  return {
    manifest,
    createInitialState(seedValue: number, control: JsonObject = {}) {
      const publicValue = control.public;
      const controlValue = control.control;
      const publicData =
        publicValue && typeof publicValue === "object" && !Array.isArray(publicValue)
          ? (publicValue as JsonObject)
          : {};
      const privateControl =
        controlValue && typeof controlValue === "object" && !Array.isArray(controlValue)
          ? (controlValue as JsonObject)
          : {};
      return createScenarioState({
        scenarioId: manifest.id,
        scenarioVersion: manifest.version,
        seed: seedValue,
        publicData,
        control: privateControl,
      });
    },
    reduce: reduceScenarioState,
    projectTarget: projectScenarioTarget,
  };
}

export const SCENARIOS: readonly ScenarioDefinitionV2[] =
  SCENARIO_SEEDS.map(definition);
