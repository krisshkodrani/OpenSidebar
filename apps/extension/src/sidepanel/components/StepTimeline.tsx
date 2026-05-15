import React, { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Search,
  MousePointerClick,
  Type,
  CornerDownLeft,
  ArrowUpDown,
  Globe,
  Eye,
  Code,
  ArrowUp,
  MessageCircle,
  GripVertical,
  Wrench,
  EyeOff,
  ListChecks,
  StickyNote,
  Clock,
  X as XIcon,
  Cookie,
  Download,
  History,
  Zap,
  FileUp,
  ArrowLeft,
  Layers,
  MonitorCheck,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AgentStep, ToolName } from "../../types";
import { clsx } from "clsx";
import {
  displayProgressLabel,
  isGenericProgressLabel,
  isLowLevelProgressLabel,
} from "../progress-labels";

/** Map a tool name (from step label) to a specific icon */
function toolIcon(step: AgentStep): React.ReactNode {
  const cls = "shrink-0";
  const sz = 13;

  if (step.status === "running") {
    return (
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-40 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-500" />
      </span>
    );
  }
  if (step.status === "error") {
    return <XCircle size={sz} className={`text-red-500 ${cls}`} />;
  }

  const iconCls = `text-warm-400 dark:text-warm-500 ${cls}`;
  const tool = step.toolName;

  switch (tool) {
    case ToolName.CLICK_ELEMENT:
    case ToolName.RIGHT_CLICK:
    case ToolName.CLICK_COORDINATES:
      return <MousePointerClick size={sz} className={iconCls} />;
    case ToolName.TYPE_TEXT:
      return <Type size={sz} className={iconCls} />;
    case ToolName.PRESS_KEY:
      return <CornerDownLeft size={sz} className={iconCls} />;
    case ToolName.SCROLL_PAGE:
      return <ArrowUpDown size={sz} className={iconCls} />;
    case ToolName.FIND_ELEMENT:
    case ToolName.SEARCH_HISTORY:
    case ToolName.INSPECT_HIDDEN:
      return <Search size={sz} className={iconCls} />;
    case ToolName.READ_PAGE:
    case ToolName.READ_ELEMENT:
      return <Eye size={sz} className={iconCls} />;
    case ToolName.NAVIGATE:
    case ToolName.CREATE_TAB:
      return <Globe size={sz} className={iconCls} />;
    case ToolName.EXECUTE_JS:
      return <Code size={sz} className={iconCls} />;
    case ToolName.ESCALATE:
      return <ArrowUp size={sz} className={iconCls} />;
    case ToolName.CLARIFY:
      return <MessageCircle size={sz} className={iconCls} />;
    case ToolName.DRAG_AND_DROP:
      return <GripVertical size={sz} className={iconCls} />;
    case ToolName.DONE:
      return <CheckCircle size={sz} className={iconCls} />;
    case ToolName.HIDE_ELEMENT:
      return <EyeOff size={sz} className={iconCls} />;
    case ToolName.HOVER_ELEMENT:
      return <MonitorCheck size={sz} className={iconCls} />;
    case ToolName.SELECT_OPTION:
    case ToolName.SET_CHECKBOX:
      return <ListChecks size={sz} className={iconCls} />;
    case ToolName.UPDATE_NOTES:
      return <StickyNote size={sz} className={iconCls} />;
    case ToolName.UPDATE_PLAN:
      return <ListChecks size={sz} className={iconCls} />;
    case ToolName.WAIT:
      return <Clock size={sz} className={iconCls} />;
    case ToolName.CLOSE_TAB:
      return <XIcon size={sz} className={iconCls} />;
    case ToolName.SWITCH_TAB:
    case ToolName.LIST_TABS:
      return <Layers size={sz} className={iconCls} />;
    case ToolName.GO_BACK:
      return <ArrowLeft size={sz} className={iconCls} />;
    case ToolName.GET_COOKIES:
    case ToolName.SET_COOKIE:
    case ToolName.DELETE_COOKIE:
      return <Cookie size={sz} className={iconCls} />;
    case ToolName.DOWNLOAD_FILE:
      return <Download size={sz} className={iconCls} />;
    case ToolName.UPLOAD_FILE:
      return <FileUp size={sz} className={iconCls} />;
    case ToolName.XRAY_PAGE:
      return <Zap size={sz} className={iconCls} />;
    case ToolName.DISMISS_OVERLAYS:
      return <XIcon size={sz} className={iconCls} />;
    default:
      if (step.type === "thinking")
        return <History size={sz} className={iconCls} />;
      return <Wrench size={sz} className={iconCls} />;
  }
}

function StepRow({
  step,
  label,
  showMedia,
}: {
  step: AgentStep;
  label: string;
  showMedia: boolean;
}) {
  const isRunning = step.status === "running";

  return (
    <div
      className={clsx("transition-all duration-200", isRunning && "step-enter")}
    >
      <div className="flex items-center gap-2 w-full text-left py-0.5 px-1 rounded text-xs">
        {toolIcon(step)}
        <span
          className={clsx(
            "truncate flex-1 transition-colors duration-200",
            isRunning && "text-warm-700 dark:text-warm-200 font-medium",
            step.status === "done" && "text-warm-500 dark:text-warm-400",
            step.status === "error" && "text-red-600 dark:text-red-400",
          )}
        >
          {label}
        </span>
      </div>
      {showMedia && step.screenshotUrl && (
        <div className="ml-6 mt-0.5 mb-1.5">
          <img
            src={step.screenshotUrl}
            alt="Page screenshot"
            className="max-h-28 rounded border border-warm-200/60 dark:border-warm-700/40 cursor-pointer opacity-90 hover:opacity-100 transition-opacity"
            onClick={() => window.open(step.screenshotUrl, "_blank")}
          />
        </div>
      )}
      {step.errorMessage && (
        <div className="ml-6 text-[10px] text-red-500 mt-0.5">
          {step.errorMessage}
        </div>
      )}
    </div>
  );
}

/** Threshold above which older steps are collapsed by default */
const COLLAPSE_THRESHOLD = 5;
/** How many recent steps remain visible when collapsed */
const VISIBLE_TAIL = 3;
const ACTIVE_VISIBLE_TAIL = 2;

type StepView = {
  step: AgentStep;
  label: string;
  lowLevel: boolean;
};

export const StepTimeline = React.memo(function StepTimeline({
  steps,
}: {
  steps: AgentStep[];
  defaultCollapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const stepViews: StepView[] = steps
    .filter(
      (step) =>
        !(step.type === "thinking" && isGenericProgressLabel(step.label)),
    )
    .map((step) => ({
      step,
      label: displayProgressLabel(step.label) ?? step.label,
      lowLevel: isLowLevelProgressLabel(step.label),
    }))
    .filter((view) => view.label.trim().length > 0);
  const hasUserFacingStep = stepViews.some((view) => !view.lowLevel);
  const diagnosticHiddenCount =
    !expanded && hasUserFacingStep
      ? stepViews.filter(
          (view) => view.lowLevel && view.step.status !== "running",
        ).length
      : 0;
  const displaySteps =
    !expanded && hasUserFacingStep
      ? stepViews.filter(
          (view) => !view.lowLevel || view.step.status === "running",
        )
      : stepViews;

  const hasRunning = displaySteps.some(
    (view) => view.step.status === "running",
  );
  const collapseThreshold = hasRunning
    ? ACTIVE_VISIBLE_TAIL
    : COLLAPSE_THRESHOLD;
  const visibleTail = hasRunning ? ACTIVE_VISIBLE_TAIL : VISIBLE_TAIL;
  const shouldCollapse = !expanded && displaySteps.length > collapseThreshold;
  const visibleSteps = shouldCollapse
    ? displaySteps.slice(-visibleTail)
    : displaySteps;
  const hiddenCount =
    displaySteps.length - visibleSteps.length + diagnosticHiddenCount;
  const shouldShowExpand =
    shouldCollapse || (!expanded && diagnosticHiddenCount > 0);
  const showMedia = expanded || (!shouldCollapse && displaySteps.length <= 2);
  const helperLabel = `${hiddenCount} earlier step${hiddenCount > 1 ? "s" : ""}`;

  if (displaySteps.length === 0) return null;

  return (
    <div className="max-w-[92%] mb-1">
      <div className="ml-1 border-l border-warm-200/60 dark:border-warm-700/40 pl-2 space-y-px">
        {shouldShowExpand && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-[11px] text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 py-0.5 px-1 transition-colors"
          >
            <ChevronRight size={11} />
            <span>{helperLabel}</span>
          </button>
        )}
        {expanded &&
        hiddenCount === 0 &&
        displaySteps.length > collapseThreshold ? (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1 text-[11px] text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 py-0.5 px-1 transition-colors"
          >
            <ChevronDown size={11} />
            <span>Collapse</span>
          </button>
        ) : null}
        {visibleSteps.map((view) => (
          <StepRow
            key={view.step.id}
            step={view.step}
            label={view.label}
            showMedia={showMedia}
          />
        ))}
      </div>
    </div>
  );
});
