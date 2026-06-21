export interface Suggestion {
  query: string;
  count: number;
  score: number;
}
export interface SuggestResponse {
  suggestions: Suggestion[];
  meta: {
    cacheHit: boolean;
    node: string;
    port: number;
    latencyMs: number;
  };
}

export interface SearchResponse {
  message: string;
  query: string;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function fetchSuggestions(
  prefix: string,
  mode: "count" | "trending" = "count"
): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q: prefix, mode });
  const res = await fetch(`${BASE_URL}/suggest?${params}`);
  if (!res.ok) throw new Error(`Suggest failed: ${res.status}`);
  return res.json() as Promise<SuggestResponse>;
}

export async function postSearch(query: string): Promise<SearchResponse> {
  const res = await fetch(`${BASE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json() as Promise<SearchResponse>;
}
