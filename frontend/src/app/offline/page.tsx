import { WifiOff } from "lucide-react";
import { EmptyState } from "@/components/ui/card";
import { TrackedLink } from "@/components/analytics/tracked-link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="rounded-lg border border-border bg-card">
        <EmptyState
          icon={<WifiOff />}
          title="You are offline"
          description="The signal feed needs a connection. Check your network and try again."
        />
        <div className="flex justify-center pb-6">
          <TrackedLink
            href="/"
            event="offline.retry"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong"
          >
            Retry
          </TrackedLink>
        </div>
      </div>
    </div>
  );
}
