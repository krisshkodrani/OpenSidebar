import type {
  LaneTopologyMode,
  PerceptionRuntimeMode,
  PresenceMode,
  UserSettings,
} from "../../../types";

/** LP-24 presence layer modes (visible agent cursor). */
export const PRESENCE_MODE_OPTIONS: {
  value: PresenceMode;
  label: string;
  description: string;
}[] = [
  {
    value: "subtle",
    label: "Subtle",
    description: "Fast, restrained cursor choreography while the agent acts.",
  },
  {
    value: "cinematic",
    label: "Cinematic",
    description: "Full choreography with slower, demo-grade pacing.",
  },
  {
    value: "off",
    label: "Off",
    description: "No visible cursor; pages change without a visual narrator.",
  },
];

export const MAX_TURNS_PRESETS = [30, 50, 100, 200, 500];

export const LANE_TOPOLOGY_OPTIONS: {
  value: LaneTopologyMode;
  label: string;
  description: string;
}[] = [
  {
    value: "full",
    label: "Reliable",
    description: "Planner, executor, and verifier for highest correctness.",
  },
  {
    value: "standard",
    label: "Balanced",
    description: "Planner and executor without final verification.",
  },
  {
    value: "simple",
    label: "Fast",
    description: "Single executor lane for simple read-only tasks.",
  },
];

export const PERCEPTION_MODE_OPTIONS: {
  value: PerceptionRuntimeMode;
  label: string;
  description: string;
}[] = [
  {
    value: "auto",
    label: "Auto-detect",
    description:
      "Use text when the page is readable; add screenshots for visual or sparse pages.",
  },
  {
    value: "unified_vl",
    label: "Prefer vision",
    description: "Always send screenshots directly to the executor.",
  },
  {
    value: "structured",
    label: "Text only",
    description: "Use DOM text and element data without executor screenshots.",
  },
];

export const SKILL_PACK_OPTIONS = [
  {
    id: "communication-workflows",
    label: "Communication workflows",
    description: "Careful email reply and message composition guidance.",
  },
  {
    id: "procurement-workflows",
    label: "Multi-tab workflows",
    description: "Checklist and source-list tasks that intentionally span tabs.",
  },
];

export function getProviderOneLiner(
  mode: UserSettings["providerMode"] = "fireworks",
) {
  if (mode === "fireworks") return "Executor + Planner via Fireworks AI";
  if (mode === "fireworks-deepseek") {
    return "Executor via Fireworks AI, Planner via DeepSeek";
  }
  if (mode === "moonshot") return "Executor + Planner via Moonshot AI";
  if (mode === "xiaomi") return "Executor + Planner via Xiaomi MiMo";
  if (mode === "openrouter") return "Executor + Planner via OpenRouter";
  if (mode === "openrouter-groq") {
    return "Executor via OpenRouter, Planner via Groq";
  }
  if (mode === "openai-groq") {
    return "Executor via a Fireworks-backed OpenAI-compatible endpoint, Planner via Groq";
  }
  return "";
}

export function getKeyUsage(
  key:
    | "openRouter"
    | "fireworks"
    | "deepseek"
    | "moonshot"
    | "xiaomi"
    | "openai"
    | "groq"
    | "gemini",
  mode: string,
): string {
  const uses: string[] = [];
  if (key === "openRouter") {
    if (mode === "openrouter" || mode === "openrouter-groq") uses.push("agent");
  }
  if (key === "fireworks") {
    if (mode === "fireworks" || mode === "fireworks-deepseek") {
      uses.push("agent");
    }
  }
  if (key === "deepseek") {
    if (mode === "fireworks-deepseek") uses.push("agent");
  }
  if (key === "moonshot") {
    if (mode === "moonshot") uses.push("agent");
  }
  if (key === "xiaomi") {
    if (mode === "xiaomi") uses.push("agent");
  }
  if (key === "openai") {
    if (mode === "openai-groq") uses.push("agent");
  }
  if (key === "groq") {
    if (mode === "openrouter-groq" || mode === "openai-groq") {
      uses.push("agent");
    }
  }
  return uses.length
    ? `Used by: ${uses.join(", ")}`
    : "Not used by current mode";
}
