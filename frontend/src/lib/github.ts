/**
 * GitHub repo metadata for the star badge.
 *
 * Fetched server-side through /api/github/stars (cached 1h) so visitors never
 * hit the GitHub API directly (shared-IP rate limits) and private repos work
 * when GITHUB_TOKEN is configured. Everything degrades gracefully: if the
 * repo is unreachable we still render the link, just without a count.
 */

const DEFAULT_REPO = "Travisun/EtherSignals";

export type RepoMeta = {
  repo: string;
  url: string;
  stars: number | null;
};

export function githubRepoName(): string {
  return process.env.NEXT_PUBLIC_GITHUB_REPO || DEFAULT_REPO;
}

export async function fetchRepoMeta(): Promise<RepoMeta> {
  const repo = githubRepoName();
  const fallback: RepoMeta = { repo, url: `https://github.com/${repo}`, stars: null };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "EtherSignals",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 3_600 },
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      html_url?: string;
      stargazers_count?: unknown;
    };
    return {
      repo,
      url: data.html_url ?? fallback.url,
      stars:
        typeof data.stargazers_count === "number" && data.stargazers_count >= 0
          ? data.stargazers_count
          : null,
    };
  } catch {
    return fallback;
  }
}

export function formatStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
