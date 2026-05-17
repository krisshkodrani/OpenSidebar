import React from "react";
import {
  Check,
  ChevronDown,
  Play,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  getInteractionModeDescription,
  getInteractionModeLabel,
  type InteractionMode,
} from "../../interaction-mode";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

const MODE_OPTIONS: Array<{
  mode: InteractionMode;
  title: string;
  Icon: LucideIcon;
}> = [
  {
    mode: "confirm_all",
    title: "Ask before acting",
    Icon: ShieldCheck,
  },
  {
    mode: "confirm_high_risk_only",
    title: "Ask for risky actions",
    Icon: ShieldAlert,
  },
  {
    mode: "confirm_plans_only",
    title: "Confirm plans only",
    Icon: ShieldCheck,
  },
  {
    mode: "autonomous",
    title: "Act without asking",
    Icon: Play,
  },
];

export function InteractionModeMenu({
  mode,
  onChange,
}: {
  mode: InteractionMode;
  onChange: (mode: InteractionMode) => void;
}) {
  const autonomousMode = mode === "autonomous";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
            autonomousMode
              ? "text-amber-700 dark:text-amber-300"
              : "text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200",
          )}
        >
          {autonomousMode ? (
            <ShieldAlert size={10} className="shrink-0" />
          ) : (
            <ShieldCheck size={10} className="shrink-0" />
          )}
          <span>{getInteractionModeLabel(mode)}</span>
          <ChevronDown size={10} className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-64 rounded-lg border-warm-200 bg-warm-50 p-0 shadow-lg dark:border-warm-700 dark:bg-warm-800"
      >
        {MODE_OPTIONS.map(({ mode: optionMode, title, Icon }) => (
          <DropdownMenuItem
            key={optionMode}
            onSelect={() => {
              onChange(optionMode);
            }}
            className={cn(
              "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
              mode === optionMode
                ? "bg-warm-100 dark:bg-warm-700/50"
                : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
            )}
          >
            <Icon
              size={14}
              className="mt-0.5 shrink-0 text-warm-500 dark:text-warm-400"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-warm-800 dark:text-warm-100">
                {title}
              </div>
              <div className="mt-0.5 text-[10px] text-warm-500 dark:text-warm-400">
                {getInteractionModeDescription(optionMode)}
              </div>
            </div>
            {mode === optionMode ? (
              <Check size={14} className="mt-0.5 shrink-0 text-primary-500" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
