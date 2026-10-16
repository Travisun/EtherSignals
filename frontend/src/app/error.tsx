"use client";

import { AlertTriangle } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { useEffect } from "react";

/** Global error boundary: logs client-side, shows a calm recovery action. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-lg font-bold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The feed hit an unexpected error. Retrying usually fixes it.
        </p>
        <button
          onClick={() => {
            trackEvent("error.retry");
            reset();
          }}
          className="inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
