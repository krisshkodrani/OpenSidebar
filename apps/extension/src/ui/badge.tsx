import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
    "inline-flex items-center rounded-md border px-2 py-0.5 text-ui-caption font-medium tabular-nums transition-colors",
    {
        variants: {
            variant: {
                default: "border-transparent bg-accent text-accent-fg",
                secondary: "border-transparent bg-surface-subtle text-fg-secondary",
                outline: "border-line-strong text-fg-secondary",
                success: "border-success/30 bg-success-subtle text-success",
                warning: "border-warning/30 bg-warning-subtle text-warning",
                error: "border-danger/30 bg-danger-subtle text-danger",
                live: "border-accent/30 bg-accent-subtle text-accent-text",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
