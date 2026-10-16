"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

/**
 * CSS-driven icon swap (no mounted state, no hydration mismatch): both icons
 * render and the `.dark` class decides which is visible.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        trackEvent("theme.toggle", { to: next });
        setTheme(next);
      }}
    >
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  );
}
