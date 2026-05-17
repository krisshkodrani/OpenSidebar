import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
    "inline-flex items-center rounded-md border px-2 py-0.5 text-ui-caption font-medium tabular-nums transition-colors",
    {
        variants: {
            variant: {
                default: "border-transparent bg-primary-600 text-white",
                secondary: "border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
                outline: "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200",
                success: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
                warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
                error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
                live: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300",
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
