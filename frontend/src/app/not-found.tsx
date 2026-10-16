import { Compass } from "lucide-react";
import { TrackedLink } from "@/components/analytics/tracked-link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass className="size-6" />
        </div>
        <h1 className="text-lg font-bold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This site is a single-page feed, and everything lives on the homepage.
        </p>
        <TrackedLink
          href="/"
          event="notfound.home"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong"
        >
          Back to the feed
        </TrackedLink>
      </div>
    </div>
  );
}
