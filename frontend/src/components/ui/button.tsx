import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-strong",
        outline:
          "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        subtle: "bg-muted text-foreground hover:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        success:
          "bg-success text-success-foreground hover:opacity-90",
        telegram:
          "bg-[#229ED9] text-white hover:bg-[#1d8cbe]",
      },
      size: {
        sm: "h-8 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-9 px-3.5 [&_svg]:size-4",
        lg: "h-11 px-5 [&_svg]:size-4",
        icon: "h-9 w-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export { buttonVariants };
