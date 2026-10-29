import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-body-strong font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover",
                destructive: "border border-danger/30 bg-danger-subtle text-danger hover:bg-danger/15",
                outline: "border border-line-strong bg-surface text-fg hover:bg-surface-hover",
                secondary: "bg-surface-subtle text-fg hover:bg-surface-hover",
                ghost: "text-fg-secondary hover:bg-surface-subtle hover:text-fg",
                link: "text-accent-text underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-3.5 py-2",
                sm: "h-8 rounded-md px-3 text-ui-control",
                lg: "h-10 rounded-md px-4",
                icon: "size-9 p-0",
                "icon-sm": "size-8 p-0",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";

        return (
            <Comp
                ref={ref}
                className={cn(buttonVariants({ variant, size }), className)}
                {...props}
            />
        );
    },
);
Button.displayName = "Button";
