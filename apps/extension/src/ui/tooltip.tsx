import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { useUiPortalContainer } from "./portal";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => {
    const container = useUiPortalContainer();

    return (
        <TooltipPrimitive.Portal container={container ?? undefined}>
            <TooltipPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    "z-50 max-w-72 overflow-hidden rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-ui-control text-slate-900 shadow-soft-md animate-in fade-in-0 zoom-in-95 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100",
                    className,
                )}
                {...props}
            />
        </TooltipPrimitive.Portal>
    );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
