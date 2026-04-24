/**
 * catalog.ts — fetches Hermes Atlas catalog data from hermesatlas.com
 *
 * All data is public. We fetch over HTTP, cache in-memory for 1 hour, and
 * refresh on demand. Bundling the static JSON would work but goes stale
 * fast (the catalog gains repos weekly).
 */

const SITE_URL = "https://hermesatlas.com";
const TTL_MS = 60 * 60 * 1000; // 1h

export interface Repo {
  owner: string;
  repo: string;
  name: string;
  description: string;
  stars: number;
  url: string;
  official?: boolean;
  category: string;
}

export interface Summary {
  summary: string;
  highlights: string[];
  readmeHash?: string;
  generatedAt?: string;
  model?: string;
  audit?: string;
}

export interface List {
  slug: string;
  title: string;
  description: string;
  filter?: { category?: string };
}

export interface ListSummary {
  entries: Record<string, string>;
  generatedAt?: string;
  version?: number;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const cache: Record<string, CacheEntry<unknown>> = {};

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${SITE_URL}${path}`;
  const cached = cache[url];
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.value as T;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const value = (await res.json()) as T;
  cache[url] = { value, fetchedAt: Date.now() };
  return value;
}

async function fetchText(path: string): Promise<string> {
  const url = `${SITE_URL}${path}`;
  const cached = cache[url];
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.value as string;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const value = await res.text();
  cache[url] = { value, fetchedAt: Date.now() };
  return value;
}

export function loadRepos(): Promise<Repo[]> {
  return fetchJson<Repo[]>("/data/repos.json");
}

export function loadSummaries(): Promise<Record<string, Summary>> {
  return fetchJson<Record<string, Summary>>("/data/summaries.json");
}

export function loadLists(): Promise<List[]> {
  return fetchJson<List[]>("/data/lists.json");
}

export function loadListSummaries(): Promise<Record<string, ListSummary>> {
  return fetchJson<Record<string, ListSummary>>("/data/list-summaries.json");
}

export function loadEcosystemMarkdown(): Promise<string> {
  return fetchText("/ECOSYSTEM.md");
}

export function loadLlmsFull(): Promise<string> {
  return fetchText("/llms-full.txt");
}

/**
 * Lightweight relevance search over the catalog (name/description/summary/category).
 * Not BM25 — ranked by presence of match terms with a small bonus for title hits
 * and official/high-star projects. Good enough for an MVP; can swap for BM25 later.
 */
export function searchRepos(
  repos: Repo[],
  summaries: Record<string, Summary>,
  query: string,
  options: { category?: string; limit?: number } = {},
): Array<Repo & { score: number; summary?: string }> {
  const limit = options.limit ?? 10;
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (terms.length === 0) return [];

  const scored = repos
    .filter((r) => !options.category || r.category === options.category)
    .map((r) => {
      const key = `${r.owner}/${r.repo}`;
      const summary = summaries[key]?.summary || "";
      const haystack = [
        r.name,
        r.repo,
        r.owner,
        r.description,
        r.category,
        summary,
      ].join(" ").toLowerCase();

      const name = `${r.owner}/${r.repo}`.toLowerCase();

      let score = 0;
      for (const t of terms) {
        if (name.includes(t)) score += 5;
        const matches = haystack.split(t).length - 1;
        if (matches > 0) score += Math.min(matches, 3);
      }

      if (score > 0 && r.official) score += 1;
      if (score > 0 && r.stars >= 1000) score += 1;

      return { ...r, score, summary };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.stars || 0) - (a.stars || 0);
    })
    .slice(0, limit);

  return scored;
}
