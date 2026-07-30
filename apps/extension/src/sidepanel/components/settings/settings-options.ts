import type {
  LaneTopologyMode,
  PerceptionRuntimeMode,
  PresenceMode,
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
    description:
      "Checklist and source-list tasks that intentionally span tabs.",
  },
];
