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
            "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-caption transition-colors",
            autonomousMode
              ? "text-warning"
              : "text-fg-tertiary hover:text-fg-secondary",
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
        className="w-64 rounded-lg border-line bg-canvas p-0 shadow-sm"
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
                ? "bg-surface-subtle"
                : "hover:bg-surface-subtle",
            )}
          >
            <Icon
              size={14}
              className="mt-0.5 shrink-0 text-fg-tertiary"
            />
            <div className="min-w-0 flex-1">
              <div className="text-ui-control font-medium text-fg">
                {title}
              </div>
              <div className="mt-0.5 text-ui-caption text-fg-tertiary">
                {getInteractionModeDescription(optionMode)}
              </div>
            </div>
            {mode === optionMode ? (
              <Check size={14} className="mt-0.5 shrink-0 text-accent-text" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
