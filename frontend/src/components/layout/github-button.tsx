"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden={true}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function formatStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * GitHub repository button with live star count. The count is fetched from
 * our own cached API (/api/github/stars → GitHub, 1h revalidate); when the
 * repo is private or unreachable the button degrades to a plain link.
 */
export function GithubButton({
  className,
  source = "header",
}: {
  className?: string;
  source?: string;
}) {
  const [meta, setMeta] = useState<{ repo: string; url: string; stars: number | null } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    fetch("/api/github/stars")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && typeof data.repo === "string") setMeta(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "Travisun/EtherSignals";
  const url = meta?.url ?? `https://github.com/${repo}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Star EtherSignals on GitHub"
      title="Star EtherSignals on GitHub"
      onClick={() => trackEvent("github.click", { source })}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <GitHubMark className="size-4" />
      {meta?.stars !== null && meta?.stars !== undefined ? (
        <span className="tnum font-semibold">{formatStars(meta.stars)}</span>
      ) : null}
    </a>
  );
}

export { GitHubMark };
