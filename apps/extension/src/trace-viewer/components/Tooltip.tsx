import React from "react";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
  maxWidth?: number;
}

export default function Tooltip({
  content,
  children,
  placement = "top",
  delay = 300,
  maxWidth = 280,
}: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delay}>
      <UiTooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={placement}
          style={{ maxWidth }}
          className="border-trace-border bg-trace-panel text-trace-text"
        >
            {content}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}
