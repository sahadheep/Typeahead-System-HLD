import { useEffect, useState } from "react";
import { SearchBox } from "./components/SearchBox";

interface Metrics {
  trie?: { loadedQueries: number };
  cache?: { hitRate: string; hits: number; misses: number };
  suggest?: { p95LatencyMs: number | null; totalRequests: number };
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function App() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // Poll metrics every 10s for the stats bar
  useEffect(() => {
    const fetchMetrics = () => {
      fetch(`${BASE_URL}/metrics`)
        .then((r) => r.json() as Promise<Metrics>)
        .then(setMetrics)
        .catch(() => {}); // silent — metrics bar is decorative
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="app">
      {/* Hero */}
      <header className="hero">
        <div className="hero-badge">
          <span className="dot" />
          Distributed Search · Trie + Redis × 3
        </div>
        <h1>Typeahead Search</h1>
        <p>
          Autocomplete powered by a character Trie, consistent-hash Redis cache,
          and real-time trending signals.
        </p>
      </header>

      {/* Search */}
      <SearchBox />

      {/* Stats bar */}
      {metrics && (
        <div className="stats-bar" aria-label="System metrics">
          <div className="stat-item">
            <div className="stat-value">
              {metrics.trie?.loadedQueries
                ? (metrics.trie.loadedQueries / 1000).toFixed(0) + "K"
                : "—"}
            </div>
            <div className="stat-label">Queries in Trie</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {metrics.cache?.hitRate ?? "—"}
            </div>
            <div className="stat-label">Cache Hit Rate</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {metrics.suggest?.p95LatencyMs !== null &&
              metrics.suggest?.p95LatencyMs !== undefined
                ? `${metrics.suggest.p95LatencyMs.toFixed(0)}ms`
                : "—"}
            </div>
            <div className="stat-label">p95 Latency</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">3</div>
            <div className="stat-label">Redis Nodes</div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
