import { useEffect, useState } from "react";
import { SearchBox } from "./components/SearchBox";

interface Metrics {
  trie?: { loadedQueries: number };
  cache?: { hitRate: string; hits: number; misses: number };
  suggest?: { p95LatencyMs: number | null; totalRequests: number };
  batchWriter?: { queueLength: number; totalProcessed: number };
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function App() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const fetchMetrics = () => {
      fetch(`${BASE_URL}/metrics`)
        .then((r) => r.json() as Promise<Metrics>)
        .then(setMetrics)
        .catch(() => {});
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 8_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="app">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="hero">
        <div className="hero-eyebrow">
          <span className="pulse-dot" />
          Live System · All Services Operational
        </div>
        <h1>Typeahead Search</h1>
        <p className="hero-sub">
          Autocomplete powered by a character Trie, consistent-hash Redis cache
          across 3 nodes, and real-time exponential decay trending signals.
        </p>
        <div className="hero-pills">
          <span className="pill"><span className="pill-dot" />Trie O(L)</span>
          <span className="pill"><span className="pill-dot" />FNV-1a Hash Ring</span>
          <span className="pill"><span className="pill-dot" />Redis × 3</span>
          <span className="pill"><span className="pill-dot" />SQLite WAL</span>
          <span className="pill"><span className="pill-dot" />Batch Writer</span>
          <span className="pill"><span className="pill-dot" />Trending Decay</span>
        </div>
      </header>

      {/* ── Search ───────────────────────────────────────────── */}
      <SearchBox />

      {/* ── Metrics Panel ────────────────────────────────────── */}
      {metrics && (
        <div className="stats-panel" aria-label="System metrics">
          <div className="stats-panel-header">
            <div className="stats-panel-title">
              <span className="live-dot" />
              System Observability
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              refreshes every 8s
            </span>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label-top">Queries in Trie</div>
              <div className="stat-value">
                {metrics.trie?.loadedQueries
                  ? `${(metrics.trie.loadedQueries / 1000).toFixed(0)}K`
                  : "—"}
              </div>
              <div className="stat-sub">150K words indexed</div>
            </div>
            <div className="stat-card">
              <div className="stat-label-top">Cache Hit Rate</div>
              <div className="stat-value">
                {metrics.cache?.hitRate ?? "—"}
              </div>
              <div className="stat-sub">
                {metrics.cache
                  ? `${metrics.cache.hits} hits / ${metrics.cache.misses} misses`
                  : "waiting for data"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label-top">p95 Latency</div>
              <div className="stat-value">
                {metrics.suggest?.p95LatencyMs != null
                  ? `${metrics.suggest.p95LatencyMs.toFixed(0)}ms`
                  : "—"}
              </div>
              <div className="stat-sub">
                {metrics.suggest?.totalRequests
                  ? `over ${metrics.suggest.totalRequests} requests`
                  : "no requests yet"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label-top">Redis Nodes</div>
              <div className="stat-value">3</div>
              <div className="stat-sub">150 vnodes · FNV-1a ring</div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
