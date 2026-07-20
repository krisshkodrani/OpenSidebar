import type { TraceEntry, TraceSession } from "../../types/traces";
import type { RunTraceEvent } from "../../utils/run-trace";
import type { SessionLogEntry } from "../store/types";

export type InvestigationSeverity = "info" | "warning" | "error";

export type InvestigationCategory =
  | "tool_execution"
  | "loop"
  | "completion"
  | "planning"
  | "perception"
  | "context"
  | "model_provider"
  | "verification"
  | "budget"
  | "trace_integrity";

export interface TraceEvidencePointer {
  kind:
    | "session"
    | "turn"
    | "tool"
    | "event"
    | "run_event"
    | "perception"
    | "log"
    | "screenshot";
  sessionId?: string;
  runId?: string;
  turnNumber?: number;
  toolCallId?: string;
  eventType?: string;
  logIndex?: number;
  label: string;
  resolved?: boolean;
  resolutionStatus?: "resolved" | "unresolved" | "pruned" | "load_failed";
  resolutionDetail?: string;
}

export type InvestigationLabelSource =
  | "deterministic"
  | "heuristic"
  | "llm_verifier";

export interface InvestigationFinding {
  id: string;
  category: InvestigationCategory;
  severity: InvestigationSeverity;
  title: string;
  summary: string;
  confidence: number;
  source?: InvestigationLabelSource;
  derivation?: string;
  firstTurn?: number;
  evidence: TraceEvidencePointer[];
}

export interface InvestigationSummaryMetrics {
  turnCount: number;
  productiveTurns: number;
  toolFailureTurns: number;
  perceptionTurns: number;
  degradedPerceptionTurns: number;
  contextHotTurns: number;
  replanCount: number;
  doneRejectionCount: number;
  totalCost: number;
  totalTokens: number;
}

export interface TraceInvestigation {
  sessionId: string;
  outcome: TraceSession["outcome"] | string;
  likelyFailureClass: InvestigationCategory | "none";
  firstBadTurn: number | null;
  headline: string;
  recommendedAction: string;
  metrics: InvestigationSummaryMetrics;
  findings: InvestigationFinding[];
}

export type EvidenceSignalSource =
  | "tool"
  | "agent_event"
  | "run_event"
  | "perception"
  | "context"
  | "model"
  | "progress"
  | "log";

export type EvidenceSignalTarget = "turns" | "perception" | "logs";

export interface TraceEvidenceSignal {
  id: string;
  source: EvidenceSignalSource;
  category: InvestigationCategory;
  severity: InvestigationSeverity;
  label: string;
  detail?: string;
  target: EvidenceSignalTarget;
}

export interface TraceEvidenceTurn {
  sessionId: string;
  turnNumber: number;
  turnId?: string;
  url?: string;
  title?: string;
  severity: InvestigationSeverity;
  summary: string;
  signals: TraceEvidenceSignal[];
}


export type TraceSessionRelation =
  | "same_run"
  | "same_failure"
  | "same_skill"
  | "same_domain"
  | "same_model";

export interface TraceSessionComparison {
  sessionId: string;
  relation: TraceSessionRelation;
  score: number;
  label: string;
  outcome: TraceSession["outcome"] | string;
  queryTitle: string;
  failureLabel?: string;
  domain?: string;
  sharedSkills: string[];
  sharedModels: string[];
  turnDelta: number;
  costDelta: number;
  durationDeltaMs: number;
  recommendation: string;
}

export interface TraceSessionComparisonResult {
  baseSessionId: string;
  comparisons: TraceSessionComparison[];
}

export type TraceTimelineDiffCategory =
  | "missing_turn"
  | "page"
  | "model_provider"
  | "tool_execution"
  | "completion"
  | "perception"
  | "context"
  | "loop"
  | "verification";

export interface TraceTurnDiffSignal {
  id: string;
  category: TraceTimelineDiffCategory;
  severity: InvestigationSeverity;
  label: string;
  base?: string;
  candidate?: string;
  changed: boolean;
}

export interface TraceTurnDiff {
  turnNumber: number;
  severity: InvestigationSeverity;
  summary: string;
  baseUrl?: string;
  baseTitle?: string;
  candidateUrl?: string;
  candidateTitle?: string;
  signals: TraceTurnDiffSignal[];
}

export interface TraceTimelineDiffOptions {
  maxDiffs?: number;
  includeSharedFailures?: boolean;
}

export interface TraceTimelineDiff {
  baseSessionId: string;
  candidateSessionId: string;
  turnsCompared: number;
  firstDivergenceTurn: number | null;
  headline: string;
  recommendedAction: string;
  diffs: TraceTurnDiff[];
}

export interface TraceTimelineDiffInput {
  baseSession: TraceSession;
  baseEntries: TraceEntry[];
  candidateSession: TraceSession;
  candidateEntries: TraceEntry[];
}

export interface TraceAnalysisInput {
  session: TraceSession;
  entries: TraceEntry[];
  runEvents?: RunTraceEvent[];
  logs?: SessionLogEntry[];
}

export interface TraceValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  sessionId?: string;
  runId?: string;
  turnNumber?: number;
}

export interface TraceValidationResult {
  valid: boolean;
  kind: string;
  issues: TraceValidationIssue[];
}

export interface TraceBundleValidationInput {
  sessions: TraceSession[];
  entriesBySession: Map<string, TraceEntry[]>;
  runEventsByRun?: Map<string, RunTraceEvent[]>;
  screenshotFiles?: Set<string>;
  sessionFiles?: Set<string>;
}

export interface FrozenTraceScreenshot {
  sessionId: string;
  turnNumber: number;
  fileName?: string;
  dataUrl?: string;
  sha256?: string;
}

export interface FrozenTraceBundle {
  schemaVersion: "2026-05-30";
  traceKind: "trace.viewer.frozen_bundle";
  frozenAt: string;
  session: TraceSession;
  entries: TraceEntry[];
  runEvents?: RunTraceEvent[];
  logs?: SessionLogEntry[];
  screenshots?: FrozenTraceScreenshot[];
  report?: string;
}
