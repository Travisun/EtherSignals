import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11px] font-semibold uppercase tracking-wide [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        long: "bg-success/12 text-success",
        short: "bg-destructive/12 text-destructive",
        close: "bg-muted text-muted-foreground",
        info: "bg-info/12 text-info",
        primary: "bg-primary/12 text-primary",
        warning: "bg-warning/15 text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
